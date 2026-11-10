# NARAYA Pocket Agent | Android P1-F opt-in Google identity, monitor controls and observations

This is a **native Kotlin + Jetpack Compose pilot**, with public read-only GitHub preview and an optional **explicit** signed-in cloud draft sync. **Default CI APK has cloud controls disabled** because no Google Web Client ID and no Cloudflare Worker origin are configured. No real Google auth, real Cloudflare backend, or powered-off phone test has been demonstrated.

## P1-F implemented in Android source (merged PR #12; remote not deployed)

- `Request cloud activation` and `Pause cloud monitor` are user-initiated authenticated PATCH requests. Client requires the correct owner-monitor ID, requested state, server version increment and eligibility flag before displaying any change. On stale version or server-disabled scheduler, it **does not** pretend activation succeeded.
- Explicit `Read server observations` queries the owner-scoped Worker `GET /v1/sync/observations?monitorId=UUID`, validating 50-record maximum, matching owner-monitor UUID, 40-character Git SHAs and event semantics. UI displays the most recent five events as **server-reported evidence**, not measured Android device-off execution.
- Fixed HTTPS origin, strict route/method allowlist, rejected redirects, bounds on bodies and strictly allowlisted 409 reason codes. Neither user token nor raw error body appears in UI/logs. 401 wipes in-memory auth and cloud evidence.
- The Android code has no auto background work; the server must separately opt into `MOBILE_SCHEDULING_ENABLED='true'` before an ACTIVE request can succeed. Default APK has no OAuth Web Client ID or Worker origin and therefore no active controls.
- **CI verified:** [final PR-head Android run 42765189002](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42765189002), `CloudSyncClientTest` **13 tests executed, 0 failures/skips/errors**, debug APK SHA-256 `095d69e1f8edd11fe3e56cec33730c9871980ab8ddecb5705c52b46e0729ab8a`. [Local D1/workerd run 42765188864](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42765188864) **6/6 PASS** including cryptographically signed two-user activation→observation→pause. This is not a physical device or remote Cloudflare proof.

See [ADR-0007](../docs/ADR/0007-android-cloud-control-observation-evidence.md) and [latest evidence](../docs/EVIDENCE.md).

## P1-E implemented in Android source

- Explicit Google Credential Manager sign-in using `GetSignInWithGoogleOption`. Google ID token exists only in RAM (ephemeral app session), never in SharedPreferences, logs, resources, or BuildConfig.
- Explicit one-draft-at-a-time upload to the configured Worker: `POST /v1/sync/monitors` with the existing draft's stable UUID, repository and interval. This uses a short-lived Google ID token as a bearer, **not** the high-authority operator API token.
- Explicit `GET /v1/sync/monitors` to reconcile the server-confirmed state after login. On loss of network, no cloud success is fabricated, and local verified SHA/drafts are unchanged.
- Fixed build-configured HTTPS origin (no arbitrary URL input), redirects refused, response bounded at 16 KiB and requests at 4 KiB, 6s connect/read timeouts, token-shaped string validation on client, **cryptographic signature verification remains on server**.
- Manual logout and 401 clear app-memory bearer/session state. Google Credential Manager state clearing is best-effort. No silent refresh or background sign-in.
- New cloud monitors are **PAUSED by default**; this milestone has no mobile activation control. A cloud event while the phone is off is not proven.
- "Remove local only" cannot delete or pause any separate cloud monitor. This limitation is disclosed in UI.

## Build configuration (PUBLIC identifiers only)

Requires the Google OAuth Web Client ID whose audience is configured as the backend's `OIDC_AUDIENCE`, and a trusted HTTPS origin for the deployed Worker. For a controlled development build only:

```shell
gradle --project-dir android :app:testDebugUnitTest :app:assembleDebug \
  -PnarayaGoogleWebClientId='<PUBLIC_GOOGLE_WEB_CLIENT_ID>' \
  -PnarayaApiOrigin='https://<OWNER_CONTROLLED_WORKER_HOST>'
```

The default CI build supplies **neither property**. Both build-time values are **public identifiers**, but a malicious worker host can receive the user's Google token, so confirm domain control before configuring or distributing an APK. **Never put Google client secrets, OAuth access/refresh tokens, Cloudflare admin API tokens, or `OWNER_API_TOKEN` in Gradle props or APK.** The Google project must separately configure the Android package `dev.naraya.pocketagent`, app-signing certificate SHA fingerprint and Web Client ID. No Google/OIDC setup was performed in this PR.

**Library choices:** `androidx.credentials:1.6.0`, `credentials-play-services-auth:1.6.0`, `googleid:1.1.1`. The newer `googleid:1.2.1` failed Kotlin metadata validation with the existing compiler; tests were re-run with the compatible version, without bypassing metadata validation.

## Android and backend boundaries

The backend `POST/GET /v1/sync/monitors` is implemented and locally tested separately. It requires valid signed OIDC identity, owns every user mapping, deduplicates client drafts and limits monitors per owner. Client token shape alone is **NOT** proof of a genuine Google identity. The Android app may only claim a successful cloud mapping if a matching server response was actually received. No remote Cloudflare deployment, real token, or physical device is certified.

See [ADR-0006](../docs/ADR/0006-android-google-identity-manual-sync.md), [Android acceptance](../docs/ANDROID_ACCEPTANCE.md), [Evidence](../docs/EVIDENCE.md), and [Progress](../docs/PROGRESS.md).

---

## P1-B historical offline/manual GitHub feature (retained)
- Add, display and remove up to 20 public GitHub repository drafts.
- Tap **Check now** to request exactly one latest commit-head read from the official `https://api.github.com` endpoint. No user token required.
- Compare the received 40-character commit SHA to the previous saved snapshot and show baseline, unchanged, or changed state.
- Save SHA + timestamp locally using SharedPreferences. Reopening the app shows the last successful snapshot without internet.
- Existing P1-A repository drafts migrate automatically. Invalid cached records are skipped individually rather than erasing valid neighbors.
- Error paths: malformed upstream JSON, oversized body, GitHub rate-limit, 404, network timeout and offline access. On failure the previously saved SHA is preserved.
- All checks run on demand, using a coroutine IO dispatcher. **No periodic polling on Android or background service. Cloud sync requires the separate P1-E opt-in flow and is disabled in the default build.**

## Resource/security bounds
- Max 20 local drafts; 32,768-byte maximum GitHub body; 6s connect and 6s socket read timeouts (not an absolute request deadline).
- GitHub hostname hardcoded in source and checked by the HTTP transport; redirects disabled, HTTPS only, GET only, and no tokens/third-party writes.
- Android manifest requests **INTERNET** for this feature, but no location, contacts, microphone, SMS, or broad application-access permissions.
- Public repository names and commit snapshots are saved locally; GitHub sees the network IP and target public repository when `Check now` is pressed.
- Local SharedPreferences is **not claimed to be encrypted**. Do not enter confidential material or private repo credentials.

## Build and test
Use JDK 17, Android SDK Platform 37.0 (SDK package `platforms;android-37.0`), Gradle 9.4.1 and AGP 9.2.1. In `android/`:

```sh
gradle :app:testDebugUnitTest :app:assembleDebug
```

[Android CI](../.github/workflows/android.yml) builds/debug-signs APK, runs JVM tests, inspects actual APK permissions and uploads a seven-day artifact. [Separate live GitHub JVM adapter CI](../.github/workflows/android-provider-live.yml) makes real official read-only GitHub calls and corroborates SHA against an independent official branch ref; the live test must **execute, not silently skip**.

The GitHub artifact is a **debug-signed development APK**, not an Android production-signed release. CI runs under a JVM/Android build runner, not on a physical Android phone.

## Device acceptance (still required)
Install the debug APK on a consenting Android device. Add a public repository, use `Check now` while online, note last SHA/timestamp, force-stop the app, reopen without internet, verify snapshot remains, return online, and confirm failure messages keep the previous snapshot intact. Record APK SHA-256, device model/OS/RAM and actual PSS/thermal/battery readings before making efficiency claims.

## Historical P1-B next gate, superseded by P1-E

At the P1-B checkpoint, only an operator-token API existed; since PRs #7/#9/#10 the server supports signed-user OIDC checks, owner-scoped draft synchronization and feature-gated multi-user scheduling, with the operator path kept separate. PR #11 adds Android source for Google sign-in and explicit sync. **Real Google sign-in and remotely deployed Cloudflare are still unverified**, so no powered-off-phone monitoring is claimed. See [issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8) and [issue #2](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/2).

## P1-B source CI evidence (2026-11-10)

Source commit `d90887a3d407d5178368ce197bb99e6e8c84545a` passed **all 5 workflows**:
- [Backend offline tests + TypeScript](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086317): SUCCESS.
- [Local Cloudflare workerd/D1](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086457): SUCCESS.
- [Worker's official live GitHub GET](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086552): SUCCESS.
- [Native Android debug APK + unit tests + manifest permission gate](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086432): SUCCESS. APK SHA-256 `aefbceab40f1cf17c54a930cf682540d21f5d6766e0ea21a9562cdf6434d48ad`; [ephemeral artifact 13696608733](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086432/artifacts/13696608733), expires 16 November 2026 UTC.
- [Android GitHub adapter real network acceptance](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086200): SUCCESS; JUnit XML asserts **1 test executed, 0 skipped, 0 failed, 0 errors**.

This is CI at source SHA, not yet the merge SHA. **No physical Android, Cloudflare remote, powered-off device, RAM/battery benchmark, OAuth login, or cloud sync verified.**
