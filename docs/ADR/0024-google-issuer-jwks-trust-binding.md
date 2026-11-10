# ADR-0024: Bind Google's OIDC issuer to its official published JWKS

Date: 10 November 2026
Status: Accepted for P1-W source/local implementation only; live Google and Cloudflare remain **NOT_VERIFIED**.

## Concrete source-level security risk

The previous Worker verified RS256 signatures using public keys fetched from **any** HTTPS \`OIDC_JWKS_URL\` selected by operator configuration. The issuer claim was separately checked for \`https://accounts.google.com\` or legacy \`accounts.google.com\`. **No check linked those claimed Google issuer identities to Google-controlled public signing keys.**

Under a mistaken or compromised JWKS setting, an attacker with control of that host could publish their own RSA key and sign a JWT that falsely declares a Google issuer, an allowed backend \`aud\`, any existing \`sub\`, and an authorized \`azp\`. All previous mathematical signature, expiry, audience and presenter checks could pass. This is a **source-level trust-boundary flaw under bad configuration**, not evidence of an actual account compromise or real observed exploit.

The [Google OpenID Connect guide](https://developers.google.com/identity/openid-connect/openid-connect) requires that Google ID-token signatures be checked against the Google issuer's public signing keys from the official Discovery document \`https://accounts.google.com/.well-known/openid-configuration\`. Google's published \`jwks_uri\` example at the time of this review is **\`https://www.googleapis.com/oauth2/v3/certs\`**. The [Google OpenID reference](https://developers.google.com/identity/openid-connect/reference) likewise requires keys from discovery's issuer-linked \`jwks_uri\`.

## Decision

- For canonical \`OIDC_ISSUER=https://accounts.google.com\` only, enforce the **exact** documented \`OIDC_JWKS_URL=https://www.googleapis.com/oauth2/v3/certs\`. Other HTTPS domains, look-alike subdomains, alternate paths, query strings, slashes, and older URLs are **not** accepted. Invalid config throws \`AuthUnavailable\` and the Worker returns generic HTTP 503 before any JWKS GET, D1 identity registration or monitor write.
- The legacy **token claim** \`iss=accounts.google.com\` remains supported only under the canonical Google **configured** issuer and maps to the same canonical D1 identity. It does **not** relax the pinned issuer-to-JWKS trust relation.
- Non-Google OIDC issuers keep their own explicit validated HTTPS JWKS URL. The existing RS256 verification, audience equality, short token expiry, max-three explicit authorized \`azp\` list and bounded public-key caching stay in place.
- The pinned URI is a **provider-metadata dependency**. If Google changes the official discovery \`jwks_uri\`, a login may fail closed until an owner reviews and approves a source update. Do not silently fetch alternative keys or use JWT-supplied \`jku\` URLs. Recheck official discovery during a real pilot.
- The source safety preflight asserts the key constant and issuer-binding guard exist. This **does not prove** the actual live Google endpoint was contacted or Google-issued tokens were verified.

## Adversarial evidence

- Five additional deterministic Node tests: genuine-looking **synthetic self-signed** Google-claim JWT blocked for malicious/mis-typed JWKS **before fetch**; legacy issuer same; sanitized \`/v1/me\` 503; generic OIDC unaffected; wrong RSA key rejected even if delivered at allowed URL. One new preflight anti-regression test mutates the binding check.
- Existing P1-V Google token tests use an **intercepted** fetch to the official-looking Google JWKS URI and still employ a **synthetic RSA fixture**, not an authentic Google key.
- The actual **local Cloudflare workerd/D1** test first attempts to register a monitor with a Google issuer and an invalid \`JWKS_URL\`: returns HTTP 503 and **zero** identity/monitor rows. Then it performs a valid synthetic first registration, simulates Worker restart, and confirms issuer alias and approved Android presenter reuse the same identity.
- No new D1 migration, Google Cloud credential, Cloudflare account access, external provider GET, live token, remote deployment, Cron activation, new resource or spending.

## Next owner gate

Before an actual pilot, the owner independently reviews the Google discovery document, matches real Android signing certificate / package and Web OAuth audience, and separately validates the Cloudflare Free account billing, Worker CPU and D1 daily usage. A real Google-issued ID token must be verified on a real Android against a separately authorized Worker HTTPS endpoint. Only then is a PAUSED monitor eligible for tested sign-in; physically OFF phone Cron/D1 evidence remains a distinct approval and acceptance gate.

See [PROGRESS](../PROGRESS.md), [EVIDENCE](../EVIDENCE.md), [REMOTE_PILOT_READINESS](../REMOTE_PILOT_READINESS.md), [Issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8).
