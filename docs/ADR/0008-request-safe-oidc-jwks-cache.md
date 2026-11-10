# ADR-0008: Request-safe, bounded OIDC public JWKS caching

Date: 2026-11-10
Status: MERGED via PR #13 as `f9f551940f8cc9e83b3d14783dbc41ff63aeefe0`; 5/5 final PR-head CI successful at `21bcd3625072f6a57ef4420ff80d73b188d03361`, not remotely deployed.

## Problem and security threat model

The P1-C verifier fetched the configured identity provider's JWKS over HTTPS for **every** valid-looking signed-token request. This increased upstream requests, login latency and the probability of rate-limit/provider outage on a zero-spend pilot. Google recommends caching its public signing keys using response cache directives, while always checking signature, issuer, audience and expiry for every ID token.

A first candidate for P1-G used a module-level WeakMap containing a pending JWKS `fetch()` Promise. **Red-team correction:** Cloudflare Workers best practices warn that sharing request-scoped I/O/Promise state across reused isolates can cause cross-request errors and leaks. That candidate was **replaced before merge**. The implementation does NOT keep request-scope promises, users, JWTs, credentials, authenticated outcomes or a mutable cache Map at module scope.

## Decision and implementation

- Discover a **dedicated named Cloudflare Cache API namespace** `naraya-pocket-agent-public-jwks-v1` per verifier invocation through `caches.open()`. No dependency on global mutable request state; no shared in-flight fetch. Missing/unavailable Cache API is non-fatal to authentication: use a fresh upstream JWKS fetch and still verify cryptographic signatures.
- Cache **public provider JWKS JSON bytes only**, never Authorization headers, token content, subject, issuer-derived identity mappings, user data or a decision that a token is authorized.
- Cache only when the provider explicitly supplies `Cache-Control: public, max-age=N` with exactly one positive safe integer max-age and without private/no-store/no-cache. A response from the configured HTTPS JWKS URL is bounded at **64 KiB**, fatal-UTF8-decoded, strict parsed JSON, and has at most 32 JWK items.
- Clamp cached lifetime to **at most 300 seconds (5 minutes)** even if the provider advertises longer. Set an explicit `X-Naraya-Key-Valid-Until` guard and recheck expiration on each cache read, even if the caching platform returns a stale entry. Malformed/expired cached data is not trusted; fetch a fresh provider response instead. If the provider is unavailable after expiry, do not fall back to stale cached keys. Preserve fail-closed `503` for provider/config unavailable and `401` for signed-token verification rejection.
- Maintain the existing strict `RS256` only, fixed configured issuer/audience/JWKS URL, `kid` lookup, reject `jku/jwk/x5u/crit`, clock checks and RSA cryptographic verify **on every request**, whether the public key bytes were cached or fetched. Cached public keys alone grant no user identity.
- Avoid global HTTP response caching and `stale-while-revalidate` on any user-authenticated path. The regular `Cache-Control: no-store` on API auth/monitor responses remains unchanged.
- No cache-hit guarantee is claimed. Cloudflare Cache API availability varies by runtime/host and caching may be local to a data center; a cross-region request can fetch the JWKS again. Multiple concurrent cold requests may also fetch individually because deliberately there is **no unsafe cross-request single-flight Promise**.
- Provider key rotations can temporarily reject newly signed tokens until the cached public set expires; at most five minutes by this application guard, assuming ordinary clock/runtime semantics. No external authorization is extended for a token beyond its own `exp`, even if signing keys are in cache.

## Adversarial proof and limitations

At source SHA `d7df4223736fe29572325b7345a126f581a372d7`: [backend source CI](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42769743242) **40/40 tests PASS + TypeScript typecheck PASS**. Includes seven new targeted test cases (public key reuse while forged JWT rejected; no-store/private/missing/zero headers; expiry provider failure; key rotation and 5-min cap; malformed/unavailable Cache API; concurrency with no cached user auth; namespaced cache discovery without shared Promise). Reuse is proven with **injected fake Cache API**. Other existing backend, Android and local D1 tests remain separate gates; follow exact final PR-head CI before merge.

**Not verified:** real Google OAuth ID tokens, Google's current response headers through actual Worker execution, Cache API hit rates in Cloudflare production regions, remote D1/Cron, phone switched off, Android resources, account billing and free-tier usage. This change adds no external write or cloud deployment. Real-world cache operations may fail or be unavailable and silently fall back to fresh validated provider requests; the code must never claim assured cost reductions.

## Sources and external verification

- Google OpenID Connect guidance on JWKS, signature, `iss`, `aud`, `exp` and provider cache headers: https://developers.google.com/identity/openid-connect/openid-connect
- Cloudflare Workers best practices (request-scoped state must not be stored globally): https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- Cloudflare Cache API methods, namespace, locality and `Cache-Control` behavior: https://developers.cloudflare.com/workers/runtime-apis/cache/

## Exit gates before cloud usage

1. Verify exact final PR-head source SHA via **5/5** GitHub Actions workflows and record source/output SHA/provenance.
2. Verify approved Google OAuth Web Client ID and Android app-signing association, actual issuer `https://accounts.google.com` or documented legacy case, audience and JWKS URL via discovery metadata. Do not inject OAuth secrets or cloud admin tokens into Android.
3. Obtain explicit owner approval for a zero-additional-spend Cloudflare remote deployment; provision D1/Cron only after account quota/cost inspection.
4. Demonstrate real signed-in Android owner isolation, backend D1 monitor state, device physically off while Cron writes a verifiable observation, and post-restart sync. Record timestamps and sanitized IDs rather than bearer tokens.
