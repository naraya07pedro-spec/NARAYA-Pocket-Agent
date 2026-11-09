# NARAYA Pocket Agent

**Android-first agent, cloud-resident execution.** Built for lightweight phones, bounded autonomy, and verifiable results even when the phone is switched off.

> **Status: Stage P0.2-A, offline + local Cloudflare D1 CI verified.** No Android APK, Cloudflare deployment, real owner-provider acceptance, paid AI inference, or 24/7 uptime is claimed. This is a single-owner pilot backend, not a public multi-user service.

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

**Planned, not implemented:** Android Kotlin/Compose client, Firebase Auth/FCM, approval-bound external writes, business lead intake, Workers AI, real-provider read-back, device RAM/battery benchmarks. Do not confuse the intended product with the currently tested backend slice.

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
