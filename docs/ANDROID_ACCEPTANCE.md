# Android acceptance matrix | P1-K honest cloud scheduler status; physical device and remote Cloudflare still unverified

## P1-K Android cloud-state safety contract (source verified, physical device NOT TESTED)

**Current Android response behavior:** `CloudSyncClient` strictly requires server Booleans `schedulerEligible` and `scheduled`. PAUSED cannot claim eligibility/execution; ACTIVE can be a stored status while Cron is ineligible under a global kill-switch. Both local-draft cloud mapping and server-monitor listing now say **eligibility in the last successful snapshot**, not simply "ACTIVE means running." `scheduled:false` is a conservative server report; remote execution and a phone physically OFF remain unverified. Status changes advance only a matching row with exactly the next version and always clear any unverified scheduled state.

**Recovery:** a server HTTP **503 scheduler_storage_unavailable** yields a bounded, typed failure and an operator-actionable message to verify D1 migrations **0001–0004**; unknown/oversized error JSON cannot echo an upstream token. Valid server monitor interval **45 minutes** is now read correctly, while local draft presets remain intentionally limited. Old servers without mandatory flags will fail closed, not silently claim execution.

**CI evidence before final docs:** [Android debug build 42791519376](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42791519376), source `cc7c526965db60099b35326eadce4ccce8e69e8e`, **18/18 CloudSyncClient JVM security tests executed (0 failures/errors/skips)**, APK SHA256 `8a3bca16a885d8016d76ae305ee6acb09cb1575e6271f37191ffff0eaa212bdc`; [Node+preflight 42791519409](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42791519409) 59/59, [local workerd/D1 42791519518](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42791519518) 10/10; all 5/5 CI on that SHA. [ADR-0012](ADR/0012-android-cloud-truth-and-fail-closed-recovery.md).

**Still missing:** signed-in real Google account, deployed Cloudflare Worker/D1/Cron with account Free CPU/billing inspection, actual Android performance and physically switching OFF the phone while remote Cron checks GitHub and persists an observation. Debug APK has blank Worker origin and Google Web Client ID. No remote execution claim.

---

## P1-J signed-owner ACTIVE acceptance (source tested, real provider NOT VERIFIED)

The server now rejects a signed Android `ACTIVE` request if **global Cron OFF** or **mobile scheduling OFF**: HTTP 409 `scheduler_disabled`, no status or version change. When both are ON but the D1 budget row/table from migrations 0003–0004 is unavailable, HTTP 503 `scheduler_storage_unavailable` is returned, not a false 200 success. PAUSE remains possible under either failure. For a previously ACTIVE monitor, refreshing cloud GET while global Cron is OFF must yield `schedulerEligible:false` and preserve its last confirmed status.

**Local proof:** PR #16 initial source SHA `01da4689a6f0a2f01025f93fb5c6d2fa51c19ddc`, [Node 42787134336](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42787134336) **58/58 PASS**, [workerd/D1 42787134473](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42787134473) **10/10 PASS**, including two signed synthetic users, real `worker.scheduled()` with fake GitHub provider, observation read and PAUSE. This is NOT a real Google-issued ID token, remote Cron, physical Android install or phone-off measurement. [ADR-0011](ADR/0011-dual-scheduler-authorization.md).

---

## P1-I offline deployment guard, not Android-cloud completion

**Implemented and CI-tested:** The remote Worker code's `scheduled()` callback requires literal `SCHEDULER_ENABLED='true'` before it may query D1 or call GitHub. This is independent of signed-mobile `MOBILE_SCHEDULING_ENABLED` and prevents even legacy ACTIVE operator monitors running on an unapproved deployment. Local workerd/D1 tests assert a disabled Cron does not claim a lease, increment the quota or fetch GitHub.

**Preflight:** `npm run preflight` is a required offline code gate; its result is `source_safety: PASS` and `remote_readiness: BLOCKED`, not a deploy approval. `worker/wrangler.pilot.example.jsonc` is an invalid-ID/name **template** with a possible public route but NO Cron and two disabled scheduler flags. It must never be deployed as-is. Real Google OAuth registration, Cloudflare account plan/quota and CPU, physical Android installation and phone-OFF verification remain NOT_VERIFIED.

**Source proof on SHA `63a625128a9729aa4dbec85344af92a22935b1b5`:** [Node/source 42780576969](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42780576969) **53/53**, [D1 workerd local 42780576610](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42780576610) **10/10**, [Android APK/JVM 42780576952](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42780576952) **13/13 security tests**, plus real public GitHub local D1 and Android provider adapters SUCCESS. All figures are **CI, not hardware or remote-cloud acceptance**. Exact PR-head proof is recorded separately before merge.

Next actual acceptance steps are owner-approved Cloudflare/Google account setup, trusted Worker HTTPS host, signed-in real Android, remote D1 monitor and observation, controlled Cron activation, physical phone switch-OFF and post-restart reconciliation. See [REMOTE_PILOT_READINESS](REMOTE_PILOT_READINESS.md), [ADR-0010](ADR/0010-default-off-cron-release-gate.md), [Issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8).

---



## P1-F owner-scoped remote controls and server observations (10 November 2026)

**Implemented, source-CI verified:** 13/13 Android JVM security tests and 6/6 local workerd/D1 tests at PR #12 final HEAD `9bfb371520592ee5afa3297873a9a4b08a8d4c52`. These tests exercise signed two-user owner isolation, default-off scheduler, versioned PATCH, official GitHub read-only SHA baseline, owner observations, PAUSED fencing, invalid forged response rejection, typed 409 errors and fixed-path bounds. See [ADR-0007](ADR/0007-android-cloud-control-observation-evidence.md).

**Still required for real-device/cloud acceptance:** operator-verified Google issuer/audience/JWKS and Android OAuth signing configuration; trusted deployed HTTPS Worker and D1 with verified free-tier limits; one mobile account can sync, explicitly request activation, receive positive server ACK and authentic timestamps for observed baseline/change; another user gets 404 for foreign monitor; manual pause prevents new claims; expired token/401 clears state; network failure preserves cached local SHA; then physically power Android OFF, show independently timestamped remote Cron + D1 observations and inspect charges. No step in that sequence was performed on a real phone or remote Cloudflare in this PR. Do not claim measured battery/RAM or powered-off-device success until device test is actually executed.

---

## P1-E Android Google identity/cloud manual sync: new acceptance gates (10 November 2026)

**Source functionality**: explicit Credential Manager sign-in, ephemeral in-memory Google ID token, single-draft POST to fixed trusted HTTPS Worker and manual owner-scoped GET reconciliation. No token is stored locally; default APK has neither Web Client ID nor Worker origin, so cloud controls are disabled. See [ADR-0006](ADR/0006-android-google-identity-manual-sync.md).

**CI gates:** verify Android compile and APK, JVM `CloudSyncClientTest` (>=7 executed/none skipped), permission manifest check, existing official public GitHub adapter; backend OIDC and D1 regressions. These are **synthetic and JVM tests, not live OAuth**.

**Owner-authorized on-device tests remain REQUIRED:**
1. Configure a public Google Web OAuth client ID and Android package/signing certificate; confirm real issuer/audience signature at Worker. Do not ship any client secret or operator token.
2. Deploy Worker/D1 and migrations only after explicit approval and checking the actual zero-spend account limits. Confirm trusted HTTPS host and actual JWKS verifier before handing real ID token to that host.
3. Install the exactly hashed debug APK on a consenting Android; sign in using Credential Manager, confirm `GET /v1/sync/monitors` succeeds as that account, then send one explicit `POST`. Record a server monitor ID and version only if confirmed by Worker response.
4. Retry after a simulated timeout: same `clientDraftId` must map to same server monitor ID, not create another row; change content with same ID => conflict.
5. Sign out and restart app; token must not reappear from preferences and cloud state must not be fabricated. Re-sign in and retrieve the same server monitor; send a 401 and verify reauthentication.
6. Test airplane mode and provider error: previously verified offline SHA and local draft remain unchanged. Verify that "Remove local only" doesn't imply remote record deletion.
7. Prove a truly powered-off device and remotely scheduled D1/Cron separately using specific timestamps, owner ID (opaque), task IDs, log provenance and free-tier counters; never infer from successful CI.
8. Measure real startup, RAM/PSS, battery/thermal, crashes/ANRs on named Android model/OS; do not invent readings.

**Security and privacy:** no long-lived token storage or background login, no automatic cloud activation, do not paste any OAuth secret, client secret, Google API token or Cloudflare operator bearer in APK. The Google Web client identifier is public, not proof of authorized account. Record only redacted/nonsecret evidence.

---


## P1-B functionality (Android debug APK)
A native Kotlin/Compose screen creates, lists, and removes up to 20 public repository drafts. A user pressing **Check now** triggers one official public GitHub HTTPS GET, validates commit SHA, and stores last successful SHA + timestamp offline. Version-tolerant cache decoding retains P1-A drafts. No user login, cloud control, AI, notifications, or background automation exists.

## Evidence gates
1. **JVM deterministic tests:** repository slug validation; bounded response streams; GitHub HTTP status / error handling; malformed data; cached record migration; corrupt neighbor isolation. See `GithubHeadClientTest`, `DraftCodecTest`, and `RepoRulesTest`.
2. **JVM live-provider path:** the exact Android GithubHeadClient's HTTP transport reads a real public GitHub commit and checks the SHA against an independent official GitHub branch-ref GET. This is a JVM network test, **not an Android device test**. Workflow verifies the test was not skipped.
3. **Debug APK build:** JDK 17 / AGP 9.2.1 / SDK 37.0 / Gradle 9.4.1. GitHub Actions creates debug-signed APK, inspects the manifest to confirm INTERNET permission and reject unnecessary sensitive permissions, records SHA-256, then uploads a temporary artifact.
4. **On-device functional acceptance (NOT VERIFIED):** install APK, add repo, live refresh, force-stop app, restart offline and validate last persisted SHA/date, trigger network failure and verify last snapshot remains; check version upgrade from P1-A draft storage.
5. **Performance (NOT MEASURED):** actual Android device model, OS, total RAM, APK SHA-256 and workload; idle/active PSS and app start latency via `adb shell dumpsys meminfo dev.naraya.pocketagent`, repeated attempts and battery/thermal notes. No fabricated measurements.
6. **Cloud autonomy (NOT VERIFIED):** owner-approved remotely deployed Cloudflare D1/Worker/Cron must continue working independently while device is powered off, then resync only after proper user identity is built.

## Device operator commands (consented test hardware only)
```sh
adb shell am force-stop dev.naraya.pocketagent
adb shell monkey -p dev.naraya.pocketagent 1
adb shell dumpsys meminfo dev.naraya.pocketagent
```

**Important:** manual GitHub preview uses the phone's network and therefore cannot operate while that phone is powered off. Only future cloud-side jobs will be able to continue while it is off.

## Security constraints
Never add `OWNER_API_TOKEN` or private provider secrets to the mobile app. Direct GitHub preview supports only public repositories and uses no authorization. Cloud writes require issuer/audience/expiry/signature-verified end-user identity, server-owned authorization policies, and sensitive action approval independent of client UI.

## P1-B source CI evidence (2026-11-10)

Source commit `d90887a3d407d5178368ce197bb99e6e8c84545a` passed **all 5 workflows**:
- [Backend offline tests + TypeScript](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086317): SUCCESS.
- [Local Cloudflare workerd/D1](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086457): SUCCESS.
- [Worker's official live GitHub GET](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086552): SUCCESS.
- [Native Android debug APK + unit tests + manifest permission gate](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086432): SUCCESS. APK SHA-256 `aefbceab40f1cf17c54a930cf682540d21f5d6766e0ea21a9562cdf6434d48ad`; [ephemeral artifact 13696608733](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086432/artifacts/13696608733), expires 16 November 2026 UTC.
- [Android GitHub adapter real network acceptance](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086200): SUCCESS; JUnit XML asserts **1 test executed, 0 skipped, 0 failed, 0 errors**.

This is CI at source SHA, not yet the merge SHA. **No physical Android, Cloudflare remote, powered-off device, RAM/battery benchmark, OAuth login, or cloud sync verified.**
