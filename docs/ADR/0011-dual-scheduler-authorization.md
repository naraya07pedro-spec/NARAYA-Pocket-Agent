# ADR-0011 | Dual permission and D1 readiness for mobile monitor activation

Date: 10 November 2026
Status: P1-J source implementation in PR #16, pending exact final-head CI and merge. Not deployed.

## Incident class: false-positive activation, caught by source audit before remote use

P1-I correctly prevented `worker.scheduled()` from performing any D1/provider I/O while global `SCHEDULER_ENABLED` was OFF. But `PATCH /v1/sync/monitors/{uuid}` and `schedulerEligible` still used only `MOBILE_SCHEDULING_ENABLED`. With global Cron OFF and mobile ON, a signed-in user could receive a **200 ACTIVE** response, and an existing ACTIVE monitor could be incorrectly advertised as eligible despite the operator's kill-switch. No real cloud instance was deployed, so this was a source-level inconsistency, **not a verified production incident**.

Another failure was possible if migrations 0003/0004 had not been applied: activation could return 200 even though `runScheduler()` would later fail closed because the global D1 budget authority did not exist.

## Implementation decision

1. New source module `worker/src/scheduler-eligibility.ts` provides one deterministic `mobileSchedulerConfigured(env)` predicate. It requires BOTH literal `SCHEDULER_ENABLED === 'true'` and `MOBILE_SCHEDULING_ENABLED === 'true'`, plus a valid `OWNER_ID` operator context. No truthy strings, whitespace normalization, or token-provided controls. This predicate is shared by mobile PATCH, status list views and identity capability reporting.
2. On `PATCH ACTIVE`, a missing/malformed flag or invalid operator context returns **409 `scheduler_disabled`** and does not touch the monitor row. The existing optimistic owner-ID/version and global 9-active limit remain in SQL.
3. When both flags are ON, `PATCH ACTIVE` now first reads `scheduler_control(id=1)` and validates the `budget_window_start` and `budget_claims` fields introduced in migrations 0003/0004. Missing table, missing control row, malformed budget state or D1 failure returns **503 `scheduler_storage_unavailable`** without modifying the monitor. No fallback to non-budgeted provider traffic.
4. `PATCH PAUSED` is always allowed to an authenticated, version-matching owner even if either scheduler flag or the D1 scheduler control row is absent. Stopping monitoring must not depend on permission to start it; the existing lease is revoked atomically by the monitor UPDATE.
5. List, idempotent retry and create response `schedulerEligible` is **false immediately** when global Cron is OFF, even for historical ACTIVE rows. The persisted ACTIVE row is not destroyed automatically; an owner can pause it. `scheduled:false` remains deliberately conservative: this product has no evidence that Cloudflare Cron has actually executed remotely.
6. Legacy `GET /v1/me` previously returned `capabilities.monitorSync:false` despite server-side sync APIs having existed since P1-C. It now returns `monitorSync:true` to describe **implemented backend API capability**, plus `mobileActivationConfigured` for the two gate flags/operator context. Neither field claims an approved deployment, live provider, current D1 health, hardware availability, or a successful Cron tick.
7. Offline preflight adds a source contract gate checking these shared predicates and the schema guard, plus adversarial tests that remove each guard to ensure CI fails. These static patterns are not a substitute for external security or live hardware tests.

### State contract

| Global Cron flag | Mobile permission | D1 budget control | User requests ACTIVE | Status eligibility | User requests PAUSED |
| --- | --- | --- | --- | --- | --- |
| OFF | ON | Any | 409 scheduler_disabled | false | allowed by owner/version |
| ON | OFF | Any | 409 scheduler_disabled | false | allowed by owner/version |
| ON | ON, but operator ID invalid | Any | 409 scheduler_disabled | false | allowed by owner/version |
| ON | ON | missing/unreadable migration | 503 scheduler_storage_unavailable | config flags alone may be true for historical ACTIVE rows; **not live proof** | allowed by owner/version |
| ON | ON | ready | owner/version/cap validation then HTTP 200 | true only for ACTIVE source configuration | allowed by owner/version |

Even a 200 ACTIVE ACK is a *backend configuration/ownership authorization*, **not** proof that a public Worker URL, Cron trigger, signed-in Google device or remote Cloudflare DB exists. Do not use these responses as production SLA or phone-off acceptance.

## Evidence and risk boundaries

- Synthetic RSA/OIDC Node tests: mobile ON/global OFF rejected without mutation; existing ACTIVE monitor loses advertised eligibility immediately on global OFF; PAUSE still works; a fresh ACTIVE request fails when D1 scheduler table/row is missing; `/v1/me` accurately distinguishes backend sync capability from activation configuration.
- Real local workerd/D1: HTTP requests from two distinct RSA-signed fixture identities create monitor, reject foreign owner operations, demand both flags, activate after D1 schema validation, invoke **actual Worker `scheduled()` entrypoint** with a synthetic GitHub provider fetch, persist BASELINE and allow PAUSE. This is more integrated than directly calling `runScheduler()`, but **still local**.
- Source static preflight confirms guard uses both flags and schema readiness; mutating those checks makes offline tests fail.
- Pilot quota and fairness established by P1-H remain independent. There is still a fixed 3-attempt-per-UTC-quarter-hour D1 budget, NOT a rolling 15-minute rate limit. Default Cloudflare Free CPU timing, actual account quota/billing, and overlapping real remote Cron calls are untested.
- The project did **not** register a Google OAuth app, deploy/migrate remote D1, authorize a real Cloudflare resource, handle a production ID token or run on a physically powered-off phone.

## Operational follow-up

After explicit account owner authorization, verify owner-controlled HTTPS Worker URL, Google OAuth issuer/audience/JWKS and Android package signing, D1 migrations 0001–0004 and the control row, then test a single signed-in monitor. The pilot MUST begin with **Cron global OFF, mobile OFF and zero triggers**, before separately authorizing activation and remote CPU/usage measurements. Real phone-off autonomy requires independent remote observation timestamps during a demonstrably powered-OFF device interval and post-restart Android sync.

[PROGRESS](../PROGRESS.md) · [EVIDENCE](../EVIDENCE.md) · [REMOTE_PILOT_READINESS](../REMOTE_PILOT_READINESS.md) · [Issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8)

Source and CI SHAs are entered only after final PR-head verification; the merge SHA is recorded separately after merge.
