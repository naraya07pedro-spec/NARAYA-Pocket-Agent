# ADR-0010 | Global Cron kill-switch and offline release gate

Date: 10 November 2026
Status: Implemented in PR #15, pending final exact-head source CI and merge. No Cloudflare remote deployment.

## Problem

After P1-H, the source has bounded D1 Cron reservations, but **deploying a Worker with a Cron trigger could still begin operator-owned GitHub checks without a separate global permission**. Mobile `MOBILE_SCHEDULING_ENABLED` was OFF, but that setting did not block the legacy operator-only path. The checked-in Worker also has **no route** (`workers_dev:false`) and **no real D1 UUID**, so a green CI result could be mistakenly taken for an Android-accessible remote system.

Cloudflare Workers Free publishes **10 ms CPU per Cron trigger**, and D1 Free has real account-level limits and subrequest constraints. Neither source tests nor an APK build measures those limits on the user's actual Cloudflare account. Real Google OAuth sign-in and physically powered-off device acceptance remain absent. The team must not deploy simply because GitHub Actions is green.

## Decision

1. **Global Cron permission:** `worker.scheduled()` immediately logs only `{"event":"scheduled_disabled"}` and returns unless `env.SCHEDULER_ENABLED === 'true'`. It must touch **neither D1 nor external fetch** when absent, false, malformed or whitespace-padded. `SCHEDULER_ENABLED` and `MOBILE_SCHEDULING_ENABLED` are independent, explicitly required opt-ins. The Worker scheduled entrypoint is now inert by default, including for legacy active operator rows.
2. **Separate source safety from live deployment:** offline-only `scripts/release-preflight.mjs` audits checked-in Wrangler/Android/CI config, migration file chain and global permission; emits distinct `source_safety` and `remote_readiness`. Even when source checks pass, remote status must remain `BLOCKED` until independent account/provider/hardware evidence is available. The command `--require-remote` returns code 2. It never accesses Cloudflare, Google, GitHub network services, secrets or deployment tools.
3. **Inert pilot template:** `worker/wrangler.pilot.example.jsonc` has an invalid placeholder database ID and name, `workers_dev:true`, **no Cron triggers**, and both scheduler flags explicitly `false`. It is an **illustration**, not deploy-ready or permission to create a resource. A future owner-approved copy `worker/wrangler.pilot.jsonc` and private exports are ignored by Git.
4. **Actual production config stays unexposed:** `worker/wrangler.jsonc` remains route-less, no real D1 database ID and global scheduler OFF by default. The configured Cron schedule alone cannot cause provider work. No automatic CI workflow should perform deploy, remote D1 creation/migrations or secret installation.
5. **CI tests must include the preflight:** `npm test` first runs the offline static gate, then ordinary tests. Mutation tests deliberately enable flags, insert a public route, replace a local D1 fake ID with a real-looking UUID, remove a migration, add secrets to public Wrangler vars, enable the inert pilot schedule, or inject a GitHub Actions deployment step; each is expected to fail. One **real local workerd/D1** acceptance test additionally proves that an active operator monitor is not claimed/reserved when Cron is globally OFF.
6. **Preflight parser constraint:** all tracked Wrangler `.jsonc` files are JSON-compatible subsets, read by `JSON.parse`. Introducing JSONC comments will intentionally fail the source preflight until a safe comment-aware parser is deliberately implemented. This is a conservative, documented fail-closed limitation.
7. **Scope boundary:** preflight performs simple static checks and cannot prove completeness of an external threat model, deployment permissions, OAuth trust, Cloudflare Free CPU usage, cross-region D1 behavior, real Google token issuance, billing or true phone-off Cron operation. An attacker who controls the GitHub repo or CI may modify source and checks together, so it is not an independent attestation.

## Architecture / explicit rejection

Do not add remote-deploy automation or "just one click" cloud creation at this stage. A remote resource write, provisioning, account login, Cron trigger update, secret value setup or billing action must require new **explicit** owner authorization and fresh account-specific review. A git commit or source test alone cannot satisfy that approval.

The offline report is deliberately simple:

```sh
npm run preflight
npm run preflight:json
npm run preflight:require-remote  # exit 2, intentionally BLOCKED
```

`source_safety: PASS` means only that *checked-in* static gates are met. `remote_readiness: BLOCKED` is the expected, safe and truthful outcome until actual deployment acceptance.

## Exit acceptance and known limits

- Source CI must pass on the exact PR HEAD including backend, local D1, live public GitHub GET in isolated D1, Android network adapter and debug APK; record original result SHA, artifact hash, any failures, merge SHA and post-merge ledger SHA.
- Real remote acceptance still requires account plan and quota inspection, paid/Free constraints, real D1 backup/migration sequence 0001–0004, published HTTPS origin, Google OAuth issuer/audience/signature, explicit mobile sync, a controlled Cron enable operation, real remote CPU/rows/usage measurements, and an independently observed phone physically OFF window.
- A future owner-approved deployment must check that prior operator-owned ACTIVE rows will not fire unexpectedly before switching `SCHEDULER_ENABLED` ON. Staging remote pilot uses no Cron until separate permission.
- All proof/rollback sequences and stop conditions are documented in [REMOTE_PILOT_READINESS](../REMOTE_PILOT_READINESS.md). Logs and public issues must never include an ID token, Worker bearer, private D1 export, OAuth secret or cloud API token.

## Primary public sources, re-verify at deployment time

- <https://developers.cloudflare.com/workers/platform/limits/>
- <https://developers.cloudflare.com/d1/platform/limits/>
- <https://developers.cloudflare.com/d1/wrangler-commands/>
- <https://developers.cloudflare.com/workers/configuration/cron-triggers/>
- <https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/>

**No cloud Worker was deployed, no remote D1 resource created or migrated, no Google OAuth account used and no real device was tested in P1-I.**
