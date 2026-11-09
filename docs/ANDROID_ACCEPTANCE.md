# Android P1-A experimental acceptance

## What the native APK can actually do
Open a Kotlin/Jetpack Compose screen; validate a public GitHub owner/repository slug; choose 30, 60 or 120 minutes; persist up to 20 local drafts; display and remove them. A fresh app launch reads drafts from Android SharedPreferences. None of these drafts is an active remote monitor.

## Verification gates
1. **Source/config present:** `android/app/src/main`, Gradle files, Android manifest without INTERNET permission, RepoRules and DraftStore.
2. **JVM unit tests:** `:app:testDebugUnitTest` tests repository validation.
3. **APK build:** `:app:assembleDebug` produces debug-signed APK. Must link an exact CI run and commit SHA.
4. **Device acceptance (not yet verified):** install the APK on a consenting, non-sensitive Android test device. Create a draft, force stop app, reopen, confirm same state. Delete draft and reopen.
5. **Security:** inspect APK permissions and artifacts; verify no owner bearer token, cloud provider API key, or permission grants network access.
6. **Performance (not yet verified):** record Android device model, RAM, OS, APK SHA-256, PSS, startup latency, battery impact, and crash/ANR counts. Do not invent values.

## Limitations
No cloud sync, no sign-in, no agent autonomy, no approval flow, no AI, no provider write, no background tasks, and no proof of continued operation while Android is powered off. Only the cloud runtime is intended to work while the device is off, after a future owner-approved deployment.
