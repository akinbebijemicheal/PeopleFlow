# PeopleFlow — Leave Request & Approval Module

A slice of a multi-tenant HR platform's leave request/approval workflow,
built with NestJS, TypeScript, PostgreSQL, and Prisma.

## Stack

- Node.js + TypeScript + NestJS 11
- PostgreSQL + Prisma 6 (`prisma-client-js` generator — see [Why Prisma 6,
  not 7](#why-prisma-6-not-7) below)
- Jest + Supertest for tests (real HTTP requests against a real database,
  no mocks)
- Swagger/OpenAPI docs at `/docs`

## Setup

### Option A: local Postgres

1. Have a PostgreSQL server running locally.
2. Create a database and a role for the app (or reuse an existing
   superuser — adjust the connection string below either way):
   ```sql
   CREATE ROLE peopleflow WITH LOGIN PASSWORD 'peopleflow';
   CREATE DATABASE peopleflow OWNER peopleflow;
   ```
3. Copy the env file and adjust `DATABASE_URL` if your credentials differ:
   ```bash
   cp .env.example .env
   ```
4. Install, migrate, seed, run:
   ```bash
   npm install
   npm run migrate
   npm run seed
   npm test
   npm run dev
   ```
   The app starts on `http://localhost:3000`. Swagger UI is at
   `http://localhost:3000/docs`.

### Option B: Docker (app + Postgres)

```bash
cp .env.example .env
docker-compose up -d --build
docker-compose exec app npm run seed
```

This builds the app image, starts Postgres in a container, waits for its
healthcheck, runs `prisma migrate deploy` automatically on container start,
then starts the app. Seeding is a separate explicit step (intentionally not
run automatically on every container start). Verified by actually running
`docker-compose up --build` end to end, not just by inspecting the
Dockerfile — see [Bugs found by actually running things](#bugs-found-by-actually-running-things-not-just-reading-the-code).

### Exact commands (as required by the assessment)

```bash
npm install
npm run migrate
npm test
npm run dev
```

Additional scripts: `npm run seed` (seed data), `npm run test:unit` (just
the unit tests), `npm run test:e2e` (just the e2e tests), `npm run lint`,
`npm run build`.

## Tenant and approver identity

- **Tenant**: this implementation accepts `X-Tenant-Id` as an optional
  request header, defaulting to the seeded `tenant-001` if omitted. Every
  Prisma query is scoped by `tenantId`. See [Question 8](#8-how-would-you-enforce-tenant-isolation-in-production)
  below for how this would need to change in production.
- **Approver**: `X-Approver-Id` is required on `approve`/`reject` and is
  stored as `approvedBy`/`rejectedBy` for audit purposes. There is no
  authentication or role check — see [Questions 1–2](#1-who-can-approve-leave).

## Seed data

One tenant (`tenant-001`, "Acme Corp") and two employees:

| id | name | annualLeaveBalance |
|---|---|---|
| `employee-001` | Aisha Bello | 10 |
| `employee-002` | Tunde Okafor | 18 |

## API

Full interactive docs (with request/response schemas) at `/docs` once the
app is running. Summary:

| Method | Path | Notes |
|---|---|---|
| POST | `/leave-requests` | Submit a leave request (enters PENDING) |
| POST | `/leave-requests/:id/approve` | Approve a PENDING request (idempotent on retry) |
| POST | `/leave-requests/:id/reject` | Reject a PENDING request (requires `comment`) |
| GET | `/leave-requests` | List requests, optional `?status=` and `?employeeId=` filters, sorted by `createdAt desc` |
| GET | `/employees/:employeeId/leave-balance` | Remaining annual leave days |

### curl examples

```bash
# Submit
curl -X POST http://localhost:3000/leave-requests \
  -H "Content-Type: application/json" \
  -d '{"employeeId":"employee-001","leaveType":"ANNUAL","startDate":"2026-08-01","endDate":"2026-08-03"}'

# Approve (use the id returned above)
curl -X POST http://localhost:3000/leave-requests/<id>/approve \
  -H "X-Approver-Id: manager-001"

# Reject
curl -X POST http://localhost:3000/leave-requests/<id>/reject \
  -H "Content-Type: application/json" -H "X-Approver-Id: manager-001" \
  -d '{"comment":"No coverage available that week"}'

# List / balance
curl "http://localhost:3000/leave-requests?status=PENDING&employeeId=employee-001"
curl http://localhost:3000/employees/employee-001/leave-balance
```

## Tests

23 e2e tests (`test/*.e2e-spec.ts` — real HTTP requests via Supertest
against the real app and a real local Postgres, no mocks) plus 2 unit
tests. Run with `npm test` (both suites) or `npm run test:e2e` /
`npm run test:unit` individually.

The e2e tests reset `leave_requests` and both employees' balances in a
`beforeEach`, against whatever database `DATABASE_URL` points at — there
is no separate test database for this assessment's scope. The two e2e
spec files run with `--runInBand` because they share that one database;
running them as separate parallel Jest workers (the default) caused a
real, intermittent failure (see below).

The test I'd point to first: `test/leave-requests-approve-reject.e2e-spec.ts`'s
"does not deduct the balance twice when two approve requests race
concurrently" — it fires two real concurrent HTTP requests at the same
PENDING request via `Promise.all` and asserts the balance is only deducted
once. That's the actual bug from `DEBUGGING.md`, proven fixed, not just
described.

## Ambiguous requirements — assumptions made

#### 1. Who can approve leave?
Anyone who supplies a valid `X-Approver-Id` header. No authentication or
authorization system is implemented (explicitly out of scope per the
assessment); the header is trusted as-is.

#### 2. Are approvers required to be managers?
No. The suggested `X-Approver-Role` header is not read or validated by
this implementation — any caller with an approver id can approve or
reject. In production this would be a real authorization check (e.g.
verifying the approver is the employee's manager, or has an HR-admin
role).

#### 3. Are half-days supported or only full days?
Only full days. `daysRequested` is an inclusive whole-day count between
`startDate` and `endDate`; the schema stores dates as Postgres `DATE`
(no time component), which has no representation for a half-day.

#### 4. Do weekends and public holidays count against leave balance?
Yes, in this implementation. `daysRequested` is a simple inclusive
calendar-day count with no business-day or holiday-calendar logic. A real
system would need a per-tenant holiday calendar and likely exclude
weekends; I left that out deliberately rather than build a holiday-calendar
feature out of scope for this assessment.

#### 5. How are dates stored and compared?
Postgres `DATE` columns (`@db.Date` in the Prisma schema) — no time or
timezone component. Input strings (`YYYY-MM-DD`) are parsed with
`new Date(...)`, which ECMA-262 specifies as UTC midnight for date-only
strings. All comparisons (past-date check, overlap check) stay in UTC
throughout (`src/common/utils/date.util.ts`), so results don't drift with
the server's local timezone.

#### 6. What happens if two overlapping requests are submitted at nearly the same time?
This is the one concurrency gap I deliberately did **not** close in code,
unlike approve/reject (which the spec explicitly requires to be
duplicate-safe, and which I verified with a real concurrent test — see
Tests above). The overlap check and the subsequent `create` are two
separate statements, not one atomic operation, so two near-simultaneous
submissions for genuinely overlapping dates could both pass the check and
both get created. In production I'd close this with a Postgres exclusion
constraint (`EXCLUDE USING gist` over `(employeeId, daterange(startDate,
endDate))` for PENDING/APPROVED rows) so the database itself rejects the
second overlapping insert, rather than relying on an application-level
check-then-insert.

#### 7. How would you extend this for a multi-step approval chain?
Add an ordered `approval_steps` table (or a `currentStep` pointer on
`LeaveRequest`) representing a sequence of required approvers/roles.
`status` stays PENDING until the final step approves; each step's
transition reuses the same atomic conditional-update pattern as the
current single-step `approve()`, and each step writes its own audit row
(see the audit logging design in `DESIGN_NOTES.md`).

#### 8. How would you enforce tenant isolation in production?
Today `tenantId` comes from a trusted, client-supplied `X-Tenant-Id`
header — fine for this assessment, not for production. In production,
`tenantId` would be derived from an authenticated session/JWT claim,
never a client-supplied header; every query already goes through
`tenantId`-scoped Prisma calls (`findFirst({ where: { id, tenantId } })`
throughout), so that scoping pattern stays — only the *source* of
`tenantId` changes. For defense in depth, Postgres Row-Level Security
policies keyed on a per-request session variable would prevent an
application-layer bug from ever leaking data across tenants.

## Design decisions and tradeoffs

- **Balance deducted only on approval, never on submission** — a literal
  spec rule, but it creates a real gap: two PENDING ANNUAL requests for the
  same employee can each individually pass the at-submission balance check
  and only collide at approval time. Closed with a `gte` guard on the
  decrement itself (`approve()` rolls back the whole transaction if the
  balance would go negative), rather than a more complex balance
  reservation system.
- **Approve/reject are idempotent on retry** — calling either twice for an
  already-decided request returns the existing state instead of erroring,
  which is what makes a client retry (the scenario in `DEBUGGING.md`)
  actually safe. Approving an already-rejected request (or vice versa) is
  a genuine 409 conflict, not treated as idempotent.
- **Synchronous balance deduction**, inside the approve transaction, not
  via a queue/worker — see `DESIGN_NOTES.md` Section 3 Q4 for the full
  tradeoff.
- **Prisma 6, not 7** — see below.

### Why Prisma 6, not 7

Prisma 7's default `prisma-client` generator emits ESM-only code
(`import.meta.url`), which doesn't compile under this project's
CommonJS/`nodenext` setup. Switching generators fixed that but exposed a
deeper issue: Prisma 7's client requires a driver adapter (e.g.
`@prisma/adapter-pg`) just to construct `new PrismaClient()`. Rather than
add that dependency for no functional benefit, this project pins to the
latest stable Prisma 6.x line, which matches the standard NestJS+Prisma
pattern with zero extra moving parts.

### Bugs found by actually running things, not just reading the code

A few real issues only surfaced by executing the full stack, not by
inspecting the Dockerfile/scripts:

- `Dockerfile` used `npm ci`, which failed on a pre-existing
  `package-lock.json` inconsistency (an optional, wasm32-only transitive
  dependency's own sub-dependencies were never fully resolved into the
  lockfile). Fixed by using `npm install` in the image build.
- `start:prod` and the Dockerfile's `CMD` both pointed at `dist/main.js`,
  inherited unmodified from the original Nest CLI scaffold — but
  `nest-cli.json`'s `sourceRoot: "src"` means the real build output is
  `dist/src/main.js`. Never exercised until the Docker image was actually
  run.
- The two e2e spec files share one live database, and Jest runs separate
  test files in parallel by default — one file's destructive `beforeEach`
  reset could delete a row another file's test had just created, causing
  intermittent 404s. Fixed with `--runInBand` on `test:e2e`.

All three are now fixed and verified: `docker-compose up --build` runs
end to end (migration, seed, submit, approve, balance check all confirmed
against the containerized stack), and the e2e suite passes reliably across
repeated runs.

## Limitations (explicitly out of scope)

Per the assessment's non-requirements: no real authentication system, no
full multi-tenant SaaS architecture, no email notifications, no payroll
integration, no message queues. See `DESIGN_NOTES.md` for how several of
these would be approached if/when they're needed.

## Other documents

- [`DEBUGGING.md`](DEBUGGING.md) — Section 2, the duplicate-balance-deduction
  scenario: root cause, fix, and why it works.
- [`DESIGN_NOTES.md`](DESIGN_NOTES.md) — Sections 3 and 4, system design
  questions and product/engineering judgment scenarios.
- [`AI_REFLECTION.md`](AI_REFLECTION.md) — Section 5.
