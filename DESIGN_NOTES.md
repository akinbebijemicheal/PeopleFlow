# Design Notes

## Section 3: System Design Questions

### 1. Scaling Leave Submissions

The app tier is stateless (no in-process session/cache), so horizontal scaling
behind a load balancer is straightforward. The real constraint at 500
companies with a Friday-4pm spike is the database: connection pool exhaustion
under burst load, not CPU. I'd put PgBouncer (or equivalent pooling) in front
of Postgres, keep the approve/submit transactions as short as they already
are (a couple of indexed lookups + one conditional update, no external calls
inside the transaction), and add a read replica for `GET /leave-requests`
listing traffic so reads don't compete with the write-heavy submission path.
The schema already indexes `tenantId` and `(employeeId, status)`, which is
what the overlap check and balance lookups hit.

What I'd measure: p95/p99 latency on `POST /leave-requests`, DB connection
pool saturation and queueing, row-lock wait time on the `employees` table
(contention only matters if many requests target the *same* employee
concurrently, which is rare), and the 409/422 rate as a signal of real
contention vs. just load.

### 2. Duplicate Event Processing

Give every published event a stable, unique id — generated once when the
event is written to an outbox table in the *same transaction* as the
approval (not when it's published), so retried publishes reuse the same id.
Consumers (payroll, notifications) keep a `processed_event_ids` table and do
an insert-or-skip on that id before running the side effect; if the insert
conflicts, the event was already handled and the consumer no-ops. This is
the same idea as `approve()`'s conditional update, applied one layer further
out: make the "have I already done this?" check atomic and durable, not an
in-memory assumption.

### 3. Audit Logging

An append-only `audit_log` table (`id, tenantId, entityType, entityId,
action, actorId, beforeState, afterState` as JSONB, `createdAt`), with the
app's DB role denied `UPDATE`/`DELETE` on it so "immutable" is enforced by
Postgres, not convention. The key to not slowing down the API: write the
audit row inside the *same transaction* as the status change — `approve()`
already opens one transaction for the status+balance update, so this is one
more single-row insert in a transaction that's happening regardless, not an
extra round trip. I'd avoid making this async (queue/worker) specifically
*because* it's compliance data: async introduces a window where the action
succeeded but isn't audited yet, which defeats the point.

### 4. Sync vs Async Balance Deduction

Implemented synchronously, inside the approve API, and I'd keep it that way.
The operation is a single conditional `UPDATE` — already fast — so async
would trade a real consistency guarantee (the balance is correct the instant
the API responds) for a complexity cost (a worker, a queue, a new failure
mode) with no actual performance problem to justify it. Async earns its keep
for things that are genuinely slow or external — notifications, payroll
sync — not for an in-database decrement. Doing it async here would also
reopen exactly the kind of race this assessment's debugging exercise is
about, for no benefit.

### 5. Monolith vs Microservice

Leave management stays inside the main HR app for now: the balance
invariant lives on `Employee`, and `approve()`'s correctness depends on
updating `LeaveRequest.status` and `Employee.annualLeaveBalance` in one
Postgres transaction. Splitting that into two services means either a
distributed transaction or an eventual-consistency saga with compensating
actions — real complexity, for a problem a single-database transaction
already solves for free. I'd split it out when leave/approval needs to
scale, deploy, or be owned independently of the rest of HR, or when a
*second* product genuinely needs to consume leave data as a service rather
than a shared database. Splitting earlier than that breaks the one thing
this design currently gets for free: atomic cross-entity writes.

## Section 4: Product & Engineering Judgment

### Scenario A: The Quick Win

Flipping status back to `PENDING` is not a shortcut, it's data corruption:
the balance is never restored (employee permanently shorted the days),
there's no audit trail of who cancelled what or why, the request re-enters
an approval queue with no record it was ever decided, and nothing tells
already-fired consumers (a sent notification, payroll that already counted
the days) that anything changed.

What I'd recommend: a real, narrowly-scoped `Cancel` action — a new
`CANCELLED` status (not a reused `PENDING`), the balance restored atomically
in the same transaction as the status change, and one audit row. That's the
non-negotiable core, and it's closer to 1-2 days than 2 weeks once you drop
the parts that are genuinely out of scope for a demo: re-entering the
approval workflow, notification rollback, and payroll impact checks. Ship
the cancel-with-restoration-and-audit version for the demo. Refuse to ship
the "just flip it back to PENDING" version — it silently erases the fact
that the request was ever approved, and the very next feature that trusts
`status` will be built on a lie.

### Scenario B: Consistency vs Performance

80ms on a direct read vs. 5ms with up to 60s of staleness. For an
HR/payroll-adjacent product I'd take the slower, correct read by default —
a manager or employee seeing a stale balance right before approving or
submitting more leave is exactly the kind of bug that lets someone overdraw
their balance and erodes trust in the number the whole feature is built
around. 80ms is not a latency budget worth that risk.

If a read-heavy page genuinely needs caching (a dashboard widget, not the
submission/approval path itself), I'd mitigate the staleness by invalidating
the cache key synchronously inside the same transaction as the approval
(cache-aside with explicit invalidation, not a bare TTL) — that turns "stale
for up to 60 seconds" into "stale only if the invalidation itself fails,"
which is a much smaller and more debuggable problem. Either way, the actual
balance check that gates a new submission stays on the direct DB read,
never the cache.
