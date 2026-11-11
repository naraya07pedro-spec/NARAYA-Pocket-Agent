# P1-AA | Stable owner-local Android signer for REAL Google OAuth pilot

**Date:** 2026-11-11 WIB. **Scope:** owner-controlled **debug build only**, not production release, Google Play publishing, remote Cloudflare/OIDC acceptance, or an on-device validation.

## Why this is a blocker

Independently extracted the embedded public Android APK v2 signing certificate from three **different** verified GitHub Actions APK artifacts. They differ by run:

| Checked main | CI artifact | SHA-1 of embedded PUBLIC signing certificate |
|---|---|---|
| P1-W `116203c...` | #13786085576 | `F5:F2:75:C1:32:AA:9E:0C:32:39:59:3A:AE:CB:88:0E:D7:88:C8:AA` |
| P1-Y `869bb23...` | #13823729817 | `80:07:86:AB:2A:22:47:26:CF:9D:15:19:A8:69:36:B1:61:91:52:3D` |
| P1-Z `75f4330...` | #13825714591 | `A1:57:B8:98:A2:30:97:F4:DA:5C:B6:4B:59:C7:B6:98:74:2C:07:94` |

These fingerprints are **independent certificate-byte observations, not a full APK signature validation**. This mismatch is enough to **reject using successive CI APKs as a stable update/install or long-lived Google Android OAuth client signing identity**. The CI APKs remain useful as install-only temporary manual previews. Replacing an installed package signed with a different cert normally requires uninstalling it first, which can lose private draft data.

Official references:
- [Android application signing and debug key behavior](https://developer.android.com/studio/publish/app-signing)
- [Google Android sign-in, separate Android package/SHA-1 and Web client](https://codelabs.developers.google.com/sign-in-with-google-android)
- [Google client authentication and SHA-1](https://developers.google.com/android/guides/client-auth)

## Recommended controlled local pilot path

This repository provides **`scripts/android-owner-pilot.mjs`**, which reads a *public certificate* from the owner's local Android debug keystore. It never exports the private key. Node.js 22.16.x, **JDK 17, Gradle 9.4.1, Android SDK Platform 37**, build tools, and a trusted Windows PC are prerequisites. The repo currently uses an installed `gradle` command; it has **no committed Gradle wrapper**. Do not download dependencies or APKs from unknown sources.

1. **Inspect without side effects:** `npm run android:owner-inspect`. If the local default `~/.android/debug.keystore` does not exist, expect `OWNER_LOCAL_SIGNING_BLOCKED`, not a fake SHA-1.
2. **Explicitly create the local debug keystore through Gradle only if necessary:** `npm run android:owner-bootstrap`. This runs tests and an **unconfigured** Android debug build locally. It can download Gradle/Android dependencies and uses local CPU/disk; it does not access Cloudflare/Google accounts.
3. Review the public certificate SHA-1 and SHA-256, verify you are using the intended PC and application package `dev.naraya.pocketagent`, then **pin locally once**: `npm run android:owner-pin`. Only public SHA-1/SHA-256 hashes and the package name are saved in `~/.naraya-pocket-agent/pilot-debug-signer-lock.json` **outside the GitHub repository**. Different certificate on a later build must **BLOCK**, never auto-re-pin. Preserve the underlying private keystore securely on your own machine and do not upload it anywhere.
4. **Build the ordinary manual preview locally**, checking the pinned certificate before/after:
   ```powershell
   node scripts/android-owner-pilot.mjs --build
   ```
   The resulting local APK is `android/app/build/outputs/apk/debug/app-debug.apk`. This is a debug APK, NOT a production release. P1-AB now additionally requires the official Android SDK apksigner integrity check, package check, and APK-versus-keystore certificate match on the built file. It is intended to remain compatible with subsequent local debug builds using the **same owner-local debug keystore**.
5. **Only after Cloudflare account+billing verification, owner-approved inert Worker deployment, and a real Google Cloud OAuth project:** create an **Android OAuth client** for package `dev.naraya.pocketagent` with this *owner-local* SHA-1; create a separate **Web OAuth client** whose public client ID must equal Worker `OIDC_AUDIENCE`. Confirm your Worker exact HTTPS host is owned/controlled by you. Then explicitly build with both *public* identifiers:

   ```powershell
   node scripts/android-owner-pilot.mjs --build `
     --web-client-id="<VERIFIED_PUBLIC_GOOGLE_WEB_CLIENT_ID>" `
     --worker-origin="https://<OWNER_CONTROLLED_WORKER_HOST>" `
     --acknowledge-owned-origin
   ```

   Both identifiers are build-time **public values**. **No ID token, client secret, OAuth refresh token, private signing key or Cloudflare API token is permitted**. The `--acknowledge-owned-origin` flag records a conscious user assertion, not proof of actual domain control. A malicious origin could receive a real Google token. Check the exact origin in your own Cloudflare dashboard before doing this.

## Explicit limitations and fail conditions

- A GitHub CI runner creates its own temporary debug keystore. **Never register the changing CI APK SHA-1 as your stable Android OAuth identity.** A public CI artifact cannot silently update an owner-local APK with a different signing cert. Back up/delete local drafts consciously; never auto-uninstall.
- The owner-local debug key is **not production secure** (Android debug keystores have known default passwords). Use a separately owned release signing key and a controlled distribution strategy before a true production release. The script does **not** create/manage that production key.
- As of P1-AB, this local pilot script **uses Android SDK apksigner and aapt to verify the actual built APK** and match its signing certificate to the local key before reporting build success. It is **not** a malware scanner, independent code provenance attestation, production/release signer, remote Google token test, Cloudflare billing validator or Cron/phone-off evidence gate. Android OS separately validates APK signatures at installation. See [P1-AB verifier protocol](P1_AB_VERIFIED_APK_SIGNER_BINDING.md).
- The script currently has **no physical Windows execution evidence**. Node argument parsing and failure tests on GitHub CI are not evidence that JDK/Gradle/Android SDK are installed on the owner's PC.
- If the local key is lost, changed, or the pinned hash conflicts, **stop**. Do not auto-reset the pin, deploy Cloudflare, rotate OAuth clients, or erase app data. See [owner cloud acceptance](P1_Y_SINGLE_PASS_OWNER_INSPECTION.md), [P1-X release gate](P1_X_OWNER_ACCEPTANCE_GATE.md) and [Issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8).
