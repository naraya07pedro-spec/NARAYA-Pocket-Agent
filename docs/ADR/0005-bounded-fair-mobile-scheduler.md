# ADR-0005 | Opt-in fair and bounded multi-user GitHub monitoring

Date: 2026-11-10
Status: MERGED via PR #10 as `2368b27c18d0f6c07c2e61377c12ad6331b1c36b`; CI_VERIFIED_LOCAL (not remotely deployed)

## Context

P1-C introduced per-user D1 monitor rows, but all mobile rows were PAUSED, and the Cron scheduler only selected the legacy operator OWNER_ID. Enabling them by status alone would create a mismatch between mobile UI state and actual execution. An unrestricted global scheduler would expose the free-tier pilot to unbounded API calls and unfair owner scheduling.

## Decision

1. **Fail-closed mobile dispatcher gate**: only `MOBILE_SCHEDULING_ENABLED === 'true'` enables mobile owner processing. Unset/false preserves the legacy single-owner scheduler. No deployment config changes or automatic enablement.
2. **Per-owner activation**: `PATCH /v1/sync/monitors/{id}` requires valid, server-verified OIDC identity plus `{status:"ACTIVE"|"PAUSED",expectedVersion:integer}`. Update binds `owner_id`, `id`, `client_draft_id IS NOT NULL` and `version` atomically. Unknown/foreign monitor => 404; stale version => 409; ACTIVE without feature gate => 409. PAUSED is always allowed for an authorized owner.
3. **Explicit finite cost controls**: maximum 20 mapped OIDC identities (pilot enrollment cap), 3 monitors per owner (existing), 9 globally ACTIVE mobile monitors, maximum 3 GitHub GET attempts per tick globally when mobile scheduling enabled. Maximum one due monitor per owner per tick. These are application limits, **not** verified Cloudflare free-tier quota guarantees.
4. **Fair scheduling**: D1 `scheduler_control` stores a single `last_owner_id` cursor. An indexed/filtered query selects at most one due row per owner using SQLite `ROW_NUMBER()` and rotates ordering after that cursor; requests use an operator-owned row or signed-user-owned row. Cursor advances after a fenced lease is successfully claimed, before provider I/O. A process restart reads the cursor from D1. Cross-owner reads/actions remain scoped by SQL `owner_id`.
5. **No blind replay**: retain existing lease tokens and conditional writes, bounded 429/timeout retries and auto-PAUSED after five consecutive failures. Pausing a claimed monitor clears its lease and invalidates a stale worker's eventual response.
6. **No secrets in Android**: external GitHub traffic remains fixed-host read-only from Worker. The existing APK has no mobile OIDC sign-in, authenticated sync UI or operator token.

## Explicit caveats

- This is **fair per-owner selection across ticks**, not an SLA, exact round-robin scheduling over every individual monitor, or full global distributed-job coordination. A single owner with several due tasks gets one opportunity per tick. High due workload will delay tasks beyond their requested interval. Cron reentrancy and concurrent Worker invocations may update the last-owner cursor out of order, although per-monitor lease fencing still prevents stale result commits; exact fairness under multi-invocation contention requires separate adversarial tests and may justify transactional cursor reservation.
- `MOBILE_SCHEDULING_ENABLED='true'` is an **authorization flag for this bounded execution path**, not an assurance that remote Cloudflare Cron is deployed or delivering triggers. HTTP success, scheduled eligibility and provider-confirmed observations are separate.
- New account creation performs a D1 identity insert/read for valid signed tokens. The 20-user application cap is a conservative stop condition, not a production abuse-prevention suite. No public onboarding is approved.
- Mobile response `scheduled:false` remains a client-facing conservative non-claim. The separate `schedulerEligible` value reports only whether configuration and server row status permit a task to be selected.
- JWT/JWKS verified using synthetic cryptographic fixtures; no real Google/Firebase sign-in proof. Cloudflare D1 tested using local workerd, not provisioned Cloudflare remote, and no physical Android tests or RAM/battery measurements.
- The old single-owner operator path is preserved when the flag is absent. No unapproved provider write, payment, cloud provisioning, deployment, paid AI, or production automation was performed.

## Verification matrix (source SHA `1d7640417a7bbae9435098cd71fcc45c5418957a`)

- [Backend 33/33 tests + TypeScript](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265080): SUCCESS, including opt-in denial, cross-account status updates, 20/9 caps, fairness rotation, stale pause/in-flight responses and old-mode regression.
- [Local Cloudflare workerd/D1 5/5](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265299): SUCCESS, including persisted cursor recovery and owner fairness after a simulated runtime restart.
- [Read-only live GitHub GET via CI](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265084): SUCCESS, **not** proof of remote Cron.
- [Android real GitHub adapter in JVM CI](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265417): SUCCESS, not a physical device.
- [Android debug APK build](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265184): SUCCESS, not a release APK.

Earlier PR-head run `c7312e712f695283a1108f1ac73e7c5965690765` failed due to malformed route syntax; `1d764041...` corrected the route and passed. Preserve the failed CI in historical evidence. Five workflows on final PR HEAD `fa8471459ed7608fd6bf3f45d13cca74006851b5` succeeded. Merge SHA was confirmed, but a separate main-merge CI check and later ledger-only commits are not yet independently verified.

## Next steps

1. Real official OIDC Android provider configuration and eligibility verification, with token lifecycle and secure device storage.
2. Actual Android opt-in sync UI and error-state handling, preserving local drafts and last verified SHA.
3. Additional scheduler contention tests if multi-invocation workload warrants stronger fairness.
4. Owner-authorized Cloudflare Free account/limits/billing verification, disposable remote D1 Worker/Cron acceptance, then powered-off-Android proof with explicit task IDs and timestamps. Never silently enable production services.

## Exit criteria

Feature flag off => only legacy operator can run; feature flag on => mobile owners may be activated by their own verified credentials and receive at most three global GitHub GET attempts per tick, with durable per-owner rotation, no cross-user observation leak, and no fabricated success under timeout/pause. Claims must name CI SHA and test environment.


## Historical scope supplement: P1-H global quota (10 November 2026)

This ADR described the **P1-D** per-invocation limit and fairness cursor. P1-H adds [ADR-0009](0009-d1-global-cron-budget.md): a single D1-backed quota of **3 reserved GitHub provider attempts per fixed UTC 15-minute window**, shared by overlapping Cron invocations in **both** operator-only and mobile-enabled modes. It requires additive migration 0004 after migration 0003. The budget uses atomic SQL; the fairness cursor is still updated separately and exact overlapping remote fairness is not proved. This is a **source/local CI upgrade**, not a remotely deployed Worker or phone-off acceptance.
