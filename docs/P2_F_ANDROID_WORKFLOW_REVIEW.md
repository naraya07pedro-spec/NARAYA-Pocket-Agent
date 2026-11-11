# P2-F | Android human-review UI for synthetic tasks and approvals

**Development milestone.** Until exact CI from PR HEAD and merged `main` is available, treat this as implementation under test. The debug APK remains **unconfigured** by default for Google OAuth/Cloudflare Worker. This does **not** certify remote account deployment, Google live sign-in, production CRM, or physical phone-OFF operation.

## Functionality linked to the existing backend

The Android app now mounts `WorkflowReviewPanel` **only after an explicit Google sign-in** in `MainActivity`, and only when both public OAuth Web client ID and exact HTTPS Worker origin are configured. The user’s ID token remains **RAM-only** in the preexisting `EphemeralIdToken`. Logging out removes the panel; an unauthorized backend response clears the local session and cloud state.

The new `WorkflowReviewClient` uses bounded HTTPS requests, redirect-disabled `HttpURLConnection`, a strict **method/path/UUID allowlist**, 6-second timeouts, 16 KB maximum UTF-8 reply, 4 KB maximum JSON request, and only the configured exact Worker origin. No API token, refresh token, provider credential, arbitrary URL, Task/WorkManager, background scheduler, or long-lived local task cache is added.

All mutations require an explicit tap, and **approval, denial, cancellation and one-time D1 simulation require a confirmation dialog**. No polling or implicit submit is triggered by simply opening the screen.

### User flow

1. **Muat workflow dari server** explicitly calls the signed owner-scoped P2-B/P2-C/P2-A/P2-D GET endpoints for typed leads, tasks, approvals, and effect intents. A malformed or incomplete batch never becomes a verified snapshot.
2. **Buat lead + task sintetis** creates a test-only typed lead with a UUID, category (`SIGNAGE`, `INTERIOR`, `EXHIBITION`), budget `UNKNOWN` and deadline 30 days; then creates a P2-C task with a **separate fixed UUID**. The same UUIDs remain in memory after a network error so retry of the two POSTs does **not** generate fresh business records. The backend retains the ultimate idempotency constraints. **No PII or real customer data.** Existing registered-user onboarding is required.
3. **Jalankan 1 step manual** calls P2-C POST `advance` with exact `expectedVersion`. **Batalkan task** calls versioned `cancel` after dialog confirmation.
4. **Buat approval sintetis** is shown only for a `SUCCEEDED` task and owned typed lead whose service code is visible in the current snapshot. The client constructs a **deterministic task-bound approval idempotency key** and submits only the fixed `SYNTHETIC_ONLY/CREATE_CRM_LEAD/synthetic-crm` operation with the matching task/lead/category. Backend independently verifies and binds hashes/task version.
5. **Setujui/Tolak** buttons appear only for a matching effect/approval ID and exact payload/target SHA-256 digest. The confirmation dialog shows the relevant short IDs, hashes, version and a clear statement that approval remains `APPROVED_NO_DISPATCH`, **not an external CRM write**.
6. **Baca status simulasi D1** is read-only. **Simulasikan 1 efek D1** requires another confirmation and can only make one synthetic provider receipt (P2-E); no real provider. **Rekonsiliasi tanpa retry** is only available for `UNKNOWN_OUTCOME` or `IN_FLIGHT`, with a strict `safeToRetry=false` validation. There is **no UI for blind retry**.

No local optimistic claims: an acknowledged action is followed by a fresh signed multi-endpoint server read before the app describes the list as current. Failed reads clear the verified snapshot and tell the user the final state is unconfirmed. A lost HTTP acknowledgement is never assumed to be a failed remote commit, and the user must first explicitly refresh.

### Android and backend boundaries

- `MainActivity.kt` still houses the original manual GitHub monitor and optional cloud monitor. P2-F is an additional Compose panel, not a replacement of the existing safety/monitor capabilities.
- New Kotlin JVM tests check route allowlists, OAuth-token shape, exact-origin restriction, request payloads, task-version CAS, approval digest binding, forged response fields, stale statuses, typed `202 UNKNOWN_OUTCOME`, and response/error redaction. The CI must still compile the full Android app and run all JVM tests.
- Backend schemas and routes are not changed by P2-F. User interaction is not autonomous background execution.
- This still requires **a personally authenticated Cloudflare account, verified free/billing/quota gates, owner-approved Worker/D1 deployment and migrations, valid Google OAuth public client IDs, signing certificate registration, and a real physical Android login** before there is evidence of remote access. Then phone physically OFF with server logs should be measured separately.

**Current remote status:** `BLOCKED`, `safe_to_deploy=false`, `safe_to_activate_scheduler=false`; this PR does **not** enable Cron or contact any external provider.

Related: [P2-E synthetic reconciliation](P2_E_SYNTHETIC_RECONCILIATION.md), [P2-D effect intent](P2_D_TASK_BOUND_EFFECT_INTENTS.md), [cumulative project progress](PROGRESS.md) and [owner acceptance issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8).
