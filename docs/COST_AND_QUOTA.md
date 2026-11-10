# Cost and quota guardrails | P0.1

Target: **no additional spend**. No paid AI calls, auto-upgrades, or deployment in GitHub Actions. All current acceptance tests are offline and require zero API accounts.

Runtime hard limits in this code: 3 monitors per owner; max 3 checks per scheduler invocation; minimum monitor interval 30 minutes; Cron configuration every 15 minutes; maximum five failures before automatic pause; 6-second GitHub HTTP deadline; redirect prohibition. Rate-limited requests defer for 60 minutes. These are conservative application limits, **not** confirmation of remaining account quota.

Before any owner-approved live deploy, check account-specific pricing, D1 allocation, scheduled Workers Free CPU time, request/row quotas, model billing status, available subscription period, and restrictions. Do not use Workers AI in this stage.

Official references (must be rechecked at deploy time):
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

**Stop conditions:** a mandatory paid feature, exhausted free allowance, unstable external API, or inability to keep the pilot token secret. Do not put the owner token in a public APK.


## P1-D opt-in multi-owner additions (10 November 2026)

When `MOBILE_SCHEDULING_ENABLED==='true'`: at most 20 mapped identity subjects for this pilot, 3 monitors per mapped owner, 9 globally ACTIVE mobile monitors, at most 1 due task per owner and 3 total GitHub GET attempts per tick **across operator and mobile owners**. The D1 cursor persists owner rotation. Without the flag, the original single-owner schedule remains.

These are runtime **application-level constraints**, not Cloudflare/GitHub account allocation proofs or guaranteed cadence. A task may run later than its declared interval under backlog. Live D1/Cron, billing/cost counters, Google login, device-off execution and schedule fairness during overlapping remote invocations remain unverified. Enabling any remote deployment still needs explicit operator authorization and fresh free-tier validation.


## P1-E Android Google identity bridge (10 November 2026)

The checked-in/CI Android APK has no Google Web Client ID and no Worker origin, so it cannot send ID tokens or cloud drafts. Google Credential Manager dependencies are included in the Android build; explicit real OAuth setup is not performed. Google OAuth project, verified domain and Android signing setup remain owner-controlled prerequisites.

Cloud sync is **one selected public repo POST per explicit user click**, not background polling; each fetch has a 6-second connect/read timeout, 16 KiB bounded response, and 4 KiB bounded request. Retries reuse the existing draft UUID and server-side deduplication. Google credentials, provider quotas, OAuth project eligibility and actual Worker/D1 costs are **not checked from any connected account**. Do not equate library availability or CI passing with a free live deployment. Remote Cloudflare remains excluded until an explicit cost/authorization gate is satisfied.

No client secret, Google API access token, user password, OAuth refresh token or operator Worker token is placed in the APK or Gradle properties. Public Google Web Client IDs and Worker origins can be configured at build time only after ownership checks; control that build channel carefully, since a malicious Worker host could receive an ID token.


## P1-G public OIDC JWKS Cache API (2026-11-10)

The signed-user backend previously fetched provider JWKS on each valid-looking token request. New code **may reuse public signing keys** via a dedicated Cloudflare Cache API namespace if available and the provider explicitly advertises `Cache-Control: public, max-age=N`. Application TTL is capped at **300 seconds**, with max 64 KiB parsed response. Missing/private/no-store/malformed headers do not cache. Provider or cache failures do not make invalid JWTs valid; an expired set cannot be used on outage.

**No production cost saving is assumed.** Cache API may be unavailable at a deployment host, may be local to a Cloudflare data center, and cold/concurrent requests can still fetch from Google independently. CI uses synthetic tokens and an injected cache; there are **no measured remote hit rates, account quotas, bandwidth, latency, billing or money amounts**. No deployment, paid API or real token occurred during P1-G. Free-tier and domain eligibility must be verified on the actual owner-controlled Cloudflare account before any approval to provision.
