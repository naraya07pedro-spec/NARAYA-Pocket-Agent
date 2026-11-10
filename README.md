# NARAYA Pocket Agent

## P1-U exact Cron-to-D1 evidence correlation (PR #27, source/local only)

The scheduled Worker now includes a bounded array of actual persisted D1 `observations.id` UUIDs in the `scheduled_tick` log, and **only** when the existing transactional D1 batch confirms a new observation. Repeated identical HEAD, failed fetches and stale leases do not generate fictional IDs. This improves the future phone-OFF acceptance evidence from a loose timestamp heuristic to **exact Cron log UUID -> D1 row UUID** matching, without a D1 migration, new provider API call, Android background service or cost-bearing infrastructure. The strict, offline-only owner evidence gate is now v2 and rejects a timestamp-only match. A synthetic JSON example passing the structural gate is **still not authenticated Cloudflare proof**. No real cloud account, D1/Cron deployment, OIDC phone sign-in or physically powered-OFF test occurred. See [ADR-0022](docs/ADR/0022-cron-d1-observation-id-correlation.md), [PROGRESS](docs/PROGRESS.md), [EVIDENCE](docs/EVIDENCE.md).


**Android-first agent, cloud-resident execution.** Built for lightweight phones, bounded autonomy, and verifiable results even when the phone is switched off.

> **Status: P1-T billing evidence integrity MERGED via PR #26 (PR HEAD 124/124 Node, 11/11 D1 local, 20/20 Android JVM, 5/5 CI; real Cloudflare billing NOT_VERIFIED). P1-S owner Billing Read preflight MERGED via PR #25 (PR HEAD 114/114 Node, 11/11 local D1, 20/20 Android JVM, 5/5 CI; actual Cloudflare billing and Free plan NOT_VERIFIED). P1-R Cloudflare D1 inventory pagination/stream-bounds fix MERGED via PR #24 (final PR HEAD 100/100 Node, 11/11 local workerd/D1, 20/20 Android security JVM, 5/5 CI). P1-Q is MERGED via PR #23. P1-P atomic onboarding is already merged via PR #22. No account inspection, remote deployment or real physical-device acceptance.** Checked-in Worker has no public route or remote D1 UUID; global Cron and mobile scheduling are independently OFF. No cloud agent is deployed, Google OAuth login is not verified, and the default Android APK has no cloud origin or Web Client ID. The Android APK can make a manual, read-only public GitHub HTTPS request and retain its last verified commit SHA offline. Verified with JVM/CI and debug APK builds, not a physical device. **Cloudflare remote D1/Cron, phone-off autonomy, production auth and RAM/battery measurements are NOT verified.**

## What actually works in this milestone

- TypeScript Cloudflare Worker HTTP API with high-entropy owner-token authentication for **developer/owner use only**.
- Cloudflare D1 schema for monitors, observations, execution leases, and redacted audit events.
- Cron-triggered public GitHub default-branch commit-head monitoring using official read-only REST calls.
- Durable baseline/change observations; atomic conditional lease claims, fencing, pausing, stale-version rejection, bounded retries, and auto-pause after 5 consecutive failures.
- Strictly bounded workload: at most **3 monitors per owner**, max 3 checks per Cron invocation AND at most 3 reserved provider attempts per fixed UTC 15-minute window shared across invocations using one D1 database (requires migration 0004), intervals 30–1,440 minutes, fixed GitHub API hostname, no redirects, no outbound writes, no paid model API.
- Automated Node/SQLite, real **local** Cloudflare workerd/D1, JVM Android, Android debug APK and public GitHub GET verification on GitHub Actions. Exact current test counts, SHAs and environment distinctions are in [EVIDENCE](docs/EVIDENCE.md), rather than historical figures.

**Why this matters:** the cloud scheduler does not depend on any Android process. Actual off-device acceptance is pending until an owner-authorized Cloudflare deployment is running.

## P1-T evidence-preserving billing risk detection (PR #26 MERGED, code/CI only)

A source-level audit found that P1-S could miss a Cloudflare **non-free subscription rate plan** when the optional `price` field was absent, and could erase an **already observed positive historic billing amount** if a later API history page failed. P1-T now conservatively flags non-free rate plans and `AwaitingPayment`, leaves ambiguous subscription states **UNKNOWN**, and retains positively observed history while marking a later failed page incomplete/unavailable. Ten new adversarial mocked-API tests were added (Node suite **124** at code checkpoint). No billing amount, invoice, account ID or token is printed. **A potential billing-risk signal is not proof of an actual bill, and an empty account inventory is not proof of future Rp0.** No real Cloudflare account has been accessed, no cloud deployment/Cron/OAuth or physical phone-off acceptance performed. See [ADR-0021](docs/ADR/0021-monotonic-billing-evidence-and-subscription-risk.md), [PROGRESS](docs/PROGRESS.md), [EVIDENCE](docs/EVIDENCE.md).

## P1-S Cloudflare owner billing risk review (PR #25 MERGED, source/CI only)

The P1-S milestone adds an **offline-default**, owner-triggered [Billing Read-only inspector](scripts/cloudflare-billing-readonly.mjs) for account subscriptions and paginated history. It requires a **separate scoped Billing Read API token** in the owner's private local environment; it makes **GET-only** Cloudflare API requests, with bounded responses and sanitized output (no invoice/customer/account details or monetary amounts). Fourteen new adversarial mock tests target false Free-plan assumptions, unreadable/incomplete history, secret redaction and response-size limits. Even a successful read produces **no Free-plan, estimated cost, usage quota, Workers CPU, account bill or phone-OFF proof**, and **cannot authorize deployment or Cron**. See [ADR-0020](docs/ADR/0020-owner-cloudflare-billing-readonly-preflight.md), [owner runbook](docs/REMOTE_PILOT_READINESS.md) and [PROGRESS](docs/PROGRESS.md). **No Cloudflare owner account was accessed**, no resource created and no new fees triggered.

## P1-R honest paginated Cloudflare account inventory (PR #24 MERGED, source/local only)

Audit against the official Cloudflare D1 API exposed a P1-Q false-completeness risk: `result_info.total_count` may exceed the first page's row count even when `total_pages` is missing. The owner-operated, opt-in read-only GET inspector now validates page/total/count contracts across at most **10 x 100 D1 rows**, never asserts an unseen database absent when pages are incomplete, verifies database identity before accepting a size, and limits response bytes **while streaming**, not after buffering. Worker Script List follows its published SinglePage contract. Eleven additional offline adversarial tests (18 inspector tests total) cover pagination, failure paths and error sanitization; backend Node suite is **100/100** at code checkpoint, with Android and local D1 workflows also green. The owner has **not** connected a real Cloudflare account. No deploy, new costs, Cron activation or physical phone-off acceptance. See [ADR-0019](docs/ADR/0019-d1-account-inventory-pagination-and-bounded-fetch.md), [PROGRESS](docs/PROGRESS.md), [EVIDENCE](docs/EVIDENCE.md).

## P1-Q read-only Cloudflare account readiness preparation (PR #23 MERGED; still no cloud account access)

Before requesting approval for Cloudflare migration/deploy, the owner can run `npm run cloudflare:inspect-offline` to see a **NO NETWORK / BLOCKED** status. With an owner-created least-privilege token held only in local environment variables, the explicit `npm run cloudflare:inspect-live` makes strictly allowlisted Cloudflare API **GET** requests for targeted Worker/D1/Cron metadata. The inspector never runs in CI against a real account, emits no token/account ID/D1 UUID, and can never mark release or remote acceptance safe. Seven new mocked-fetch adversarial tests pass at the source code checkpoint, bringing Node to **89/89**. This does **not** verify actual Free CPU/billing/usage, D1 remote migrations, Google OAuth or a physically powered-OFF Android. See [ADR-0018](docs/ADR/0018-cloudflare-readonly-account-inventory.md), [EVIDENCE](docs/EVIDENCE.md), and [remote owner-only instructions](docs/REMOTE_PILOT_READINESS.md).

## P1-P transactionally safe first monitor registration (PR #22 merged, source/local CI only)

A new signed owner previously received a durable D1 identity **before** the first monitor was inserted in a separate DB operation. A failed or ignored monitor insert could strand that identity against the 20-owner pilot cap. The first valid `POST /v1/sync/monitors` now uses **one D1 `batch()` transaction**: register the capped unique identity, insert the first **PAUSED** monitor using the winning mapped owner ID, and conditionally delete the request's own candidate identity **if no monitor was persisted**. Any SQL exception causes D1 to roll back the batch. D1 batch metadata is checked rather than assuming a monitor was saved.

Existing owners and first signed GET list remain read-only where appropriate, and draft replay is still idempotent. Tests inject an actual local Cloudflare D1 SQL constraint failure after the first identity INSERT and verify rollback; Node tests also cover a silently ignored monitor insert and an ambiguous already-committed batch response. A network failure after a committed operation requires replay using the **same clientDraftId**, not a fresh monitor ID. **These are source/local proofs, not live Cloudflare billing or phone-OFF proofs.** See [ADR-0017](docs/ADR/0017-atomic-first-monitor-onboarding.md), [PROGRESS](docs/PROGRESS.md), [EVIDENCE](docs/EVIDENCE.md).

## P1-O mobile sync read-only D1 registration (PR #21 merged, local tests only)

Previously every valid signed-user sync request attempted a D1 `INSERT INTO user_identities`, including repeated GETs, and malformed calls could consume one of the 20 pilot identity slots before input validation. Now **Google/OIDC JWT authentication is first, followed by route/UUID/body validation**, then an indexed existing-user lookup. Only a user's **first valid, explicit cloud-monitor POST** performs atomic identity registration. First GET of an empty cloud list returns `{"monitors":[]}` without changing D1. Unknown monitor reads and PATCH for unregistered users return 404 without onboarding. Known accounts issue no additional identity INSERT attempts on repeated GET/PATCH/POST.

The backend retains the original 20-account hard cap, one-monitor-per-draft idempotency, cross-owner isolation, and default-PAUSED monitor creation. Node statement instrumentation and real local workerd/D1 tests protect this behavior, but **real D1 billing/CPU cost savings are not measured**. No cloud account was accessed. See [ADR-0016](docs/ADR/0016-read-only-mobile-identity-admission.md), [PROGRESS](docs/PROGRESS.md), [EVIDENCE](docs/EVIDENCE.md).

## P1-N honest offline phone-OFF evidence review (PR #20 merged, source/local CI only)

A real cloud pilot will need independent evidence that Cloudflare Cron produced a D1 observation while Android was **physically switched OFF**, followed by authenticated sync after restart. Passing GitHub Actions or entering a plausible JSON timeline does **not** prove that. P1-N adds an entirely offline, no-network **structural evidence verifier** that checks a declared OFF/ON interval, Cron/D1 timestamps, monotonic D1 `event_sequence`, SHA predecessors, GitHub corroboration and post-restart observation IDs.

Run a clearly fictional example to understand its safe behavior:

```sh
node scripts/offdevice-evidence-gate.mjs --file docs/examples/offdevice-evidence-synthetic.example.json --json
node scripts/offdevice-evidence-gate.mjs --file docs/examples/offdevice-evidence-synthetic.example.json --require-remote
```

The first may return `structural_consistency:PASS` (only an internal consistency check). The second **always exits 2** because `remote_acceptance` is permanently `NOT_VERIFIED`; no user-supplied manifest can authorize deployment, change Cron permissions, or authenticate a real provider. Keep any future private evidence **outside GitHub, git commits and CI artifacts**, do not include Google tokens or Cloudflare secrets. Android's D1 failure guidance and the owner-only migration checklist now correctly require **0001–0005**. See [ADR-0015](docs/ADR/0015-offdevice-acceptance-evidence-gate.md), [EVIDENCE](docs/EVIDENCE.md), [REMOTE_PILOT_READINESS](docs/REMOTE_PILOT_READINESS.md).

## P1-M durable observation sequence (PR #19 merged; source CI, no cloud deployment)

Migration `worker/migrations/0005_observation_event_sequence.sql` copies historical observation insertion order into a durable `event_sequence` column with unique and owner-monitor lookup indexes. The bounded signed-owner observation API sorts by this field, rather than timestamp/UUID. The existing fenced D1 insert allocates the next retained sequence in the same SQL statement. Android now **verifies every SHA predecessor, even for events with identical or backward timestamps**, using strictly positive descending numeric sequences; missing/forged fields fail closed. Shared fixture v2 and local Cloudflare workerd/D1 tests verify the contract and persistence after simulated restart.

**Migration 0005 is mandatory before any future Worker or Android rollout**, not a remote migration already performed. Signed-user ACTIVE and the operator Cron refuse work when the column is absent, before a provider GET; signed-owner PAUSE remains allowed. A future real D1 backfill may consume Free row writes/CPU and requires explicit owner approval, backup and account quota review. This is a database insertion-order guarantee among retained rows, **not a cryptographically signed log or proof of phone-off cloud execution**. See [ADR-0014](docs/ADR/0014-durable-observation-sequence.md), [PROGRESS](docs/PROGRESS.md), [EVIDENCE](docs/EVIDENCE.md).

## P1-L linked observation integrity and shared JSON contract (PR #18 merged, local CI only)

The Android client previously accepted individually valid but **mutually contradictory** GitHub change events. The observation parser now rejects duplicate BASELINE records, no-op CHANGE events and broken adjacent SHA predecessor chains when event timestamps are distinct. The latest-50 page may legitimately omit its historical baseline. When events share a millisecond, server order uses random UUIDs; Android does **not** invent a causal order from this tie-break and cannot guarantee full chain coherence in that special case.

A single nonsecret [test JSON resource](android/app/src/test/resources/mobile-observations-v1.json) is now consumed by both the signed-owner Worker HTTP integration test and Android JVM, so field names, types and ordering are checked against one contract. A **separate** local scheduler integration test proves genuine local BASELINE → CHANGE → CHANGE transitions with fake GitHub SHA responses. Neither is evidence of an independently running remote Cloudflare Cron or a powered-off phone. See [ADR-0013](docs/ADR/0013-observation-history-cross-runtime-contract.md), [PROGRESS](docs/PROGRESS.md), [EVIDENCE](docs/EVIDENCE.md).

## P1-K Android cloud state must tell the truth (PR #17 merged, local CI only)

The Android client previously **ignored** backend `schedulerEligible` and `scheduled` and showed just stored `ACTIVE`, risking a false “running” impression when global Cron was OFF. The client now requires both **real JSON Booleans**, rejects contradictory/missing values, and displays the stored status separately from **eligibility in the last successful server snapshot** and independently **unverified** remote execution. Both the cloud monitor panel and each synced local draft use this distinction; versioned PAUSE/ACTIVATE acknowledgements update the monitor and eligibility together.

The app also distinguishes **503 `scheduler_storage_unavailable`** (the operator must inspect additive D1 migrations 0001–0004) from generic outages without exposing raw server data, and reads all backend-valid 15-minute interval increments. Local creation presets remain unchanged. Android JVM tests cover strict flag validation, status fencing, actionable 503 and interval compatibility; this is **not an installed-device or live Cloudflare acceptance**. See [ADR-0012](docs/ADR/0012-android-cloud-truth-and-fail-closed-recovery.md), [EVIDENCE](docs/EVIDENCE.md) and [ANDROID_ACCEPTANCE](docs/ANDROID_ACCEPTANCE.md).

## P1-J signed-user activation requires both Cron permissions and budget schema (PR #16 merged, CI only)

The backend previously permitted `PATCH ACTIVE` when the mobile flag was ON even if the **global Cron kill-switch was OFF**. This was misleading: the Android UI could receive 200 ACTIVE even though the Worker would not schedule a provider GET. A new shared predicate requires **literal `SCHEDULER_ENABLED='true'` AND `MOBILE_SCHEDULING_ENABLED='true'`**, plus a valid operator context. `schedulerEligible` becomes false immediately when either flag is OFF. **The owner can still PAUSE a monitor even if Cron is disabled**, and historical ACTIVE records are not silently erased.

The server also refuses activation when required **D1 scheduler budget migration 0004** and its control row are absent, returning `503 scheduler_storage_unavailable` without modifying monitor status. `GET /v1/me` now truthfully reports that the backend has an implemented `monitorSync` contract (`true`) and whether mobile activation flags are configured. **Neither response guarantees remotely running Cron or actual Google sign-in.** A signed two-user test now exercises the real Worker `scheduled()` callback through local D1, not just its internal helper. See [ADR-0011](docs/ADR/0011-dual-scheduler-authorization.md), [PROGRESS](docs/PROGRESS.md), [EVIDENCE](docs/EVIDENCE.md).

## P1-I default-OFF Cron and offline release gate (PR #15 merged; not deployed)

The Worker `scheduled()` entrypoint now **returns before any D1 or GitHub request unless `SCHEDULER_ENABLED === 'true'`**. The existing `MOBILE_SCHEDULING_ENABLED` gate is independent. Therefore merely deploying the Worker with a Cron definition would not activate operator or mobile provider checks. An explicit opt-in is required after owner approval.

`npm run preflight` runs **locally with no network or cloud account access** and is mandatory inside `npm test`. It validates checked-in Cron flags, migration chain 0001–0004, no automated cloud deploy workflows, local fake D1, absence of literal secrets and Android's empty public OAuth/origin defaults. A green `source_safety: PASS` **never** changes `remote_readiness: BLOCKED`; `npm run preflight:require-remote` exits 2 intentionally.

The pilot starter `worker/wrangler.pilot.example.jsonc` contains an invalid D1 placeholder and name, a potential user-facing Workers HTTPS route, **no Cron triggers**, and both scheduler flags OFF. It is **not** deploy-ready and is not a grant to create resources. Any real cloud test requires explicit approval, verified Free-tier CPU/D1/quotas, Google OAuth and an account-specific rollback plan. See [ADR-0010](docs/ADR/0010-default-off-cron-release-gate.md) and [REMOTE_PILOT_READINESS](docs/REMOTE_PILOT_READINESS.md).

## P1-H D1-global Cron quota guard (PR #14 merged, local CI only)

Two overlapping Worker Cron invocations can defeat a per-invocation request cap. The scheduler now atomically reserves one of **three provider attempt slots in each fixed UTC quarter-hour** on the shared D1 `scheduler_control` row **before** a GitHub request, and refunds a slot only when a monitor lease is definitely not obtained. Applies to both legacy operator mode and opt-in mobile mode; the latter stays OFF by default. `0004_global_scheduler_budget.sql` is an **additive, mandatory pre-deployment migration**. Missing migration or backward clock replay fails closed.

**Precise limits:** three per *fixed* 15-minute UTC bucket is **not** three in a rolling 15-minute span, and tasks might be delayed by backlog or crashes. Only Workflows sharing the exact same D1 database share the quota; none of this proves Cloudflare remote execution or account expenses. See [ADR-0009](docs/ADR/0009-d1-global-cron-budget.md), [PROGRESS](docs/PROGRESS.md) and [EVIDENCE](docs/EVIDENCE.md).

## P1-G OIDC JWKS reliability and cost guard (PR #13, source-verified)

The server-side RS256 verifier now optionally reuses **public signing-key JWKS** through a dedicated Cloudflare `caches.open('naraya-pocket-agent-public-jwks-v1')` namespace. The provider must explicitly allow public max-age caching; TTL is at most five minutes, data is bounded, tokens and user identity are never cached, and **every** token still receives a separate cryptographic verification. Expired keys + provider outage fail closed, never use stale identity data. Cache unavailable => use a fresh provider read, with no presumption of fewer remote requests. An initial unsafe cross-request Promise design was abandoned during red-team review. See [ADR-0008](docs/ADR/0008-request-safe-oidc-jwks-cache.md), [PROGRESS](docs/PROGRESS.md), [EVIDENCE](docs/EVIDENCE.md). **No Google-issued token or Cloudflare remote hit rate has been tested**.

## P1-F Android monitor controls (merged PR #12, source CI only)

With a real configured, trusted OAuth/Worker environment, a signed-in user can explicitly request server-side `ACTIVE` or `PAUSED` for their own monitor using optimistic `expectedVersion`, and read server-recorded `BASELINE`/`CHANGE` observations. Android never fabricates cloud success; it validates exact status/version and observation provenance, and refuses arbitrary host/route extensions. HTTP 409 is safely classified into scheduler-disabled, stale-version, or active-limit without revealing error bodies. **The default mobile scheduler is OFF**, so requesting activation from an unconfigured deployment is rejected. None of this proves actual Cloudflare D1/Cron, a real signed-in device or phone-off autonomy. See [ADR-0007](docs/ADR/0007-android-cloud-control-observation-evidence.md), [PROGRESS](docs/PROGRESS.md), and [EVIDENCE](docs/EVIDENCE.md).

## P1-E Android signed-in cloud bridge, disabled by default

Merged PR #11 adds Google Credential Manager explicit sign-in, in-memory only Google ID token, owner-scoped backend monitor reconciliation, one-draft idempotent cloud POST, and typed offline/401/409/429 failure handling. Public `narayaGoogleWebClientId` and `narayaApiOrigin` Gradle properties must be explicitly configured by the operator; both are **empty by default**. The Android app never contains the legacy `OWNER_API_TOKEN` and never stores the user ID token in SharedPreferences.

**CI-only status**: Android APK and JVM test build succeeded after pinning an SDK compatible with the existing Kotlin toolchain. Real Google OAuth registration, Android login with a genuine token, remotely deployed Cloudflare Worker/D1/Cron, and powered-off phone execution are all **not verified**. Sync creates a **PAUSED** cloud monitor; the later P1-F Android source adds an explicit status/observation UI, but there is still no automatic phone-side polling or live production evidence. See [ADR-0006](docs/ADR/0006-android-google-identity-manual-sync.md), [Android README](android/README.md), [Evidence](docs/EVIDENCE.md), and [Android acceptance](docs/ANDROID_ACCEPTANCE.md).

## Experimental P1-C backend identity boundary (merged PR #7; not deployed)

The separate read-only `GET /v1/me` endpoint requires an RS256-signed identity JWT, validated server-side against **operator-configured** `OIDC_ISSUER`, `OIDC_AUDIENCE`, and `OIDC_JWKS_URL` (HTTPS). Without these settings it fails closed. The issuer must exactly match the token; the JWKS URL is never taken from token headers. Response on verified identity: `{"authenticated":true,"capabilities":{"monitorSync":false}}`.

**Historical P1-C statement, superseded at source level by P1-E/P1-F:** CI verifies generated RSA signatures and synthetic JWKS, not real provider login. The Android OAuth/owner sync UI is now implemented as source code, but real Google login, remotely deployed Cloudflare, and actual phone-off autonomy remain unverified. Server-side per-user SQL authorization and draft-sync API are separately implemented below. Legacy owner bearer must NEVER be placed in the mobile app. See [ADR-0004](docs/ADR/0004-secure-android-cloud-sync.md), [evidence](docs/EVIDENCE.md), and [progress](docs/PROGRESS.md). Do not enable a production identity endpoint before real provider verification, secure mobile token lifecycle, JWKS caching/rotation and abuse controls are reviewed.

## P1-C developer-only server-side mobile sync (merged PR #9; not deployed)

Separate OIDC bearer-protected routes (not the old operator token):
- `POST /v1/sync/monitors`: one bounded object `{"clientDraftId":"<UUID>","repository":"python/cpython","intervalMinutes":30}`. On first insert returns 201 with a PAUSED monitor; exact replay returns 200 with the **same** ID; modified replay returns 409. Per-owner limit 3.
- `GET /v1/sync/monitors`: owner-scoped list including cloud server IDs and authoritative status.
- `GET /v1/sync/observations?monitorId=<UUID>`: owner-scoped event read (404 for foreign/nonexistent monitor).
- `GET /v1/me`: historical verified-identity probe currently still reports `monitorSync:false`. **This is a stale legacy capability label, not evidence that P1-E/P1-F sync/control source is absent.** Real device/cloud availability must be verified separately; the Android UI does not rely on this flag.

The server derives authority from a verified `issuer + subject` mapped to an internal UUID in `user_identities`; client-provided owner fields are rejected. Migration `0002` preserves legacy operator records. **All newly synced user monitors initially start PAUSED.** Later P1-D implemented opt-in server scheduling, and P1-E/P1-F implemented Android credential and explicit sync/control source. None is activated in the default APK or remotely deployed. The implementation is synthetic/local-CI-verified only, not a live Cloudflare deployment. Real OIDC selection, anti-abuse controls/JWKS key caching, device secure token handling and remote cost gates remain open.

## P1-D experimental bounded scheduler, OFF by default (merged PR #10)

This branch adds `PATCH /v1/sync/monitors/{id}` with `{"status":"ACTIVE","expectedVersion":1}` (or `PAUSED`) requiring the signed user's OIDC bearer. `ACTIVE` is rejected unless the operator deliberately sets `MOBILE_SCHEDULING_ENABLED='true'`; the flag is **absent from deployed configuration**. A SQL-bound global limit of 9 active mobile monitors, 20 mapped identities, 3 total provider GETs per tick and one due monitor per owner per tick constrain the pilot. D1 migration `0003` records the rotating owner cursor. **Since P1-I, even operator-only Cron work is globally disabled until an operator explicitly sets `SCHEDULER_ENABLED='true'`.**

**Important:** `schedulerEligible:true` means a task can be selected by configured server code, not that remote Cron is deployed or an effect occurred. No real OIDC provider sign-in, Android authenticated sync UI, remotely running Cloudflare Worker, physical-device phone-off acceptance, or billing limits are verified. Default-off is intentional. See [ADR-0005](docs/ADR/0005-bounded-fair-mobile-scheduler.md), [EVIDENCE](docs/EVIDENCE.md) and [PROGRESS](docs/PROGRESS.md).

## API contract (owner pilot only)

| Method | Endpoint | Effect |
| --- | --- | --- |
| `GET` | `/health` | Public service health label, not a deployment verification |
| `POST` | `/v1/monitors` | Create a public GitHub repository monitor |
| `GET` | `/v1/monitors` | List owner-scoped monitors |
| `PATCH` | `/v1/monitors/{id}` | Pause/resume with `expectedVersion` optimistic concurrency |
| `GET` | `/v1/observations?monitorId={id}` | Read up to 50 owner-scoped observations |

**Only the legacy operator endpoints in the table above** require `Authorization: Bearer <OWNER_API_TOKEN>`, a random 32+ character Worker secret. The separate `/v1/sync/*` and `/v1/me` routes instead require a cryptographically validated end-user OIDC bearer. **Never embed this token in the Android app or a browser frontend.** Replace pilot auth with provider-validated identity and server-side user scoping before any Android release.

Create payload: `{"repository":"python/cpython","intervalMinutes":30}`. Pause: `{"status":"PAUSED","expectedVersion":1}`. Next successful checks increment the version, so fetch the latest value before changing status.

## Reproduce the current proof

Requirements: **Node.js 22.16+ (22.x)**. No account, external test dependency, paid service, or `.env` needed to run tests.

```sh
npm ci --ignore-scripts
npm test
npm run typecheck  # requires TypeScript 5.8.3 installed; CI installs this pinned tool
```

`npm test` uses built-in Node TypeScript stripping and Node's experimental SQLite test adapter. The SQLite adapter is a deterministic stand-in for the D1 binding, **not** proof that remote Cloudflare D1 behaves identically. Tests use synthetic SHA values and an injected HTTP client, so they make **no GitHub network calls**.

## Cloudflare setup, not executed by this repository

See [operator runbook](docs/RUNBOOK.md). Wrangler configuration lives at `worker/wrangler.jsonc` with public Worker route disabled by default; production requires an explicit operator deployment, D1 provision/migration, `OWNER_API_TOKEN` secret, and end-to-end validation on actual Cloudflare infrastructure. GitHub Actions never deploys and has no Cloudflare secrets.

## Audit and scope

- [Architecture](docs/ARCHITECTURE.md) · [Threat model](docs/THREAT_MODEL.md) · [Design decision](docs/ADR/0001-cloud-execution.md)
- [Progress and acceptance gates](docs/PROGRESS.md) · [Evidence](docs/EVIDENCE.md) · [Limitations](docs/LIMITATIONS.md) · [Budget and quotas](docs/COST_AND_QUOTA.md)
- [Source of product decisions](docs/PROJECT_BASELINE.md)

**Current open items:** genuine Google account/device acceptance, owner-approved remote Cloudflare Worker/D1/Cron deployment, physical phone-off autonomous observation proof, Free-tier CPU/billing measurements, Android RAM/battery benchmarks, Firebase/FCM, approval-bound external writes, business lead intake and Workers AI. **Source-implemented but NOT live-proven**: Android authenticated manual cloud sync, server status control and observation history. No Android background task execution.

Author: Evan Naraya. Public source with no license grant at this stage; see [LICENSE_POLICY](docs/LICENSE_POLICY.md).

## Stage P0.2-A: local Cloudflare D1 acceptance

CI now runs the actual local Cloudflare D1 binding with Wrangler 4.158.0, independently of the SQLite test double. [Offline 12/12, typecheck](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42655079899) and [local D1 2/2](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42655079982) passed on source SHA `09f8a927830285e0cbf8f83c19193123c7d9fb19`.

Local reproduction (no Cloudflare account or credentials):
```sh
npm ci --ignore-scripts
npm install --no-save --package-lock=false --no-audit --no-fund wrangler@4.158.0
node --experimental-strip-types --test tests/cloudflare-local.test.mjs
```
`worker/wrangler.local.jsonc` has a deliberately **fake D1 ID**, for local tests only. Never deploy this config. **No remote D1 or Cron, no powered-off phone, no real provider verification, no APK, and no claimed free-tier consumption**. See [progress ledger](docs/PROGRESS.md) and [evidence matrix](docs/EVIDENCE.md).

## P0.2-B partial: genuine GitHub read, persisted in workerd/D1

A live integration workflow reads this repository's public GitHub commit head through the shipped scheduler (not a fixture), writes a BASELINE to disposable local workerd/D1, and compares it with the official GitHub branch ref. [Live GitHub read CI SUCCESS](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42661442994) at source `dddbba531304c29efc6495983d1500173999b40a`. No remote Cloudflare provisioning or deployed Worker is implied. [Full evidence boundary](docs/LIVE_PROVIDER_ACCEPTANCE.md).

## P1-A (historical): native Android offline pilot

Actual Kotlin/Compose source exists under [android/](android/). The app creates, persists, lists and removes up to 20 **offline public-repository monitor drafts**; it does not claim cloud tasks are active. That historical build had **no INTERNET permission, server bearer token, model runtime or background service**. The P1-B build adds INTERNET for a single manually triggered public GitHub read while retaining the other restrictions. [Android acceptance](docs/ANDROID_ACCEPTANCE.md) documents the build, security gates and unverified on-device steps. The debug build is for development only and not a published signed release.

The next product-critical step is **user-scoped authenticated synchronization**, not embedding the P0 owner token in a mobile client. A separate Cloudflare-account acceptance gate remains pending.

## P1-B: manual GitHub Live Preview in Android

The Kotlin/Compose app now offers **Check now** on each saved public repo. It uses the fixed `api.github.com` HTTPS endpoint without provider authentication, rejects redirects and malformed GitHub data, bounds body reads to **32 KiB**, runs I/O off the UI thread and saves each successful SHA/timestamp locally. Existing offline drafts remain readable across upgrades. Rate-limit/offline failures preserve the previous good snapshot. No scheduled polling on Android.

Reproduce: `gradle --project-dir android :app:testDebugUnitTest :app:assembleDebug` with JDK17, Android SDK 37.0 and Gradle 9.4.1. [Mobile design ADR](docs/ADR/0003-android-public-github-preview.md) · [Android test protocol](docs/ANDROID_ACCEPTANCE.md) · [Android CI](.github/workflows/android.yml) · [Live mobile network-adapter CI](.github/workflows/android-provider-live.yml).

**Security:** the APK requests `INTERNET` for manual public metadata checks, but has **no backend owner token**, no private-account credentials, no sensitive Android permissions, no AI model, and no autonomous Android background service. GitHub does observe the requester's IP/metadata. This build still does not operate while the phone is switched off.

## P1-B source CI evidence (2026-11-10)

Source commit `d90887a3d407d5178368ce197bb99e6e8c84545a` passed **all 5 workflows**:
- [Backend offline tests + TypeScript](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086317): SUCCESS.
- [Local Cloudflare workerd/D1](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086457): SUCCESS.
- [Worker's official live GitHub GET](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086552): SUCCESS.
- [Native Android debug APK + unit tests + manifest permission gate](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086432): SUCCESS. APK SHA-256 `aefbceab40f1cf17c54a930cf682540d21f5d6766e0ea21a9562cdf6434d48ad`; [ephemeral artifact 13696608733](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086432/artifacts/13696608733), expires 16 November 2026 UTC.
- [Android GitHub adapter real network acceptance](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086200): SUCCESS; JUnit XML asserts **1 test executed, 0 skipped, 0 failed, 0 errors**.

This is CI at source SHA, not yet the merge SHA. **No physical Android, Cloudflare remote, powered-off device, RAM/battery benchmark, OAuth login, or cloud sync verified.**
