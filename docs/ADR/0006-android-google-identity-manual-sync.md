# ADR-0006: opt-in Android Google identity and manual cloud-sync bridge

Date: 2026-11-10
Status: MERGED via PR #11 at `a1b86a3a95895c8516d3be766379ec6b42faee17`. 5/5 final PR-head CI SUCCESS at `e1dc90816ecc85df064fa379bda114c35541e967`; real-provider/device/cloud acceptance separate.

## Decision

Add an explicit Google Credential Manager sign-in and user-initiated Android-to-Cloudflare Worker sync path, **without any operator bearer token, long-lived refresh token or app-side scheduler**. Use the server's P1-C/P1-D OIDC verification, server-owned user mapping and idempotent per-owner draft records already available in the backend.

The checked-in Android debug build has **no Google Web Client ID** and **no Worker origin**, so its cloud UI is disabled. Both values are public deployment configuration (not API secrets) that must be deliberately provided by the operator using Gradle properties at build time. No production or testing credentials are committed.

## Data flow and boundaries

1. Local repository drafts continue to reside in the existing SharedPreferences schema. Existing draft UUIDs, manual GitHub snapshots, and offline read-only preview are preserved; no migration needed.
2. With valid public compile-time Web Client ID and fixed HTTPS Worker origin, user explicitly taps **Sign in with Google**. Android Credential Manager obtains a Google ID token. App holds it only in an ephemeral in-memory session; no preferences, disk, logs, background service or saved instance state.
3. User explicitly chooses **Sync this draft to cloud**. HTTP POST sends exactly `{clientDraftId,repository,intervalMinutes}` and the short-lived ID token as Bearer auth. It does not send the local SHA, device info, other drafts, contacts or operator token. No redirects or arbitrary hostnames; bounded 4 KiB request, 16 KiB streamed response, HTTPS only, network on IO dispatcher.
4. Backend verifies JWT signature, pinned issuer, audience, expiry and subject, owns user mapping and safely deduplicates by (owner_id,client_draft_id). A 201/200 response is accepted only after Android validates server-returned draft ID, normalized repo and interval exactly match the local request.
5. User explicitly chooses **Refresh cloud state** for owner-scoped read-only GET; UI shows only server-confirmed state. After app restart a new login is required, then cloud records can be reconciled. Offline network errors leave local drafts and verified GitHub SHA untouched.
6. User **Sign out** clears in-memory ID token and displayed server state immediately; Credential Manager state is also cleared on a best-effort basis. A 401 clears the local session, requiring sign-in again.
7. No automatic remote activation. Newly synced backend monitors are PAUSED; active scheduler requires both a separate signed-owner status PATCH and explicit server-side `MOBILE_SCHEDULING_ENABLED='true'`. This milestone does not enable either in the Android UI.

## Configuration and security

Use only explicit public Gradle properties (all values deliberately omitted by default):

```shell
gradle --project-dir android :app:testDebugUnitTest :app:assembleDebug \
  -PnarayaGoogleWebClientId='<YOUR_PUBLIC_GOOGLE_WEB_CLIENT_ID>' \
  -PnarayaApiOrigin='https://<YOUR_APPROVED_WORKER_HOST>'
```

The Google Web Client ID must refer to the same project/audience verified by Worker `OIDC_AUDIENCE`. Worker `OIDC_ISSUER` should match the actual signed token, typically `https://accounts.google.com`, and `OIDC_JWKS_URL` must be fixed to Google's official JWKS endpoint after verifying its discovery document. Compile-time host and client ID are **public identifiers**, not authorization. The Worker is the sole authority.

**Do not do the above command with an untrusted host**, and do not pass Google client secrets, Cloudflare API tokens, access/refresh tokens, user passwords, or `OWNER_API_TOKEN` as Gradle props. Operator must configure authorized Android package/signature within Google OAuth setup. The project has NOT established or tested this setup.

Dependency choice: stable AndroidX Credentials 1.6.0 and Google Identity 1.1.1, which supports the project's Kotlin metadata toolchain. **Google Identity 1.2.1 failed** CI because its Kotlin 2.4 metadata exceeded the project compiler 2.2 reader, so it was replaced without suppressing metadata checking. The full failed run must be retained in EVIDENCE.md.

## Non-claims, failure modes and acceptance gates

- **No actual Google sign-in or Cloudflare remote deployment tested**. Android native JVM tests use fake transport responses and synthetic token-shaped strings. A client-side token-shape check is not cryptographic authentication; the existing backend remains the verifier.
- No secure refresh token persistence or unattended Android sign-in is implemented. Short-lived ID tokens require reauthentication; this deliberately avoids retaining credentials. Credential Manager / Play Services availability on actual devices and Google OAuth account setup remain unknown.
- A user may remove a local draft while a separate cloud record still exists. Removal must explicitly say **local-only**; remote deletion/cancellation is not implemented and is not implied.
- Backend mobile monitor remains PAUSED at upload; UI must not suggest phone-off monitoring is enabled. `schedulerEligible` is not execution evidence.
- A malicious or wrong compiled Worker host could receive a Google token; the operator controls host configuration. A trusted build/deployment and domain ownership check are mandatory before testing with a real account.
- Google ID token nonce/replay hardening, JWKS key caching/rotation and rate-limit budgeting need production review. Tests use synthetic fixture keys; no login/provider success is claimed.
- Real on-device acceptance: consented Android install, Google sign-in configured in OAuth, signed Worker `GET /v1/sync/monitors`, exactly one manual draft upload, controlled retry returning same server ID, 401 reauth, airplane-mode preservation, force-stop/session clearing, offline draft snapshot unchanged. Log only sanitized server IDs, never bearer tokens.
- Separately verify actual Cloudflare D1/Cron with free-tier account counters and physically powered-off phone under explicit approval. See issues #2/#5/#8.

## Source references
- https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation
- https://developer.android.com/jetpack/androidx/releases/credentials
- https://developers.google.com/identity/sign-in/android/backend-auth
- https://developers.google.com/identity/openid-connect/openid-connect
