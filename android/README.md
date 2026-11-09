# NARAYA Pocket Agent | Android P1-B GitHub Live Preview

This is a **native Kotlin + Jetpack Compose Android debug app**, providing a small manual read-only GitHub feature. It is **not** yet the cloud-connected autonomous agent.

## Actually usable in this stage
- Add, display and remove up to 20 public GitHub repository drafts.
- Tap **Check now** to request exactly one latest commit-head read from the official `https://api.github.com` endpoint. No user token required.
- Compare the received 40-character commit SHA to the previous saved snapshot and show baseline, unchanged, or changed state.
- Save SHA + timestamp locally using SharedPreferences. Reopening the app shows the last successful snapshot without internet.
- Existing P1-A repository drafts migrate automatically. Invalid cached records are skipped individually rather than erasing valid neighbors.
- Error paths: malformed upstream JSON, oversized body, GitHub rate-limit, 404, network timeout and offline access. On failure the previously saved SHA is preserved.
- All checks run on demand, using a coroutine IO dispatcher. **No periodic polling on Android, no background service, no cloud sync.**

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

## Next gate: server-authenticated cloud
The current Cloudflare Worker requires a high-authority **operator bearer token that must never be embedded in an APK**. Implement a genuine user identity verified server-side, scoped monitor ownership, and explicit consent before any Android-to-Worker writes. Real Cloudflare D1/Cron and phone-off autonomy remain [issue #2](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/2).

## P1-B source CI evidence (2026-11-10)

Source commit `d90887a3d407d5178368ce197bb99e6e8c84545a` passed **all 5 workflows**:
- [Backend offline tests + TypeScript](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086317): SUCCESS.
- [Local Cloudflare workerd/D1](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086457): SUCCESS.
- [Worker's official live GitHub GET](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086552): SUCCESS.
- [Native Android debug APK + unit tests + manifest permission gate](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086432): SUCCESS. APK SHA-256 `aefbceab40f1cf17c54a930cf682540d21f5d6766e0ea21a9562cdf6434d48ad`; [ephemeral artifact 13696608733](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086432/artifacts/13696608733), expires 16 November 2026 UTC.
- [Android GitHub adapter real network acceptance](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086200): SUCCESS; JUnit XML asserts **1 test executed, 0 skipped, 0 failed, 0 errors**.

This is CI at source SHA, not yet the merge SHA. **No physical Android, Cloudflare remote, powered-off device, RAM/battery benchmark, OAuth login, or cloud sync verified.**
