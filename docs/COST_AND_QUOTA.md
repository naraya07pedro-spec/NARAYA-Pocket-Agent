# Cost and quota guardrails | P0.1

Target: **no additional spend**. No paid AI calls, auto-upgrades, or deployment in GitHub Actions. All current acceptance tests are offline and require zero API accounts.

Runtime hard limits in this code: 3 monitors per owner; max 3 checks per scheduler invocation AND 3 reserved provider attempts per fixed UTC 15-minute window across all invocations sharing one D1 database (migration 0004 required); minimum monitor interval 30 minutes; Cron configuration every 15 minutes; maximum five failures before automatic pause; 6-second GitHub HTTP deadline; redirect prohibition. Rate-limited requests defer for 60 minutes. These are conservative application limits, **not** confirmation of remaining account quota.

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


## P1-H global D1 Cron attempt budget (10 November 2026)

The old cap of three GitHub GET attempts per `runScheduler()` invocation did not protect against overlapping Cron invocations each making three requests. An additive D1 migration `0004_global_scheduler_budget.sql` adds a **single-row atomic reservation** to the persistent `scheduler_control` table. Every scheduler invocation, including operator-only mode when mobile scheduling is OFF, must obtain one of at most **three reserved provider attempts per fixed UTC quarter-hour on that D1 database** before network I/O. Failed lease acquisition refunds its unused slot; an ambiguous error or missing migration fails closed. The budget persists across local Worker restarts.

**Trade-offs:** no guarantee of 30-minute check timing under backlog, a crash can waste the quota, and six attempts can straddle the boundary of two UTC quarter-hours, because this is not a rolling rate limit. No budget is shared across independent D1 databases, other Workers or separate external integrations. Strong fairness between owners under truly concurrent remote Cron invocations is not proven. The app still has no configured live Google OAuth or deployed Cloudflare Worker.

**CI proof:** [43/43 backend](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777373598) and [9/9 local workerd/D1](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777373148) at source SHA `067b7905f9781193cba11beb3eaf650c6ecec5c4`, including overlapping invocations, persistent quota across restart and non-destructive migration. See [ADR-0009](ADR/0009-d1-global-cron-budget.md). The use of GitHub Actions/public GitHub reads does not establish Cloudflare Free usage or actual account bills. Real deployment remains an owner-approval gate.


## P1-I global Cron OFF and no-spend source gate (10 November 2026)

New Worker `scheduled()` handling returns **before any D1 and GitHub I/O** unless `SCHEDULER_ENABLED === 'true'`; opt-in mobile scheduling separately requires the original flag. This prevents *operator-only* monitors from silently running when the Worker is first deployed. The Wrangler Cron trigger itself may still execute and count against Workers platform allowances, even when application processing is OFF; the pilot template therefore has **no Cron trigger at all**.

Current Cloudflare documentation (reviewed 10 November 2026) lists Workers Free **10ms CPU per Cron trigger**, **50 subrequests per invocation**, **100,000 requests/day** and **five Cron triggers per account**, with separate D1 Free resource/row limits. None is a measure of the owner's remaining account quota. The actual Worker CPU used by Google/JWKS verification or scheduled work has **not** been measured on remote Cloudflare, and CI cannot certify a 10ms budget.

References: <https://developers.cloudflare.com/workers/platform/limits/>, <https://developers.cloudflare.com/d1/platform/limits/>, <https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/>. `scripts/release-preflight.mjs` is an offline source **safety audit**, not remote cost verification. It returns `remote_readiness: BLOCKED` with explicit blockers; do not use this status to justify a deploy. [Owner-only release protocol](REMOTE_PILOT_READINESS.md). No paid resources or remote migrations are created in this milestone.
