# ADR-0007: Explicit Android cloud control and server-only observation evidence

Date: 2026-11-10
Status: IMPLEMENTED in PR #12, CI_VERIFIED_LOCAL candidate; no remote Cloudflare, genuine Google login or device-off acceptance.

## Context

P1-E Android supported signed-in draft upload and server-state reconciliation but could not request ACTIVE/PAUSED on server-owned monitors or read the observations recorded by the scheduler. The backend already exposes `PATCH /v1/sync/monitors/{id}` and `GET /v1/sync/observations?monitorId={id}`, protected by RS256 OIDC and owner-scoped D1 queries. Without Android controls, activating and suspending remote monitoring required a separate API client.

## Implemented decision

1. Extend **only** the existing fixed HTTPS Worker transport. Allowed paths and methods are enumerated: `GET /v1/sync/monitors`, `POST /v1/sync/monitors`, `PATCH /v1/sync/monitors/{UUID}`, and `GET /v1/sync/observations?monitorId={UUID}`. Disallow arbitrary URLs, query extras, redirects, non-UUIDs, insecure transport and operator tokens. Never enable background polling or auto-activate a monitor.
2. Explicit user tap to activate/pause. Submit strictly `{"status":"ACTIVE"|"PAUSED","expectedVersion":currentServerVersion}` with a short-lived, RAM-only Google ID token, never `OWNER_API_TOKEN`. Require HTTP 200 and validate ACK `id`, `status`, exact incremented `version`, and `schedulerEligible` before updating the UI's in-session server snapshot. HTTP 409 means **no proven change**; do not optimistically update.
3. Only a signed owner can retrieve observations for that monitor. Parse a bounded, typed list of up to 50 events, requiring a matching monitor UUID, event UUID, `BASELINE` with no previous SHA or `CHANGE` with previous SHA, 40-char lowercase Git SHAs, positive timestamps and descending ordering. Display up to 5 recent events with the source-of-truth caveat.
4. On 409, read only a 2 KiB bounded error response and map allowlisted server codes `scheduler_disabled`, `stale_version`, `active_monitor_limit`; all other/untrusted content stays generic `CONFLICT`. Never echo server bodies, bearer tokens or raw exception strings to the user. On 401 clear signed-in session, cloud rows and observation state.
5. The backend's `MOBILE_SCHEDULING_ENABLED` remains **unset/OFF** in all unprovisioned configurations. The Android activation button cannot bypass this flag; until the actual operator approves and configures the server, it is rejected. `schedulerEligible:true` is an eligibility ACK only, **not** proof of Cron execution, provider access or phone-off autonomy.
6. PAUSED action invalidates a leased worker via server-side lease fencing. Events recorded before PAUSE remain available. A failed GET does not create or overwrite local GitHub snapshots or observations. Local draft deletion is still local-only and cannot delete a cloud monitor.

## Verification boundaries

- **Android JVM deterministic security tests:** fixed-route allowlist; 409 error sanitization; invalid and cross-owner events; mismatched or forged status ACKs; per-monitor identity; retry/expiry failure, and no developer secret defaults. CI must require 13 executed (0 skipped, failures, errors). These are JVM tests with fake transport responses, not actual Android UI automation.
- **Cloudflare local workerd/D1 integration:** genuine generated RS256 JWT fixtures and fixed JWKS; two distinct identities; default-off activation failure, foreign-user 404, ACTIVE with explicit gate, GitHub SHA baseline through `runScheduler`, owner-scoped event read, stale ACK rejection, and PAUSE. These are local workerd tests, not remote Cloudflare.
- **No real Google OAuth credentials or Web Client ID** in the checked-in APK. Worker domain/remote D1 and Google issuer/audience verification on live tokens are not proven. No physical Android, live Cron, phone-off execution, RAM/battery measurements, or account billing verified. See issues #8, #5 and #2.
- Fairness under genuinely concurrent remote Cron triggers, JWKS caching/rotation, and actual account quotas need further work. Existing bounded scheduler tests do not establish external availability or timing SLA.

## Failure modes and instructions

- `SCHEDULER_DISABLED`: operator feature flag OFF. Do not repeatedly retry activation; ask for verified remote provisioning/permission.
- `STALE_VERSION`: status changed in another client or through scheduler. Refresh server monitor snapshot before retrying.
- `ACTIVE_LIMIT`: global mobile ACTIVE budget exhausted; no automatic eviction or hidden scheduling allowed.
- `UNAUTHORIZED`: discard in-memory token; Google reauthentication required. 
- `NOT_FOUND`: server hides foreign/non-existent UUIDs; never infer another owner's existence.
- `NETWORK_ERROR` / malformed response: keep prior confirmed UI and local draft unchanged; do not invent events.
- Pausing a server task does not erase past observations. Activation may trigger real GitHub GET costs **only after** owner-approved remote deployment and feature flag enablement.

## Evidence ledger

See [PROGRESS](../PROGRESS.md) and [EVIDENCE](../EVIDENCE.md) for exact source and workflow SHAs, including failing runs if any. The source logic is available in `CloudSyncClient.kt`, `MainActivity.kt`, `CloudSyncClientTest.kt` and `tests/cloudflare-local.test.mjs`.

## Exit criterion

Only claim local implementation after passing source CI on exact PR HEAD. Claim *live cloud function* only after operator-approved deployed Worker, real Google ID token, owner-scoped request/response IDs, authenticated observations, free-tier counter evidence and a phone physically switched off. Do not confuse passing local D1 tests with a live cloud agent.
