# ADR-0009 | D1-backed global Cron dispatch budget

Date: 2026-11-10
Status: Implemented on PR #14; CI-verified locally, not remotely deployed.

## Problem verified by code review

P1-D limited `runScheduler()` to at most three GitHub GET attempts **per invocation**. Two overlapping Cron invocations against the same D1 database can each select and claim different due monitors, yielding more than three combined provider requests. The rotating `last_owner_id` cursor helps fairness but is **not a distributed quota**. A locally verified no-spend pilot must have a shared dispatch gate before any external GitHub fetch.

Cloudflare states that Cron Triggers use **UTC** and D1 database queries are processed one at a time per database. Source links below; remote consistency and actual account limits still require acceptance.

## Decision and implementation

- **Non-destructive migration** `worker/migrations/0004_global_scheduler_budget.sql` adds two fields to the existing single-row `scheduler_control` table:
  - `budget_window_start`: start of a fixed 15-minute UTC epoch window, initially 0
  - `budget_claims`: count of provider reservations in that window, checked 0..3, initially 0
- `runScheduler()` now invokes an **atomic conditional D1 UPDATE** before attempting to claim any due monitor. This applies to **both legacy operator-only mode and mobile-enabled mode**, so both share the same budget. Reservation expression either increments a count for the existing window (only if below three), resets it to one for a strictly newer window, or refuses a backward/replayed window. If the control table/migration is missing, the scheduled invocation fails closed with **no external provider request**.
- The Worker then attempts its original fenced lease claim. If the lease claim definitely changed zero rows, **no upstream GET happened**, so a separate conditional D1 UPDATE refunds the unused reservation. If refunding fails, the slot is conservatively forfeited. An ambiguous reservation, claim or refund error must not permit unmetered provider traffic.
- A granted lease consumes one reservation **even when GitHub times out, rate limits or returns invalid data**: it represents an attempt, not a successful observation. Existing default-off mobile flag and owner isolation are unchanged, as is the three-requests-per-invocation upper bound.
- Each UTC quarter-hour window contains **at most three successfully reserved provider attempts across Worker invocations that share this D1 database**. This is **not** a sliding 15-minute window; a burst near the boundary could produce requests from two adjacent windows in a short period. Independent D1 databases, manual API clients, cache misses, external provider subrequests or other Worker deployments are **outside** this specific budget.
- The quota is intentionally fail-closed and may underutilize it when an invocation crashes after reserving but before the provider call. The quota row is retained across process restarts and does not use an in-memory lock or request-scoped global Promise.
- The fairness cursor is still updated separately after successful claims, so **exact ordering during truly overlapping remote executions is not guaranteed**. The budget guards provider count, not strict per-owner fairness. A future stronger fairness/SLA design would need transactional combined cursor and reservations or an appropriate single coordinator.
- This is a guardrail, **not an authorization to deploy**. Migration **0004 must be applied after 0001..0003** before any version of the updated scheduler is enabled. Deployment without it fails closed, including the legacy operator path; this is deliberate. Do not silently drop or recreate existing D1 data.

## Verification boundary

- Node + SQLite D1-like tests simulate two scheduler executions with interleaved provider I/O, six active mobile owners, shared D1 state and distinct due monitors. Require **at most three combined GETs** in a UTC quarter-hour, additional three in a later quarter-hour, zero after a backward-time replay, zero provider fetch with missing budget migration or malformed timestamp, and refund on an explicitly unsuccessful lease claim.
- Local real **workerd/D1 binding** tests repeat the overlap against a single D1 database, dispose and restart the local runtime without losing the budget, verify backlog resumes in the next window, and separately apply migration 0004 to a preexisting operator monitor/cursor without damaging either.
- The real GitHub read-only CI integration now applies the complete additive D1 migration chain before invoking the shipped scheduler; a first CI run **failed** because that fixture only installed migration 0001. This test-environment error was corrected in the same PR, not hidden.
- All such executions are **local simulations** using a shared local D1 binding, even when they trigger the provider's real public GitHub GET. They do **not** establish remote Cloudflare scheduling, actual cross-region consistency, Workers Free CPU viability, account billing, real Google OAuth, physically-off-device acceptance or cost.
- No live Cloudflare remote writes, deployment, fee-bearing third-party API calls or external provider mutations are authorized or performed.

## Limitations / conditions to revisit

- **Availability trade-off:** limiting all modes to three attempts per fixed quarter-hour can delay tasks under backlog, including operator jobs. Do not promise a 30-minute SLA under concurrency.
- **Boundary burst:** at most three reservations in each *fixed* window, not three in any *rolling* 15-minute span; the same workload can generate up to six attempts straddling the boundary.
- **Crash after reservation:** consumes allowance even if no HTTP GET occurs; this favors capped cost over throughput.
- **Clock assumption:** window key is calculated from the scheduled runtime clock, which is not user-supplied. Backdated ticks are rejected if a newer window already exists.
- **Lease semantics:** monitor lease tokens prevent overwrites after competing claims or pause. Separately auditing deadlines for an un-reclaimed expired lease, exact cursor fairness under overlapping remote Cron, and D1 read replication/session semantics remains recommended. This change does not resolve those independent risks.
- **Account limits:** Cloudflare Workers Free CPU/time, D1 query/row costs, schedule frequency and GitHub anonymous API quotas must be measured on the actual account before deployment. No hypothetical cost savings or guaranteed free usage claimed.

## External primary references

- Cloudflare Cron UTC semantics and local scheduled testing: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- D1 query serialisation, throughput and overload: https://developers.cloudflare.com/d1/reference/faq/
- D1 platform constraints: https://developers.cloudflare.com/d1/platform/limits/
- Workers Free CPU and Cron limits: https://developers.cloudflare.com/workers/platform/limits/

## Acceptance before closure

1. Five CI workflows successful on **exact final PR-head SHA** with inspectable logs and no skipped security tests.
2. Record every migration and additive compatibility proof, prior failing runs, merge SHA, and post-merge documentation SHA in PROGRESS/EVIDENCE/Issue #8.
3. On explicit owner approval, inspect real account quotas/billing, apply migrations in order, then deploy on a controlled Worker. Use genuine fixed HTTPS origin/OIDC provider only after setup verification.
4. Run a remote concurrency exercise with independent triggered Cron invocations, D1 reservation row snapshots, sanitised observation IDs, timestamps, account usage; then physically switch off the phone and prove remote tasks + post-restart sync. **No remote claim without that experiment.**
