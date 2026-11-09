# NARAYA Pocket Agent

**Android-first agent, cloud-resident execution.** Built for lightweight phones, bounded autonomy, and verifiable results even when the phone is switched off.

> **Status: P1-B experimental Android GitHub Live Preview + P0.2-B partial cloud backend.** The Android APK can make a manual, read-only public GitHub HTTPS request and retain its last verified commit SHA offline. Verified with JVM/CI and debug APK builds, not a physical device. **Cloudflare remote D1/Cron, phone-off autonomy, production auth and RAM/battery measurements are NOT verified.**

## What actually works in this milestone

- TypeScript Cloudflare Worker HTTP API with high-entropy owner-token authentication for **developer/owner use only**.
- Cloudflare D1 schema for monitors, observations, execution leases, and redacted audit events.
- Cron-triggered public GitHub default-branch commit-head monitoring using official read-only REST calls.
- Durable baseline/change observations; atomic conditional lease claims, fencing, pausing, stale-version rejection, bounded retries, and auto-pause after 5 consecutive failures.
- Strictly bounded workload: at most **3 monitors per owner**, 3 checks per cron tick, intervals 30–1,440 minutes, fixed GitHub API hostname, no redirects, no outbound writes, no paid model API.
- 12 SQLite/Node regression cases plus 2 separate local Cloudflare `workerd`/D1 integration tests, covering persistence after restart, stale-worker fencing, ownership hardening, and malformed upstream responses.

**Why this matters:** the cloud scheduler does not depend on any Android process. Actual off-device acceptance is pending until an owner-authorized Cloudflare deployment is running.

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
