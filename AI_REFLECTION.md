# AI Usage Reflection

## 1. Which AI tools did you use, if any?

Claude Code (Claude Sonnet 4.6), used throughout the build as a pair
programmer, not as an autocomplete.

## 2. How did you use them?

Commit by commit, in order: I directed the plan (scaffold → Docker → Prisma
schema → seed → shared response/error handling → each endpoint → Swagger →
tests → the four required docs), and for each step the AI drafted the
implementation, ran it for real (build, lint, the actual test suite, and
live `curl`/server smoke tests against my local Postgres — not just "this
should work"), and proposed a commit message. I reviewed every diff, and I
ran every `git commit` and `git push` myself — nothing landed in the repo
without me deciding to put it there. When something was ambiguous (e.g.
whether to add Redis for the concurrency problem, which two of the three
Section 4 scenarios to answer, the exact idempotency semantics for a
double-approve), I made the call myself, sometimes after asking the AI to
lay out the tradeoff first.

## 3. Which generated code did you modify and why?

- **Prisma generator/version.** The AI's first pass picked Prisma 7's
  default `prisma-client` generator, which emits ESM-only code
  (`import.meta.url`) and broke the build under this project's CommonJS
  setup. The follow-up fix (switch to `prisma-client-js`) then hit a second,
  deeper issue: Prisma 7's client requires a driver adapter just to
  construct `new PrismaClient()`. Rather than add an adapter dependency for
  no real benefit, I had Prisma pinned to the latest stable 6.x line, which
  matches the standard NestJS+Prisma pattern with zero extra moving parts.
  This wasn't a style nit — it was a real "the app doesn't start" bug caught
  by actually trying to run the seed script.
- **The `reject()` race condition.** The first version of `reject()` would
  silently return an *approved* request's data if a concurrent `approve()`
  won the race after the initial status check but before the update — i.e.
  it could tell a caller "rejected" when it actually wasn't. I had this
  fixed to check the post-update state and throw a 409 in that case, the
  same way `approve()` already handled its own race.
- **The shared response helper I gave it.** I'd shared an Express-style
  `apiResponse()` helper that did content-negotiated JSON/XML responses. I
  had this adapted into NestJS idioms (a global `ExceptionFilter` +
  `ResponseInterceptor`) and deliberately dropped the XML branch — this API
  is JSON-only per the spec, and keeping XML support would have been
  unused code for a "do not overbuild" assessment.
- **A floating-promise lint warning** on `bootstrap()` in `main.ts` — a
  one-line `void` fix, but I wanted lint to be clean, not just "passing
  with warnings."

## 4. What AI suggestions did you reject and why?

The default commit message style was long, multi-paragraph essays
explaining what/why/alternatives-rejected/verification-steps for every
commit. I pushed back on this directly — it's not standard Conventional
Commits practice, and it bloated the history. I had it switched to short,
conventional subject+body messages, with the deeper rationale kept in our
conversation instead of baked into every commit.

I also asked directly whether the concurrency fix should use Redis for
distributed locking / rate limiting. The answer I got back, and agreed
with, was no for the locking case: the atomic conditional `UPDATE` already
running inside one Postgres transaction solves the duplicate-deduction
problem correctly (and a real concurrent test proves it), so a distributed
lock on top would be solving an already-solved problem with more
infrastructure to operate and fail. I scoped Redis's role to the design
notes only, as the right answer for *rate limiting* under the Friday-4pm
traffic-spike scenario, not as code to add now.

## 5. What technical decisions were entirely yours?

- Deducting the balance only at **approval**, never at submission — a
  literal business rule from the spec, but I made the call on exactly how
  that interacts with the overlap check (a PENDING request reserves the
  *dates*, not the balance, so two PENDING ANNUAL requests for the same
  employee can individually pass the balance check and only collide at
  approval time — a gap I chose to close with a `gte` guard on the
  decrement itself rather than a more complex reservation system).
- Making `approve()`/`reject()` **idempotent on retry** rather than erroring
  on a second call for an already-decided request — the spec requires "no
  double deduction" but doesn't dictate the HTTP semantics; I chose
  idempotent success over a 409 because that's what makes a UI retry safe
  by default.
- Tenant scoping via an `X-Tenant-Id` header with a seeded default, instead
  of building any real auth — an explicit, documented tradeoff the spec
  allows, not an oversight.
- Keeping balance deduction **synchronous**, inside the approve API, after
  weighing it against an async/queue-based approach in the design notes —
  I chose consistency over a scalability win the system doesn't need yet.
- Choosing Prisma 6 over the newer 7 once the driver-adapter requirement
  surfaced — stability over bleeding-edge for a project that has to "just
  run" for a reviewer.

## 6. What part of the work would you be most comfortable defending in a technical interview?

The concurrency fix in `approve()` and the test that proves it
(`test/leave-requests-approve-reject.e2e-spec.ts`, the test that fires two
real concurrent HTTP requests via `Promise.all` at the same pending
request). I can explain exactly why the original bug happens (the PENDING
check and the status write are split apart with nothing atomic tying them
together), why the fix works at the Postgres isolation-level (`WHERE
status = 'PENDING'` makes the UPDATE itself the gate, and concurrent
UPDATEs on the same row serialize), and I have a passing test that
exercises the actual race, not just the sequential-retry case. That's the
one piece of this submission I'd want to be questioned hardest on.
