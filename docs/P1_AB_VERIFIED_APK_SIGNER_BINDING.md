# P1-AB | Bind the produced Android APK to the owner's actual signing certificate

**Scope:** developer/debug APK integrity and signing continuity only. **No Google login, remote Cloudflare, real Android device, release signing or production distribution was performed.**

## Why P1-AA needed a stronger check

P1-AA checked that the owner's private local debug keystore still produced the same **public certificate** before and after Gradle. A build artifact could still have been unsigned, signed by another certificate, or built for a different Android application package. Merely comparing hashes of the keystore would not detect any of those failures.

P1-AB additionally verifies the **actual compiled APK file**:

1. Official Android SDK Build Tools **36.0.0** `apksigner.jar`, invoked using the installed JDK through `java -jar`, must exit successfully for `verify --verbose --print-certs --min-sdk-version 26 app-debug.apk`.
2. The resulting verifier report must say **exactly one signer** and v2 APK signature scheme verified (required to support the current minimum API 26). It must contain exactly one well-formed SHA-1 and SHA-256 **signing certificate** digest for that signer.
3. **Owner-local `--build` only:** both APK certificate digests must match the **owner's pinned local debug keystore certificate**. A different cert is rejected. **CI `--verify-apk` does not have a stable owner key** and therefore verifies the real APK's signature and package but emits `certificate_matches_owner_keystore=NOT_CHECKED_NO_OWNER_KEY`, never claiming owner-key continuity.
4. Official Android Build Tools `aapt dump badging` must confirm the package is exactly `dev.naraya.pocketagent`.
5. Any missing SDK utility, malformed/ambiguous output, nonzero verifier exit, extra signer, wrong package, mismatch, or missing APK **blocks success**. The script does not sign/modify the APK or install it. It emits a local artifact SHA-256 only after passing these checks.

The new `--verify-apk` entrypoint does **not** require an owner pin or keystore. GitHub CI does not promise that an ephemeral debug keystore exists at `~/.android/debug.keystore`; the APK is cryptographically verified directly, and its public cert SHA-1/SHA-256 are reported **without** a key continuity claim. Local user-approved `--build` still requires the long-lived owner-local pin first.

## Commands from the repository root

```powershell
# Offline read/check on your own trusted machine after an Android debug build:
npm run android:verify-apk

# P1-AA flow for stable owner-only pilot, already documented:
npm run android:owner-inspect
npm run android:owner-bootstrap
npm run android:owner-pin
node scripts/android-owner-pilot.mjs --build
```

No private key, client secret, Google ID token, billing token, or Cloudflare admin token is emitted. Local debug signing keystores are **not** production-secure and must not be committed to GitHub.

## Verification evidence and limitations

GitHub's Android workflow now runs the **real** SDK verification against a built APK before uploading its debug artifact. Unit tests for parsing and decision logic inject fake verifier output **only to test rejection behavior**; those tests alone do not prove the SDK ran. The independent CI job execution, including the actual `--verify-apk` result, must be checked on the **exact final PR head** and then on the **post-merge main SHA**. Do not mark this milestone complete based only on unit tests.

`apksigner` reports whether the APK's signatures verify for the selected API range; P1-AB is not a device-install test, malware scan, code provenance attestation, signing-key custody audit, Google Console registration, Cloudflare account-ownership check, or successful OAuth authentication.

Official references:
- [Android apksigner verify and print-certs](https://developer.android.com/tools/apksigner)
- [OWASP MASTG: reading APK certificate digests](https://mas.owasp.org/MASTG/techniques/android/MASTG-TECH-0116/)
- [P1-AA signer continuity](P1_AA_STABLE_ANDROID_SIGNER.md)
- [Cloudflare owner acceptance](P1_Y_SINGLE_PASS_OWNER_INSPECTION.md)

**`remote_acceptance: BLOCKED`**, **`safe_to_deploy:false`**, **`safe_to_activate_scheduler:false`** until the separate owner-account and real device tests pass.
