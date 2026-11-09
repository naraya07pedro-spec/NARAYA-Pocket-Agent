# Android acceptance matrix | P1-A history + P1-B active

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
