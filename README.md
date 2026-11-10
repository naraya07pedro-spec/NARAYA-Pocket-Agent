# NARAYA Pocket Agent

**Android-first agent, cloud-resident execution.** Built for lightweight phones, bounded autonomy, and verifiable results even when the phone is switched off.

> **Status: P1-H shared D1 Cron budget added in PR #14 (local CI, no remote deployment), after P1-G public OIDC JWKS Cache API, P1-F Android owner controls and P1-D multi-user scheduling. Both operator and opt-in mobile modes now reserve from the same fixed UTC 15-minute D1 budget before GitHub GET. Default Android APK still has no Google OAuth client ID or Worker origin and mobile scheduling remains OFF; no real cloud agent is deployed.** The Android APK can make a manual, read-only public GitHub HTTPS request and retain its last verified commit SHA offline. Verified with JVM/CI and debug APK builds, not a physical device. **Cloudflare remote D1/Cron, phone-off autonomy, production auth and RAM/battery measurements are NOT verified.**

## What actually works in this milestone

- TypeScript Cloudflare Worker HTTP API with high-entropy owner-token authentication for **developer/owner use only**.
- Cloudflare D1 schema for monitors, observations, execution leases, and redacted audit events.
- Cron-triggered public GitHub default-branch commit-head monitoring using official read-only REST calls.
- Durable baseline/change observations; atomic conditional lease claims, fencing, pausing, stale-version rejection, bounded retries, and auto-pause after 5 consecutive failures.
- Strictly bounded workload: at most **3 monitors per owner**, max 3 checks per Cron invocation AND at most 3 reserved provider attempts per fixed UTC 15-minute window shared across invocations using one D1 database (requires migration 0004), intervals 30–1,440 minutes, fixed GitHub API hostname, no redirects, no outbound writes, no paid model API.
- 12 SQLite/Node regression cases plus 2 separate local Cloudflare `workerd`/D1 integration tests, covering persistence after restart, stale-worker fencing, ownership hardening, and malformed upstream responses.

**Why this matters:** the cloud scheduler does not depend on any Android process. Actual off-device acceptance is pending until an owner-authorized Cloudflare deployment is running.

## P1-H D1-global Cron quota guard (PR #14, local CI only)

Two overlapping Worker Cron invocations can defeat a per-invocation request cap. The scheduler now atomically reserves one of **three provider attempt slots in each fixed UTC quarter-hour** on the shared D1 `scheduler_control` row **before** a GitHub request, and refunds a slot only when a monitor lease is definitely not obtained. Applies to both legacy operator mode and opt-in mobile mode; the latter stays OFF by default. `0004_global_scheduler_budget.sql` is an **additive, mandatory pre-deployment migration**. Missing migration or backward clock replay fails closed.

**Precise limits:** three per *fixed* 15-minute UTC bucket is **not** three in a rolling 15-minute span, and tasks might be delayed by backlog or crashes. Only Workflows sharing the exact same D1 database share the quota; none of this proves Cloudflare remote execution or account expenses. See [ADR-0009](docs/ADR/0009-d1-global-cron-budget.md), [PROGRESS](docs/PROGRESS.md) and [EVIDENCE](docs/EVIDENCE.md).

## P1-G OIDC JWKS reliability and cost guard (PR #13, source-verified)

The server-side RS256 verifier now optionally reuses **public signing-key JWKS** through a dedicated Cloudflare `caches.open('naraya-pocket-agent-public-jwks-v1')` namespace. The provider must explicitly allow public max-age caching; TTL is at most five minutes, data is bounded, tokens and user identity are never cached, and **every** token still receives a separate cryptographic verification. Expired keys + provider outage fail closed, never use stale identity data. Cache unavailable => use a fresh provider read, with no presumption of fewer remote requests. An initial unsafe cross-request Promise design was abandoned during red-team review. See [ADR-0008](docs/ADR/0008-request-safe-oidc-jwks-cache.md), [PROGRESS](docs/PROGRESS.md), [EVIDENCE](docs/EVIDENCE.md). **No Google-issued token or Cloudflare remote hit rate has been tested**.

## P1-F Android monitor controls (merged PR #12, source CI only)

With a real configured, trusted OAuth/Worker environment, a signed-in user can explicitly request server-side `ACTIVE` or `PAUSED` for their own monitor using optimistic `expectedVersion`, and read server-recorded `BASELINE`/`CHANGE` observations. Android never fabricates cloud success; it validates exact status/version and observation provenance, and refuses arbitrary host/route extensions. HTTP 409 is safely classified into scheduler-disabled, stale-version, or active-limit without revealing error bodies. **The default mobile scheduler is OFF**, so requesting activation from an unconfigured deployment is rejected. None of this proves actual Cloudflare D1/Cron, a real signed-in device or phone-off autonomy. See [ADR-0007](docs/ADR/0007-android-cloud-control-observation-evidence.md), [PROGRESS](docs/PROGRESS.md), and [EVIDENCE](docs/EVIDENCE.md).

## P1-E Android signed-in cloud bridge, disabled by default

Merged PR #11 adds Google Credential Manager explicit sign-in, in-memory only Google ID token, owner-scoped backend monitor reconciliation, one-draft idempotent cloud POST, and typed offline/401/409/429 failure handling. Public `narayaGoogleWebClientId` and `narayaApiOrigin` Gradle properties must be explicitly configured by the operator; both are **empty by default**. The Android app never contains the legacy `OWNER_API_TOKEN` and never stores the user ID token in SharedPreferences.

**CI-only status**: Android APK and JVM test build succeeded after pinning an SDK compatible with the existing Kotlin toolchain. Real Google OAuth registration, Android login with a genuine token, remotely deployed Cloudflare Worker/D1/Cron, and powered-off phone execution are all **not verified**. Sync creates a **PAUSED** cloud monitor; this version does not provide an activation UI or automatic phone-side polling. See [ADR-0006](docs/ADR/0006-android-google-identity-manual-sync.md), [Android README](android/README.md), [Evidence](docs/EVIDENCE.md), and [Android acceptance](docs/ANDROID_ACCEPTANCE.md).

## Experimental P1-C backend identity boundary (merged PR #7; not deployed)

The separate read-only `GET /v1/me` endpoint requires an RS256-signed identity JWT, validated server-side against **operator-configured** `OIDC_ISSUER`, `OIDC_AUDIENCE`, and `OIDC_JWKS_URL` (HTTPS). Without these settings it fails closed. The issuer must exactly match the token; the JWKS URL is never taken from token headers. Response on verified identity: `{"authenticated":true,"capabilities":{"monitorSync":false}}`.

**This is not a completed Android login.** CI verifies generated test RSA signatures and synthetic JWKS only. No live OIDC provider login, Android OAuth flow, secure mobile token storage, authenticated Android-to-backend sync, remote Cloudflare or actual phone-off autonomy is claimed. Server-side per-user SQL authorization and draft-sync API are separately implemented below. Legacy owner bearer must NEVER be placed in the mobile app. See [ADR-0004](docs/ADR/0004-secure-android-cloud-sync.md), [evidence](docs/EVIDENCE.md), and [progress](docs/PROGRESS.md). Do not enable a production identity endpoint before real provider verification, secure mobile token lifecycle, JWKS caching/rotation and abuse controls are reviewed.

## P1-C developer-only server-side mobile sync (merged PR #9; not deployed)

Separate OIDC bearer-protected routes (not the old operator token):
- `POST /v1/sync/monitors`: one bounded object `{"clientDraftId":"<UUID>","repository":"python/cpython","intervalMinutes":30}`. On first insert returns 201 with a PAUSED monitor; exact replay returns 200 with the **same** ID; modified replay returns 409. Per-owner limit 3.
- `GET /v1/sync/monitors`: owner-scoped list including cloud server IDs and authoritative status.
- `GET /v1/sync/observations?monitorId=<UUID>`: owner-scoped event read (404 for foreign/nonexistent monitor).
- `GET /v1/me`: earlier read-only verified-identity probe; still reports `monitorSync:false` because the Android app has not been integrated.

The server derives authority from a verified `issuer + subject` mapped to an internal UUID in `user_identities`; client-provided owner fields are rejected. Migration `0002` preserves legacy operator records. **All new user monitors are PAUSED**: user-owned Cron scheduling has not yet been implemented safely. The Android APK has no mobile OIDC flow, token or sync controls. The implementation is synthetic/local-CI-verified only, not a live Cloudflare deployment. Real OIDC selection, anti-abuse controls/JWKS key caching, device secure token handling and remote cost gates remain open.

## P1-D experimental bounded scheduler, OFF by default (merged PR #10)

This branch adds `PATCH /v1/sync/monitors/{id}` with `{"status":"ACTIVE","expectedVersion":1}` (or `PAUSED`) requiring the signed user's OIDC bearer. `ACTIVE` is rejected unless the operator deliberately sets `MOBILE_SCHEDULING_ENABLED='true'`; the flag is **absent from deployed configuration**. A SQL-bound global limit of 9 active mobile monitors, 20 mapped identities, 3 total provider GETs per tick and one due monitor per owner per tick constrain the pilot. D1 migration `0003` records the rotating owner cursor; old operator-only behavior remains the default.

**Important:** `schedulerEligible:true` means a task can be selected by configured server code, not that remote Cron is deployed or an effect occurred. No real OIDC provider sign-in, Android authenticated sync UI, remotely running Cloudflare Worker, physical-device phone-off acceptance, or billing limits are verified. Default-off is intentional. See [ADR-0005](docs/ADR/0005-bounded-fair-mobile-scheduler.md), [EVIDENCE](docs/EVIDENCE.md) and [PROGRESS](docs/PROGRESS.md).

## API contract (owner pilot only)

| Method | Endpoint | Effect |
| --- | --- | --- |
| `GET` | `/health` | Public service health label, not a deployment verification |
| `POST` | `/v1/monitors` | Create a public GitHub repository monitor |
| `GET` | `/v1/monitors` | List owner-scoped monitors |
| `PATCH` | `/v1/monitors/{id}` | Pause/resume with `expectedVersion` optimistic concurrency |
| `GET` | `/v1/observations?monitorId={id}` | Read up to 50 owner-scoped observations |

All `/v1` routes require `Authorization: Bearer <OWNER_API_TOKEN>` where the token is a random 32+ character secret stored only in the Worker secret binding. **Never embed this token in the Android app or a browser frontend.** Replace pilot auth with provider-validated identity and server-side user scoping before any Android release.

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

**Planned, not implemented:** authenticated Android-cloud sync, Firebase Auth/FCM, approval-bound external writes, business lead intake, Workers AI, live Cloudflare deployment and device RAM/battery benchmarks. The current Kotlin/Compose app adds **manual read-only GitHub previews over HTTPS**, but no cloud task activation or autonomous background execution.

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
