# Operator runbook | P0.1

## Reproducible offline test

Use Node.js v22.16+ and TypeScript 5.8.3 (`npm install -g typescript@5.8.3` for the typecheck); run `npm ci --ignore-scripts`, `npm test`, and `npm run typecheck`. CI installs only the pinned TypeScript developer tool and never obtains provider credentials. `node:sqlite` is experimental in Node 22 and is **test-only**.

## Explicit future Cloudflare activation (NOT DONE)

This is an operator checklist, **not** a claim that deployment is operational:

1. Inspect Cloudflare account plan and ensure Workers/D1 usage can remain on a free plan. Obtain owner approval before any resource creation/deployment.
2. Install a compatible official Wrangler CLI, inspect `worker/wrangler.jsonc`, create/bind a **separate disposable D1 database** in the intended Cloudflare account, and ensure `database_id` matches the actual database. Do not copy examples containing credentials into the repo.
3. Apply `worker/migrations/0001_initial.sql` to a disposable local D1 environment first. Verify schema and rollback behavior. Run a real remote D1 integration test before claiming Cloudflare compatibility.
4. Configure `OWNER_API_TOKEN` as a Wrangler secret using a cryptographically random string of at least 32 characters. Never place it in a source file or Android client. Review provider secret exposure, deployment permissions, and API accessibility.
5. Explicitly decide whether to enable any public HTTP route. `workers_dev` is `false`; health and authenticated endpoints will not be externally reachable until routing is configured and approved. Scheduled triggers do not require Android power.
6. Deploy only after the owner authorizes it. Create one monitor using authenticated HTTP. Inspect D1 after Cron runs and prove the observation timestamp and commit SHA reflect the real GitHub endpoint.
7. Test powered-off-phone case: create monitor, shut down phone, record cloud task/observation timeline, restart phone, confirm the same backend state. This is not equivalent to the simulated CI test.
8. Rotate token and pause monitoring if compromised, rate-limited, or unexpected billing/usage occurs.

The config intentionally does not contain a real `database_id`, route, or secret. No credentials, paid model, or provider write is required for local code tests.
