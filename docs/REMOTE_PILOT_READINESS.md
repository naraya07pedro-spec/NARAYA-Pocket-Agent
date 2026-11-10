# P1-R release readiness gate | Owner-approved remote pilot ONLY

## P1-R: Paginated D1 owner inventory must not claim absent before complete

**New mandatory source gate (PR #24):** The [Cloudflare D1 List API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/list/) reports `result_info.total_count`, not guaranteed `total_pages`. Older P1-Q code could incorrectly treat a short first page as all databases. The inspector now reads up to **ten GET-only D1 pages** with `per_page=100`, strict page/count/total consistency, and returns `UNKNOWN` if some pages cannot be verified. `d1_pages_inspected` and `d1_inventory` distinguish `COMPLETE_FIRST_PAGE`, `COMPLETE_ALL_PAGES`, `PARTIAL_PAGES` and `UNAVAILABLE`. Database absence is never confirmed from partial results. Upstream JSON is capped **during streaming** to 262,144 bytes. Worker scripts are an official **SinglePage** response, not assumed 20-item pages.

Safe owner-only commands, from a trusted PowerShell session in the repo root (do not paste actual token, account ID or JSON response into GitHub):

```powershell
node scripts/cloudflare-readonly-inspect.mjs
# Outputs OFFLINE_DEFAULT_NO_NETWORK; remains BLOCKED.

$env:CF_READONLY_ACCOUNT_ID = Read-Host 'Cloudflare Account ID'
$privateToken = Read-Host 'Cloudflare API token (read-only)' -AsSecureString
try {
  $env:CF_READONLY_API_TOKEN = [System.Net.NetworkCredential]::new('', $privateToken).Password
  node scripts/cloudflare-readonly-inspect.mjs --inspect-live
} finally {
  Remove-Item Env:CF_READONLY_API_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:CF_READONLY_ACCOUNT_ID -ErrorAction SilentlyContinue
  Remove-Variable privateToken -ErrorAction SilentlyContinue
}
```

The actual account must be reviewed separately for plan, billing, CPU, D1 daily row usage and remaining quotas. `inventory_complete:true` is **only** a metadata-list property; it cannot certify free-tier eligibility, a deployed Worker route, event execution, signed Google token or a physically OFF Android. No Cloudflare account was accessed from the automated tests; **never** confuse a mocked API response with a live provider proof. Owner approval is separately required before any D1 remote backup/migration 0001–0005, deployment or Cron activation. [ADR-0019](ADR/0019-d1-account-inventory-pagination-and-bounded-fetch.md).

---


## P1-Q: Account inventory read-only preparation (NO DEPLOYMENT)

**Purpose:** The owner's next meaningful evidence is real Cloudflare account-specific Worker/D1/Cron inventory and plan/billing review. P1-Q implements a narrowly scoped GET-only metadata inspector; it is NOT a deployment script or license to activate Cron. External actions require explicit owner authorization and a trusted local machine.

Safe offline default, no network:

```powershell
node scripts/cloudflare-readonly-inspect.mjs
npm test
```

Optional **owner-triggered** read-only API metadata inspection, only after reviewing the source and creating a **least-privilege read-only Cloudflare token** (Workers Scripts Read/Metadata Read-Only and D1 Read). These are PowerShell examples for the owner's private terminal, **not** commands to copy into GitHub Actions or a public issue:

```powershell
$env:CF_READONLY_ACCOUNT_ID = Read-Host 'Cloudflare Account ID'
$privateToken = Read-Host 'Cloudflare API token (read-only)' -AsSecureString
$env:CF_READONLY_API_TOKEN = [System.Net.NetworkCredential]::new('', $privateToken).Password
node scripts/cloudflare-readonly-inspect.mjs --inspect-live
Remove-Item Env:CF_READONLY_API_TOKEN
Remove-Item Env:CF_READONLY_ACCOUNT_ID
Remove-Variable privateToken
```

Never paste an API token, Cloudflare Account ID, or unredacted API responses into chat, GitHub, CI or logs. The script summarizes only target Worker/D1 presence, D1 file size if returned and Cron schedule count; insufficient permissions or pagination show `UNAVAILABLE`/`PARTIAL_FIRST_PAGE`. `inventory_complete:true` means only that **these targeted API inventories were retrieved successfully**, not full account or runtime readiness. A successful GET does not verify invoice, plan, daily row use, CPU, migrations, Google OAuth, safety of the real route or physical phone OFF.

Public rules checked on 10 Nov 2026: Workers Free **10 ms CPU per Cron**, **50 subrequests/request**, **5 Cron triggers/account**; D1 Free **5M rows read/day**, **100K rows written/day**, **10 databases/account**, **500 MB/database**, **5 GB storage/account**. D1 daily read/write limits are enforced as of 1 Sep 2026. Confirm current values and **actual account** plan/usage in the Cloudflare dashboard separately. Never interpret these public allowances as measured free capacity. <https://developers.cloudflare.com/workers/platform/limits/> · <https://developers.cloudflare.com/d1/platform/limits/> · <https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/>.

This is the first read-only evidence gate before a **separate written owner authorization** for backup, migration 0001–0005, inert Worker deployment and later Cron activation. Inspector output always retains `remote_acceptance:BLOCKED`, `safe_to_deploy:false`, and `safe_to_activate_scheduler:false`. See [ADR-0018](ADR/0018-cloudflare-readonly-account-inventory.md).

---


Date checked: 10 November 2026. Code status: **offline preflight and global Cron kill-switch implemented; no remote deployment**.

This is a **human-authorized release procedure**, not a script that creates cloud resources. GitHub Actions must not deploy Workers, create remote D1, apply remote migrations, change triggers, publish Android APKs or register Google OAuth projects. A source test passing is **not** approval to execute the commands described here.

## P1-P rollback-safe first identity and monitor, mandatory test before account pilot

A newly signed-in user must be registered and receive its **first PAUSED monitor in one D1 `batch()` transaction**. An induced second-statement SQL error must leave **zero** identities and zero monitors. A valid first POST followed by a successful retry of the same `clientDraftId` must return the same monitor without creating duplicates. If an `INSERT OR IGNORE` returns zero and the identity has no monitors, only that request's candidate identity is deleted in the batch. This protects the hard 20-account pilot cap against stranded rows.

For a future **owner-approved** remote pilot, first inspect actual D1 Free quota/billing/CPU and ensure migrations **0001–0005** are present. Test a private disposable D1 environment with no secrets in repo or CI. Review row counts before and after a controlled, reversible failure experiment; **never intentionally break a live customer's production monitor**. D1 `batch()` is transactional according to [Cloudflare documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/), but batching reduces round trips, not the billed number of rows ([official query-performance guidance](https://developers.cloudflare.com/d1/observability/find-expensive-queries/)). Local success is not evidence of remote Free-tier viability.

`D1Result.meta` can be absent in the TypeScript definition, so the Worker refuses to assert successful creation when batch change counts are ambiguous. If a transaction actually committed but the response was lost, Android must retry with **the identical draft ID** and reconcile the existing monitor. See [ADR-0017](ADR/0017-atomic-first-monitor-onboarding.md).

## P1-O signed identity admission and live D1-cost acceptance

A previously unseen Google/OIDC account can now **refresh an empty signed-user monitor list without registering a durable D1 identity**. Valid unknown-account observation reads and PATCH requests return 404 without writing an identity. A new identity is created only as part of the first valid, explicit `POST /v1/sync/monitors` request, under the existing atomic 20-identity limit. At capacity, a 21st unknown user may read an empty list but may **not** create a monitor; the server returns 429 `pilot_identity_limit`. An existing registered user can still use the endpoint and is not retried through the identity INSERT path.

This is a **code-level write-attempt reduction**, not a claim of reduced Cloudflare billing. During a future owner-approved pilot, inspect D1 account usage/quota and actual row read/write counters around the consented onboarding and repeat refreshes, without placing real tokens or account IDs in the repository. Verify that incorrect Google audience/issuer tokens are rejected before route parsing; a valid malformed request does not occupy a pilot identity slot. Retain signed owner isolation and capped D1 resource use. [ADR-0016](ADR/0016-read-only-mobile-identity-admission.md).

## P1-N owner-supplied phone-OFF evidence: offline sanity check is NOT remote acceptance

P1-N provides `scripts/offdevice-evidence-gate.mjs`, a **local-only and network-free** pre-review of an owner's **private, explicitly unauthenticated** acceptance-evidence bundle. It does **not** gather Cloudflare logs, inspect account costs, mint Google tokens, start Cron, deploy D1 or control an Android phone. A structured manifest is just another assertion until an authorized reviewer checks actual external sources.

The sample [offdevice-evidence-synthetic.example.json](examples/offdevice-evidence-synthetic.example.json) is entirely invented. It is not a real Cloudflare export. Test the safe CLI:

```sh
node scripts/offdevice-evidence-gate.mjs --file docs/examples/offdevice-evidence-synthetic.example.json --json
# "structural_consistency": "PASS" only checks internal consistency.
# "remote_acceptance": "NOT_VERIFIED", "safe_to_activate_scheduler": false.
node scripts/offdevice-evidence-gate.mjs --file docs/examples/offdevice-evidence-synthetic.example.json --require-remote
# Exit 2 even for coherent evidence. Independent proof is still missing.
```

For a later **owner-approved** live pilot, retain genuine Cloudflare Cron run records, **read-only** remote D1 observation rows with `event_sequence`, verified GitHub commit references, a real physical power-OFF interval and owner-authenticated Android post-restart read. The CLI expects a bounded, strict JSON structure with matching declared times and SHA transitions; the maximum input is 65,536 bytes. **Keep private evidence outside the repository, screenshots/attachments in public issues and GitHub Actions artifacts. Never include bearer tokens, account secrets, Google ID tokens, or private D1 exports.** The CLI never echoes the input file contents.

Even after a structural PASS, a human reviewer must independently verify **account/provider provenance, Free-plan CPU/quotas and billing, migration 0001–0005, Google OAuth on real Android, and actual powered-OFF phone state**. The existing generic `scheduled_tick` log is not cryptographically linked to a specific D1 observation; a matching timestamp is only a heuristic. Real deployment remains **BLOCKED without explicit owner approval**. See [ADR-0015](ADR/0015-offdevice-acceptance-evidence-gate.md).

## P1-M mandatory migration and order-of-operations (10 November 2026)

**Supersedes the older migration 0001–0004 checklists below:** any future owner-approved remote pilot MUST apply, back up and validate additive D1 migrations **0001→0002→0003→0004→0005**, in that order, **before deploying the P1-M Worker or a P1-M-configured Android client**. Migration 0005 adds a durable observation event sequence, backfills **each existing observation row**, and creates indexes. Even if the source is additive, these are **remote D1 writes** that can use account-specific Free quota/CPU and require a verified backup, an inspection of row counts, explicit authorization and a rollback/stop plan. No commands were executed remotely in P1-M.

A 0004-only database must fail closed: mobile `PATCH ACTIVE` returns `503 scheduler_storage_unavailable`, while `runScheduler()` aborts before reservation/provider requests; owner PAUSE remains available. Inspect old ACTIVE monitors and actual Cron activation flags before the separate operator-approved rollout. Once migrated, verify `SELECT event_sequence FROM observations ORDER BY event_sequence DESC LIMIT 5` on the owner-approved database read-only, confirm historical IDs/head SHAs stayed unchanged and new events have greater sequence than retained rows. Validate actual remote D1 costs/CPU separately before enabling Cron. SQLite ROWID backfill does not provide cryptographic provenance. [ADR-0014](ADR/0014-durable-observation-sequence.md).

## What the source can prove automatically

Run locally or in CI from the repository root:

```sh
npm ci --ignore-scripts
npm run preflight
npm run preflight:json
npm test
npm run typecheck
```

`npm run preflight` is entirely offline: checks checked-in Wrangler configs, inactive global/mobile Cron flags, migrations 0001–0005, fake local D1 binding, public OAuth/Worker config disabled in Android by default, absence of accidentally automated deploy workflows and public secret variables. It **intentionally** prints two separate statuses:

- `source_safety: PASS` when the checked-in source passes static safety gates.
- `remote_readiness: BLOCKED` until owner/account/provider/device proof is independently obtained. Even a future route/UUID in source **does not** certify account usage, OAuth correctness, real Cloudflare CPU time or phone-off acceptance.

`npm run preflight:require-remote` returns exit code **2** (BLOCKED) in the current source. It does **not** deploy anything. Machine-readable status is available with `--json`, so no green source test can be presented as a completed remote pilot.

## P1-L owner-approved observation timeline acceptance

For a future remote pilot, the operator must first prove the Worker/D1 Cron actually generated observations while Android was **physically powered OFF**, using independent UTC timestamps, safe audit/usage records and post-power-on signed-owner retrieval. The Android client now additionally rejects an impossible SHA predecessor chain in a fully timestamp-ordered result. Demonstrate at least BASELINE → CHANGE → CHANGE with verified public GitHub SHA changes, and preserve the raw redacted D1 event timestamps/IDs to distinguish remote execution from local synthetic JSON.

If multiple actual observations have exactly the same millisecond timestamp, the Worker breaks ties by random UUID, which is **not a causal ordering**. The client cannot assert full predecessor continuity in that case; do not misreport successful parsing as proof of a complete chain. The 50-row limit can omit old BASELINE events. See [ADR-0013](ADR/0013-observation-history-cross-runtime-contract.md). No account, live event or owner approval was used to execute this checklist in P1-L.

## P1-K Android client acceptance prerequisite: no false ACTIVE interpretation

In any owner-approved remote pilot, the APK's cloud monitor list **must show** three independent concepts: stored server `ACTIVE/PAUSED` state, eligibility from the **last verified GET/PATCH server response**, and lack of independent evidence of actual remote Cron execution. Test a previously ACTIVE monitor, flip the global Cron switch OFF and refresh the mobile list: it must show **stored ACTIVE but scheduler eligibility OFF**, not “monitoring is currently running.” Verify that PAUSE clears eligibility, a rejected ACTIVE leaves old state unchanged and a `503 scheduler_storage_unavailable` explains the missing D1 budget migration without logging an ID token.

The P1-K Kotlin client requires explicit real JSON Booleans `schedulerEligible` and `scheduled` for all monitor rows; older backend deployments missing those fields are **not** accepted silently. Update server and APK under the same controlled rollout, with operator-approved staged tests. An APK build alone is not a real phone-off acceptance. [ADR-0012](ADR/0012-android-cloud-truth-and-fail-closed-recovery.md).

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

An owner-approved remote D1 setup must apply **0001→0002→0003→0004→0005**, preserving existing monitors/owners, P1-H budget row and P1-M durable observation sequence. Migration 0005 must be backed up and cost-reviewed before applying. For an existing database, securely export a backup before migrations and verify that it can be recovered. Official commands are documented here: <https://developers.cloudflare.com/workers/wrangler/commands/d1/>.

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
