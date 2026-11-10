# Android acceptance matrix | P1-A history + P1-B active

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
