# ADR-0023: Verified Google Android OAuth presenter, canonical issuer and strict backend audience

Date: 10 November 2026
Status: Accepted for P1-V source/local rollout; **real Google sign-in + Cloudflare deployment remain NOT VERIFIED**.

## Source audit finding

The Pocket Agent Worker validated RS256 Google/OIDC ID tokens but required `payload.azp === payload.aud` whenever `azp` was present. This incorrectly assumes the OAuth client presenting the signed token must equal the intended Web/backend audience. Google explicitly documents:
- `aud` = the ID token's intended OAuth client, which must equal the backend's allowed client ID;
- `azp` = the authorized presenter OAuth client, which can be **different** from `aud`, for example when the Android app signs in to a backend;
- legitimate issuer values can be `https://accounts.google.com` **or** `accounts.google.com`.

The original Worker accepted only the configured exact issuer, so a valid legacy Google issuer could be rejected. It could also register separate durable identities if a naive solution accepted either issuer but returned the raw variant. **These are code-level compatibility risks, not proof of a real user being rejected.**

Primary evidence:
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) defines `azp`, `aud`, `iss`, `sub`, validation and signature.
- [Google OIDC token reference](https://developers.google.com/identity/openid-connect/reference) covers legacy issuer and authorized presenter.
- [Google Android to backend verification](https://developers.google.com/identity/sign-in/android/backend-auth) requires Google signature, exact backend audience and issuer.
- [Google Android Credential Manager server client ID](https://developers.google.com/identity/android-credential-manager/android/reference/com/google/android/libraries/identity/googleid/GetGoogleIdOption.Builder) uses the server's client ID as the ID token audience.

## Decision

1. Add **optional**, operator-only `OIDC_AUTHORIZED_PRESENTERS` to Worker `Env` and `OidcSettings`, containing at most **three** explicit additional OAuth client IDs separated by commas. Values must be nonempty, single ASCII identifiers (length ≤200, only letters/digits/dot/underscore/colon/hyphen), with no whitespace, wildcards, duplicates or copy of the backend audience. Entire env value length ≤600. Configuration errors are `AuthUnavailable`/HTTP 503, never an expanded permit. By **default** the field is absent, the allowed presenter set is **only `OIDC_AUDIENCE`**, preserving the old default.
2. Every request still requires an authentic RSA SHA-256 signature from the configured operator-owned fixed HTTPS JWKS URL; exact `aud === OIDC_AUDIENCE`; valid `iat`, `exp`, `nbf`; valid `sub`, known `kid`, no arbitrary token-provided key/JWKS. A supplied `azp` must match either the backend audience or one explicitly allowlisted authorized presenter. Unknown, malformed, or unlisted `azp` gets HTTP 401, before any upstream JWKS fetch.
3. Only when the operator-configured issuer equals canonical `https://accounts.google.com`, accept the Google-documented legacy token issuer `accounts.google.com`. Return **the same canonical configured issuer string** for D1 `user_identities(issuer,subject)`. Other configured OIDC providers retain exact issuer matching and do not acquire a generic alias or wildcard.
4. Keep generic (possibly URI-shaped) `OIDC_AUDIENCE` compatible. The new restricted format applies only to *additional* authorized presenter entries, not to all OIDC audience strings.
5. OIDC OAuth client IDs are public identifiers, **not secrets**, but should still be owner-verified in the actual Google Console, paired with the Android package name and signing SHA, and never invented. ID tokens, API tokens, client secrets and full private Google/Cloudflare configuration must never be committed to GitHub, pasted in issues/chats or added to CI.

## Source/local-only verification

- Synthetic locally signed RS256 tokens check: both Google issuer variants map to one issuer/sub identity, distinct explicitly authorized Android `azp` is accepted, unlisted presenter and wrong backend `aud` rejected before JWKS network, malformed/wildcard/multiple config fail closed, token with forged signature rejected even with allowlisted presenter, and default absent config stays strict.
- Real **local workerd/D1** integration test boots, registers one signed user's first PAUSED monitor, restarts the platform/D1, then uses another independently signed token with Google's legacy issuer + allowlisted Android `azp` for the same `sub`. The monitor ID and identity row count must remain identical. This is local synthetic RSA, **not** a real Google OAuth/Android device experiment.
- Offline release preflight includes a regression check on issuer normalization, presenter allowlist, exact backend audience and RSA verification. It still reports `remote_readiness:BLOCKED`.

## Operational limits and non-actions

A real Google project/client, Android signing fingerprint, Credential Manager interaction and issuer/audience/azp fields **must be checked on a physical Android before claiming compatibility**. No Google Console settings, OAuth app registration, permission changes, user credentials, Cloudflare account, remote D1, deployment, Cron activation, added provider spend or phone-OFF experiment have been touched in P1-V.

Once owner-verified and **separately approved**, configure `OIDC_ISSUER=https://accounts.google.com`, `OIDC_AUDIENCE=<actual Web/backend client ID>`, `OIDC_JWKS_URL=<official Google JWKS URL from discovery>`, and add the exact Android OAuth client ID to `OIDC_AUTHORIZED_PRESENTERS` **only if a real issued token presents a different `azp`**. Never widen `aud` or accept arbitrary presenters to paper over a failed login. Prove real `/v1/me` identity before proceeding to signed PAUSED monitor and later owner-approved Cron pilot.

See [PROGRESS](../PROGRESS.md), [EVIDENCE](../EVIDENCE.md), [private owner runbook](../REMOTE_PILOT_READINESS.md), [Issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8).
