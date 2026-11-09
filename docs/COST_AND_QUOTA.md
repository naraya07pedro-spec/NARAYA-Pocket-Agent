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
