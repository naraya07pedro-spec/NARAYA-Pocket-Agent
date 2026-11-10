# Operator runbook | P1-I source safety and owner-approved cloud acceptance

**Current status, 10 November 2026:** Global Cron processing is **OFF** unless `SCHEDULER_ENABLED==='true'`; mobile scheduling separately requires `MOBILE_SCHEDULING_ENABLED==='true'`. The checked-in Worker remains without public route or real D1 UUID. Nothing has been deployed remotely. Before any real infrastructure setup, run `npm run preflight` and review [the staged, approval-only rollout and rollback plan](REMOTE_PILOT_READINESS.md). `npm run preflight:require-remote` deliberately exits 2 (blocked), even when the static source checks pass. Do not convert green CI into a claim of live Google OAuth, Cloudflare Free CPU viability, or phone-off autonomy.

The following P0.1 procedure is preserved as **historical instructions**, not approval to run mutating commands. The migration sequence is now **0001, 0002, 0003, 0004** (not only 0001). The owner must inspect account quotas and explicitly authorize every remote create, migration, secret update, deploy and Cron activation separately.

---
# Operator runbook | P0.1

## Reproducible offline test

Use Node.js v22.16+ and TypeScript 5.8.3 (`npm install -g typescript@5.8.3` for the typecheck); run `npm ci --ignore-scripts`, `npm test`, and `npm run typecheck`. CI installs only the pinned TypeScript developer tool and never obtains provider credentials. `node:sqlite` is experimental in Node 22 and is **test-only**.

## Explicit future Cloudflare activation (NOT DONE)

This is an operator checklist, **not** a claim that deployment is operational:

1. Inspect Cloudflare account plan and ensure Workers/D1 usage can remain on a free plan. Obtain owner approval before any resource creation/deployment.
2. Install a compatible official Wrangler CLI, inspect `worker/wrangler.jsonc`, create/bind a **separate disposable D1 database** in the intended Cloudflare account, and ensure `database_id` matches the actual database. Do not copy examples containing credentials into the repo.
3. Apply the complete additive `worker/migrations/0001_initial.sql` through `0004_global_scheduler_budget.sql` chain to a disposable **local** D1 environment first. Verify schema and rollback behavior. Never run remote migrations without account approval and an appropriate backup. A real remote D1 integration test is required before claiming Cloudflare compatibility.
4. Configure `OWNER_API_TOKEN` as a Wrangler secret using a cryptographically random string of at least 32 characters. Never place it in a source file or Android client. Review provider secret exposure, deployment permissions, and API accessibility.
5. Explicitly decide whether to enable any public HTTP route. `workers_dev` is `false`; health and authenticated endpoints will not be externally reachable until routing is configured and approved. Scheduled triggers do not require Android power.
6. Deploy only after the owner authorizes it. Create one monitor using authenticated HTTP. Inspect D1 after Cron runs and prove the observation timestamp and commit SHA reflect the real GitHub endpoint.
7. Test powered-off-phone case: create monitor, shut down phone, record cloud task/observation timeline, restart phone, confirm the same backend state. This is not equivalent to the simulated CI test.
8. Rotate token and pause monitoring if compromised, rate-limited, or unexpected billing/usage occurs.

The config intentionally does not contain a real `database_id`, route, or secret. No credentials, paid model, or provider write is required for local code tests.

## P0.2-A: Cloudflare-local D1 acceptance (CI verified)

This is a strictly local test. It uses `getPlatformProxy` and temporary local workerd/D1 bindings, never the owner's Cloudflare account:

```sh
npm ci --ignore-scripts
npm install --no-save --package-lock=false --no-audit --no-fund wrangler@4.158.0
node --experimental-strip-types --test tests/cloudflare-local.test.mjs
```

Do not use the dummy UUID in `worker/wrangler.local.jsonc` for any deploy or remote migration. `tests/cloudflare-local.test.mjs` executes complete schema statements through D1.prepare and tests restart persistence and lease fencing. To validate the actual Wrangler migration command on remote D1, explicit owner approval and disposable resources are still required. The original `worker/wrangler.jsonc` intentionally lacks a real D1 ID and has no publicly exposed route.
