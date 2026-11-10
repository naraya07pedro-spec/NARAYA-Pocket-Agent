# ADR-0018: Cloudflare account inventory is owner-triggered, GET-only, and never a deployment authorization

Date: 2026-11-10
Status: Accepted for source-only P1-Q implementation; remote acceptance remains BLOCKED.

## Context and decision

P1-P proves atomic first monitor onboarding in source/local D1, but **nothing** establishes which Cloudflare account, Free plan, Worker routes, D1 database, live Cron schedules, row usage or CPU constraints the real owner has. The highest-value next evidence is read-only inventory from the **actual** account, not another invented remote acceptance.

P1-Q adds `scripts/cloudflare-readonly-inspect.mjs` with two modes:

1. **Offline default:** no requests, no account access, always reports BLOCKED.
2. **Explicit `--inspect-live`:** a local owner-operated script using a short-lived Cloudflare API token with only the necessary **read** scopes and `CF_READONLY_ACCOUNT_ID` from environment variables. It requests only these official API endpoints: `GET /accounts/:id/d1/database`, optionally `GET /accounts/:id/d1/database/:uuid`, `GET /accounts/:id/workers/scripts`, and optionally `GET /accounts/:id/workers/scripts/naraya-pocket-agent/schedules`. Every outbound request is `GET`; redirects are prohibited and response bodies are bounded. There are no cloud writes, D1 SQL requests or credential persistence.

The structured summary records whether the named Worker/D1 appear, the number of configured schedules if accessible, and D1 file size if returned. It suppresses account IDs, database UUIDs, tokens, raw API objects, error bodies and stack traces. Incomplete pagination, missing permissions, malformed replies, absent resources and missing size metadata remain **UNKNOWN/UNAVAILABLE**, never convert into successful clearance.

Regardless of successful API reads, `remote_acceptance='BLOCKED'`, `safe_to_deploy=false` and `safe_to_activate_scheduler=false` are immutable result fields. This tool is an **inventory probe**, not a cryptographic provider attestation, signed report, billing review, CPU benchmark, OAuth proof, remote migration verification or physical phone-OFF experiment. Owner must independently inspect actual plan, usage, invoice/billing, security, 0001–0005 migrations and physical hardware. Publishing its report as CI evidence without making and reviewing a private live run would be misleading.

## Official limits, checked 10 November 2026

- Workers Free publishes **10 ms CPU per Cron invocation**, **50 subrequests/invocation**, **100,000 Worker requests/day** and **5 Cron triggers/account**. 10 ms is *CPU* not network wall time. Check live account and actual workloads before enabling.
- D1 Workers Free publishes **5,000,000 rows read/day**, **100,000 rows written/day**, **5 GB total storage**, **10 databases/account** and **500 MB/database**.
- Since **1 September 2026**, D1 Free daily row limits are enforced: exhausted row read/write quotas produce query failures until **midnight UTC** reset. A low synthetic-workload pass cannot guarantee availability on shared free quotas.

Sources: https://developers.cloudflare.com/workers/platform/limits/ ;
https://developers.cloudflare.com/d1/platform/limits/ ;
https://developers.cloudflare.com/d1/platform/pricing/ ;
https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/ ;
https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/list/ ;
https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/ ;
https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/list/ ;
https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/get/ .

## Rejected alternatives

- Automatic deployment with GitHub Actions or an AI agent: violates explicit owner approval and zero-additional-cost invariant.
- Writing tokens into checked-in scripts, CI secrets or public issue: violates credential hygiene.
- Treating a matching repository/config string as proof of running Cloudflare: repository and account are different trust boundaries.
- Classifying read-only account metadata as verified billing, CPU or Cron execution: unsound evidence promotion.
- Using any API query that POSTs SQL to remote D1: not read-only and not within P1-Q scope.

## Risk, evidence and next gate

- API tokens may still be exposed by an unsafe local machine; use least privilege, never paste tokens into chat, and revoke after inspection.
- Queries themselves can count toward API rate limits; read-only is not zero network activity. No application-resource mutation is expected.
- Real Cloudflare account access is deliberately absent from repository CI. The Node adversarial suite uses mocked fetch calls and does **not** establish remote connectivity.
- P1-Q exits once the owner can privately inspect and record genuine account metadata. Next gate remains owner approval for remote backup, D1 migrations 0001–0005 and inert Worker deployment; then real Google OAuth, Cron CPU/usage telemetry and the powered-OFF Android experiment. No remote writes before explicit authorization.
