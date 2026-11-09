# NARAYA Pocket Agent | Android P1-A offline pilot

This is a **real native Android app source**, not the cloud agent or a connected Android client. It deliberately has **no INTERNET permission**, no provider token, no login, no AI model, no foreground service, and no background task.

## Functional scope
- Kotlin + Jetpack Compose UI for creating/listing/deleting public GitHub repository-monitor **drafts**.
- Strict owner/repo validation with unit tests.
- Up to 20 drafts saved synchronously to Android SharedPreferences; restored after process restart.
- Explicit truthful status on every card: DRAFT ONLY, no cloud scheduling or sync.
- No personal/customer data or API secrets. Do not store anything sensitive in these unencrypted drafts.

## Reproduce
Use Android Studio with JDK 17, Android SDK Platform 37.0 (SDK Manager: `platforms;android-37.0`) and Gradle 9.4.1. Open the `android/` subproject, then run `:app:testDebugUnitTest` and `:app:assembleDebug`.

The [Android CI workflow](../.github/workflows/android.yml) uses a clean Ubuntu runner, official Android SDK components, pinned AGP 9.2.1 and Gradle 9.4.1, and uploads the debug-signed test APK (not a production/release signature) as a limited-retention artifact. A passing build is not owner-device acceptance or a measured low-RAM claim.

## Security and next gate
The current Worker uses an owner-only bearer token. **Never copy it to Android**. Before remote sync, implement OIDC/Firebase user authentication and server-side verification, with scoped user records and approval controls. For this milestone, Android does not request network access.
