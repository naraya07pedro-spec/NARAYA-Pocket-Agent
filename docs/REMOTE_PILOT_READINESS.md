# P1-I release readiness gate | Owner-approved remote pilot ONLY

Date checked: 10 November 2026. Code status: **offline preflight and global Cron kill-switch implemented; no remote deployment**.

This is a **human-authorized release procedure**, not a script that creates cloud resources. GitHub Actions must not deploy Workers, create remote D1, apply remote migrations, change triggers, publish Android APKs or register Google OAuth projects. A source test passing is **not** approval to execute the commands described here.

## What the source can prove automatically

Run locally or in CI from the repository root:

```sh
npm ci --ignore-scripts
npm run preflight
npm run preflight:json
npm test
npm run typecheck
```

`npm run preflight` is entirely offline: checks checked-in Wrangler configs, inactive global/mobile Cron flags, migrations 0001–0004, fake local D1 binding, public OAuth/Worker config disabled in Android by default, absence of accidentally automated deploy workflows and public secret variables. It **intentionally** prints two separate statuses:

- `source_safety: PASS` when the checked-in source passes static safety gates.
- `remote_readiness: BLOCKED` until owner/account/provider/device proof is independently obtained. Even a future route/UUID in source **does not** certify account usage, OAuth correctness, real Cloudflare CPU time or phone-off acceptance.

`npm run preflight:require-remote` returns exit code **2** (BLOCKED) in the current source. It does **not** deploy anything. Machine-readable status is available with `--json`, so no green source test can be presented as a completed remote pilot.

## P1-J activation prerequisite: no half-armed cloud monitors

As a source-level safeguard, Android-signed `PATCH ACTIVE` must not succeed merely because the mobile permission is ON. The server requires **both** independently configured `SCHEDULER_ENABLED='true'` and `MOBILE_SCHEDULING_ENABLED='true'`, a valid `OWNER_ID`, and the **actual D1 `scheduler_control` row with migration 0004 budget fields**. Missing flags produce HTTP 409 `scheduler_disabled`; missing/invalid D1 control produces HTTP 503 `scheduler_storage_unavailable`. Operators must apply all migrations and confirm the control state **before** opening the final activation gate. Signed-owner PAUSE is always permitted with Cron OFF.

An already ACTIVE monitor may retain its stored status when the global Cron permission is disabled for maintenance, but its server `schedulerEligible` value must be false and **no Cron provider calls** should occur. Re-enabling global permission could make previously ACTIVE monitors due again; inspect/PAUSE them before separately approving activation. This is a local source contract, not evidence of a deployed Cloudflare trigger. [ADR-0011](ADR/0011-dual-scheduler-authorization.md).

## Specific blockers in today's checked-in configuration

- **Worker inaccessible to Android:** `worker/wrangler.jsonc` has `workers_dev:false` and no public route/custom domain. It is intentionally not a public HTTPS API endpoint.
- **Remote D1 unresolved:** production config lacks a real `database_id`. The UUID in `worker/wrangler.local.jsonc` is a test-only placeholder, never deploy it.
- **Global Cron now OFF by default:** `SCHEDULER_ENABLED` must equal literal `true` before the Worker scheduled handler performs any D1/provider I/O; `MOBILE_SCHEDULING_ENABLED` is an independent, default-OFF permission. Merely listing `*/15 * * * *` in Wrangler does not activate processing.
- **Google OAuth unconfigured:** Android build defaults to blank public Web Client ID and blank fixed HTTPS Worker origin. The real Android app package/signature and OIDC `issuer`/`audience`/JWKS URL have not been verified using a real issued token.
- **Remote CPU/account unknown:** Cloudflare Free publishes **10 ms CPU per Cron trigger** and **50 subrequests per invocation**. D1 Free has its own query, row-read/write and storage quotas. 43/43 Node tests or local D1 tests cannot certify remote CPU or billing. <https://developers.cloudflare.com/workers/platform/limits/> and <https://developers.cloudflare.com/d1/platform/limits/>.
- **Phone power-off experiment missing:** no physically powered-off device, real remote Cron event, authenticated remote D1 observation or post-restart mobile reconciliation has been recorded.

## Only after EXPLICIT owner approval and actual quota validation

### Gate A: read-only account and identity review

The owner, on their **own trusted machine/account**, inspects the Workers plan, 10ms Cron CPU, remaining Cron triggers, D1 database count/rows used, billing state, and the account's Workers/D1 dashboards. Some `wrangler` commands below require sign-in; none are run automatically. Example commands, only when the owner has chosen to inspect the account:

```sh
npx wrangler whoami
npx wrangler d1 list --json
npx wrangler d1 info <OWNER_SELECTED_DATABASE> --json
npx wrangler d1 migrations list <OWNER_SELECTED_DATABASE> --remote
```

No account ID, secret, OAuth access token, live bearer or private D1 records should be pasted into public issues or uploaded to GitHub Actions. **Cloudflare Free is not an unlimited provider**: D1 enforced free daily row limits beginning 1 September 2026, and exhausted limits can cause requests to fail. <https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/>

### Gate B: owner-approved, inert pilot manifest (still no Cron work)

`worker/wrangler.pilot.example.jsonc` is a deliberately **unusable template**, not a deploy target: it contains `REPLACE_ME` in the Worker name and a non-UUID `database_id`; it sets `workers_dev:true`, **`triggers.crons:[]`**, and both scheduler flags to `false`. Its only purpose is to show how a separately approved remote test can have a public HTTPS origin **without scheduled work**. Do not copy fake database IDs or enable remote access to an arbitrary host.

If owner approves a remote pilot, copy the template to ignored `worker/wrangler.pilot.jsonc`, use a separately provisioned D1 UUID, and confirm Worker URL ownership, Google OAuth package/signature and public Web Client ID. The copied file must remain uncommitted. An actual `workers.dev` subdomain may depend on account/domain availability; do not invent a URL.

Production source `worker/wrangler.jsonc` intentionally remains inaccessible as checked in. Do not enable the public endpoint merely to make an automated CI test green.

### Gate C: migration, backup, dry-run (these are NOT approved or executed)

An owner-approved remote D1 setup must apply **0001→0002→0003→0004**, preserving existing monitors/owners and P1-H budget row. For an existing database, securely export a backup before migrations and verify that it can be recovered. Official commands are documented here: <https://developers.cloudflare.com/workers/wrangler/commands/d1/>.

```sh
# READ-ONLY remote inspection (after owner authenticates):
npx wrangler d1 migrations list <OWNER_SELECTED_DATABASE> --remote
# OPTIONAL BACKUP after owner approval; export includes potentially sensitive records:
npx wrangler d1 export <OWNER_SELECTED_DATABASE> --remote --output=./cloudflare-exports/private-backup.sql

# WRITE OPERATIONS: DO NOT EXECUTE without explicit owner authorization:
# npx wrangler d1 migrations apply <OWNER_SELECTED_DATABASE> --remote
# npx wrangler deploy --config worker/wrangler.pilot.jsonc
```

The backup directory is ignored by Git. A Wrangler `deploy --dry-run` can compile without publishing when the owner has a valid local config and toolchain; a successful compile **does not** prove that Cloudflare Free CPU or network conditions will support a real Cron.

### Gate D: real signed-user/manual cloud acceptance before scheduling

On a consenting Android with the exact installed APK hash, obtain a **genuine** Google ID token from Credential Manager and verify that a trusted deployed Worker accepts its RS256 signature, `iss`, `aud`, `exp`, and `sub`. Test `GET /v1/sync/monitors` then a **single explicit** `POST` for a selected public repository. Verify stable draft ID under retry, 404 on a foreign monitor for another signed user, 401 clears session, and no corruption of cached local SHA under network failure.

A public Web Client ID is **not a secret**; an OAuth client secret, owner API bearer, or real user's Google ID token **must not be embedded in an APK or a public issue**. Restrict the Worker hostname to a trusted owner-controlled HTTPS origin.

### Gate E: explicitly authorize Cron and run a real phone-off experiment

Only if Gate D and fresh Free-tier account checks pass, the owner separately approves adding the Cron schedule to the **pilot** and switching on `SCHEDULER_ENABLED='true'` and (for user-owned monitors) `MOBILE_SCHEDULING_ENABLED='true'`. Never enable both implicitly while creating the Worker. Check that no existing ACTIVE operator monitor would make an unexpected request. The P1-H budget allows at most three reservations per **fixed 15-minute UTC bucket** for one D1 database, not three per rolling 15 minutes, and the mobile owner needs explicit ACTIVE status.

Record, using sanitized nonsecret evidence: exact Worker deployment/version hash, live Cron invocation IDs/timestamps (UTC), remote `budget_window_start/budget_claims`, owner-scoped monitor and observation IDs, GitHub commit SHA, the device's actual power-off and power-on timestamps, post-restart Android reconciliation, Cloudflare CPU and query/row usage, billing/plan snapshot and rollbacks. Fail the experiment if the device was merely screen-locked or the Cron ran only in GitHub Actions local workerd.

### Gate F: emergency kill-switch and rollback

When resources or errors are unexpected, **immediately set global `SCHEDULER_ENABLED` to `false`** or remove Cron triggers in the owner-controlled pilot Worker config. This is an operator-authorized remote config/deploy operation, not an automatic action here. Next, pause user monitors by authorized APIs, inspect in-flight leases, usage counters and audit logs, and disable public access if token/domain trust is uncertain. Do not delete D1 or roll back additive migrations by dropping columns; preserve remote data and restore from a verified backup only with separate explicit approval. A restart or crash must not be mistaken for a quota reset.

## Acceptance classification

| Claim | Current status | Required evidence |
| --- | --- | --- |
| Source static gates / OFF-by-default Cron | Implemented and CI-gated | Source preflight, tests, exact SHA |
| Workerd/D1 migration and scheduler integration | Locally verified through P1-H | Local workerd/D1 CI on exact SHA |
| Real owner Google OAuth login | **NOT VERIFIED** | Live issued token, verified issuer/audience and signed Android |
| Cloudflare Free CPU/limits and costs | **NOT VERIFIED** | Owner account-specific usage and actual Cron CPU trace |
| Cloudflare remote D1/Cron running while phone OFF | **NOT VERIFIED** | Independent remote invocation, database observations, device power-off evidence |
| Production-ready Android cloud sync | **NOT VERIFIED** | Physical on-device E2E and error/offline acceptance |

Source-of-truth evidence: [PROGRESS](PROGRESS.md), [EVIDENCE](EVIDENCE.md), [ADR-0010](ADR/0010-default-off-cron-release-gate.md), and [Issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8). No cloud resources were created, deleted, migrated, enabled, deployed, or billed by this milestone.
