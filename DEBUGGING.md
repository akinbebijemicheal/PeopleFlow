# Debugging: Duplicate Leave Balance Deduction

## 1. What went wrong

The handler ran twice (UI retry on timeout) within 200ms, and both runs deducted
the balance. A 5-day approval on a 10-day balance left 0, not 5.

## 2. Why the balance was deducted twice

Two separate bugs compound here:

**The PENDING guard is checked too early and never enforced atomically.** The
status check (`request.status !== 'PENDING'`) happens once, against an
in-memory read, near the *start* of the function — and the status is only
written back to `APPROVED` as the *second-to-last* step, after the balance
deduction. Nothing stops a second invocation from reading the request while
it's still `PENDING` (because the first invocation hasn't reached the status
write yet) and proceeding through the exact same path. There's no `WHERE`
clause, lock, or transaction tying the "is it still pending?" check to the
write — it's a classic check-then-act race.

**The balance update is a non-atomic read-modify-write in application code.**
`employee.annualLeaveBalance - request.daysRequested` is computed in JS from a
value read moments earlier, then written back with a plain `SET`. Postgres
still serializes the two `UPDATE employee ...` statements at the row level,
but each one blindly overwrites with whatever it computed from its own stale
read — so the second write doesn't fail or get rejected, it just compounds:
10 → 5 (first call's write) → 0 (second call reads 5, deducts 5, writes 0).

Both runs individually look "correct" in isolation. The bug is that nothing in
the code makes "check PENDING, then deduct, then mark APPROVED" a single
atomic unit.

## 3. The fix

Implemented in `src/leave-requests/leave-requests.service.ts` (`approve()`):

```ts
return this.prisma.$transaction(async (tx) => {
  // The status transition IS the concurrency gate: only one caller's
  // UPDATE can match a row that is still PENDING.
  const { count } = await tx.leaveRequest.updateMany({
    where: { id, tenantId, status: 'PENDING' },
    data: { status: 'APPROVED', approvedBy: approverId, approvedAt: new Date() },
  });

  if (count === 0) {
    // Lost the race to a concurrent approval of the same request.
    return tx.leaveRequest.findUniqueOrThrow({ where: { id } });
  }

  if (existing.leaveType === 'ANNUAL') {
    // Atomic SQL decrement, guarded by balance >= daysRequested, not a
    // JS-computed SET.
    const { count: balanceUpdated } = await tx.employee.updateMany({
      where: { id: existing.employeeId, annualLeaveBalance: { gte: existing.daysRequested } },
      data: { annualLeaveBalance: { decrement: existing.daysRequested } },
    });
    if (balanceUpdated === 0) {
      throw new UnprocessableEntityException('Insufficient annual leave balance at approval time');
    }
  }

  return tx.leaveRequest.findUniqueOrThrow({ where: { id } });
});
```

## 4. Why this works

The conditional `updateMany` makes the PENDING → APPROVED transition the
atomic gate, not a separate read followed by a separate write. Under
Postgres's default READ COMMITTED isolation, two concurrent `UPDATE`
statements targeting the same row serialize: the second one blocks until the
first commits, then re-evaluates its own `WHERE status = 'PENDING'` against
the *now-committed* row — which is `APPROVED` — and matches zero rows. The
loser's `count === 0` branch returns the current state instead of
re-running the deduction. The balance decrement uses the same atomic-update
pattern (`decrement` is a single SQL `balance = balance - x`, not a JS
computation), so even a second, unrelated approval touching the same
employee's balance can't lose an update. Both writes are inside one
transaction, so a failed balance check rolls back the status flip too —
the request stays PENDING rather than ending up APPROVED with no
deduction recorded.

## 5. Preventing recurrence

- **Idempotency key**: accept an optional `Idempotency-Key` header on
  mutating endpoints and store it against the resulting request id (short
  TTL), so a literal duplicate HTTP delivery short-circuits before touching
  business logic at all — not strictly required here since the status-gated
  update is already safe, but it avoids redundant work and gives a cleaner
  signal in logs than "lost the race."
- **Outbox pattern for the `leave.approved` event**: once this publishes to
  a real queue, write the event to an outbox table in the same transaction
  as the status/balance update, and let a separate dispatcher deliver it
  with a unique event id — so a crash between "approved" and "published"
  can't silently drop or duplicate the event.
- **Concurrency tests in CI, not just manually**: this repo's
  `test/leave-requests-approve-reject.e2e-spec.ts` fires two real concurrent
  `Promise.all` approve requests at the same row and asserts the balance is
  only decremented once — that test is what would have caught this bug
  before it reached production, and it now runs on every `npm test`.
