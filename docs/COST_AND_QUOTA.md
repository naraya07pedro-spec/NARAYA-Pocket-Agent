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
