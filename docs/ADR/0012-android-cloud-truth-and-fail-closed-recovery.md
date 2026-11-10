# ADR-0012 | Android cloud status must distinguish stored ACTIVE from eligible or executed

Date: 2026-11-10
Status: P1-K implementation in PR #17. Source/local CI in progress; no deployment or physical device acceptance.

## Source-verified discrepancy

P1-J updated `mobileSync.syncView` so owner-scoped `GET/POST` JSON included `schedulerEligible` (affected by the global and mobile Cron flags) and conservative `scheduled:false`. However Android `CloudSyncClient.parseMonitor()` silently **ignored both** and `MainActivity` displayed only `Server status: ACTIVE`. After the operator turned off global Cron, a previously ACTIVE monitor could still look live on the phone, even though the backend no longer permitted work.

The Android client also collapsed the specific P1-J `503 scheduler_storage_unavailable` (missing D1 0004 scheduler budget) into generic UNAVAILABLE. A misleading “active” label and nonactionable error are unacceptable at the exact boundary between device and remote execution.

An additional contract mismatch existed: backend `parseMonitorInput()` permits intervals **30–1440 minutes in steps of 15**, while Android's cloud response reader accepted only 30/60/120/240/1440, rejecting a legitimate server-created monitor with interval 45.

## Decision

1. **Strict server assertions:** `CloudMonitor` stores `schedulerEligible:Boolean` and `scheduled:Boolean` from the verified server's last HTTP response. Both flags are **mandatory real JSON Booleans**. Missing fields, string-coerced values, PAUSED+eligible/“scheduled” contradictions and scheduled=true with eligibility=false cause `INVALID_SERVER_RESPONSE`. No default is invented to claim task execution. All cloud GET and idempotent POST responses use this parser.
2. **Honest Android presentation:** display the persisted `ACTIVE/PAUSED` status separately from last-server-snapshot scheduling eligibility, and separately from *independently verified* off-device execution. Both cloud monitor listing and mapped local draft display the distinction. `ACTIVE` with `schedulerEligible:false` must say the scheduler is **ineligible/OFF in the last snapshot**, not “running.” `ACTIVE` with `schedulerEligible:true` remains **configuration-eligible, execution unverified**; even `scheduled:true` would only be a server report, not a physical phone-OFF proof.
3. **Version-fenced UI reconciliation:** `CloudMonitor.withConfirmedStatus()` only updates an identical monitor ID with exactly the next server version, a valid different status, and an eligibility value consistent with the new status. A confirmed PAUSE immediately clears eligibility. A confirmed activation does **not** make `scheduled:true`. Rejected or conflicting responses do not advance local state. Network failures retain the last confirmed snapshot, explicitly labeled as non-live.
4. **Specific fail-closed recovery:** `WorkerSyncTransport` reads bounded **409 and 503 error bodies**, max 2 KiB, fatal UTF-8 decoding and no redirects. `exchange()` only maps the exact server-owned `scheduler_storage_unavailable` string from 503 to the typed `SCHEDULER_STORAGE_UNAVAILABLE` failure; all unknown, missing or overlong 503 bodies remain generic UNAVAILABLE. Android displays “No task was activated; operator must check migrations 0001–0004” without printing raw upstream JSON, credentials, tokens or internal D1 messages.
5. **Schema interval compatibility:** incoming server monitors accept all backend-valid **30–1440 minutes in multiples of 15**. The simple local draft creation UI intentionally retains its existing subset of preset intervals; no surprise new remote scheduling option is exposed.
6. **Regression controls:** five additional Kotlin JVM tests (13→18) cover required strict flags, ACTIVE but global-off semantics, typed bounded 503, backend-valid interval values, and guarded status transitions. An offline preflight source gate requires the truthful summary in **both** Android UI placements, strict flag parsing, D1 failure typing and the version-fenced update. A mutation test deliberately removes these invariants. Android APK build and native provider adapter CI must both pass on the final PR head.

## Verification boundaries and important caveats

- Source/test fixtures use a fake `SyncTransport` and synthetic server JSON. Cloudflare workerd/D1 and backend tests remain separate CI gates; they do NOT prove that the newly changed UI was installed or rendered on a physical Android device.
- A future server that does not send both scheduling flags will now be rejected rather than silently classified, even if an older backend exposed similar monitor fields. This is intentional *fail-closed* version coupling for this pilot; compatibility/version-negotiation can be added when there are verified deployed versions.
- In the current backend `scheduled:false` is conservative and intentionally always false, since the project has no independent deployed-Cron proof. Android must not label a successful ACTIVE status mutation as phone-off execution.
- A successful server response can become stale milliseconds later. The UI explicitly labels it the **last server snapshot**, not an up-to-the-second distributed state.
- The debug APK has empty Web Client ID and Worker origin by default. A built APK and JVM tests cannot substantiate real Google OAuth, server deployment, Free CPU usage, battery performance or the phone-powered-OFF requirement.
- No owner account or remote Cloudflare Worker/D1/Cron was provisioned, no secret was created/transmitted and no paid service or external provider write occurred.

## Recorded CI / corrective history

PR #17 early implementation SHA `0893f990b3e20a3c5acf6f1021b5ef301c9ec839` passed five workflows with Android **18/18 security tests**; following static preflight addition SHA `162e6bdea6016136603227d0584e030f26d4969f` failed **one of 59 Node source tests** because the mutation test removed one of two UI truth-summary sites while the static checker only required at least one. This was a *test-coverage bug*, not evidence that Android unit security tests failed. Correction `cc7c526965db60099b35326eadce4ccce8e69e8e` requires both UI sites and is rechecked in CI. The exact final PR-head success result and merge SHA must be recorded separately after completion.

[PROGRESS](../PROGRESS.md) · [EVIDENCE](../EVIDENCE.md) · [ANDROID_ACCEPTANCE](../ANDROID_ACCEPTANCE.md) · [REMOTE_PILOT_READINESS](../REMOTE_PILOT_READINESS.md)
