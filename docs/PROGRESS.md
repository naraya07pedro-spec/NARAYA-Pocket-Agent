# Progress ledger | NARAYA Pocket Agent

Rules: **Implemented** = source exists. **Tested** = observed in named environment. **CI verified** = public run and exact commit SHA. **Live verified** = real Cloudflare/owner device/provider. None imply a later level automatically.

## 2026-11-09 | Stage P0.1 | Safe cloud-monitor backend

**Implemented and merged into `main`:** TypeScript Worker API, D1 migration, conditional scheduler lease/state machine, GitHub public default-branch reader, owner token gate, pause/resume with optimistic version, observation log, GitHub Actions offline test configuration, threat model and operator runbook.

**Local tested:** Node.js 22.16, Node built-in SQLite test double, 10 deterministic tests across authentication/input validation/deduplication/real SQL queries/provider errors/lease fencing/status changes. Source TypeScript typecheck run with `tsc` 5.8.3.

**GitHub Actions verified:** PR head `982f6ad8d331035a73ff5e97c88f9cada697e73a` and merged source `main` commit `d8298143a942d75ad6846fcd1510ea4ea2cde704` both passed offline tests and TypeScript checks. [Main CI run](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42651566624).

**Unverified:** actual Cloudflare D1/Cron behavior, live GitHub provider read, Android hardware, off-device acceptance, uptime, user adoption, billing impact. Read `docs/EVIDENCE.md` for current class.

**Next evidence gate:** owner-approved real Cloudflare D1 test, then powered-off-phone test. See [issue #2](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/2). No production deploy until explicit authorization.

**Owner choices retained:** Android first; personal + business incrementally; safe actions automatic, sensitive actions approval-gated; zero additional spending.


## 2026-11-09 | P0.2-A | Local Cloudflare D1 and security hardening

**Implemented:** Separate Wrangler 4.158.0 workerd/D1 local-acceptance suite with isolated temporary persistence, schema application via D1 prepared statements, API create/list, scheduled-state evaluation, baseline/change, runtime restart and stale lease fencing. Owner configuration now fails closed; streamed GitHub response is byte-limited to 32 KiB and validated with strict UTF-8.

**Evidence at source SHA `09f8a927830285e0cbf8f83c19193123c7d9fb19`:**
- [Offline CI 42655079899](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42655079899): **SUCCESS**, 12/12 Node+SQLite behavioral tests, TypeScript check and secret-file gate.
- [Cloudflare-local D1 CI 42655079982](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42655079982): **SUCCESS**, 2/2 `workerd` D1 integration tests including restart persistence and stale-worker rejection.
- Initial CI on `f1b838e62c` failed: offline suite unintentionally included Wrangler-dependent test, and `D1.exec` rejected multiline SQL input. Corrected by separating test suites and applying complete SQL statements through D1.prepare; failed runs remain visible, no skip introduced.

**Evidence class:** CI_VERIFIED on *local Cloudflare runtime*, NOT LIVE_VERIFIED on Cloudflare's remote platform. No remote D1, Cron delivery, powered-off Android, external provider GET, account billing or uptime proof. No Cloudflare resource created or deployed.

**Next:** P0.2-B owner-approved disposable remote D1/Worker, exact remote migration, genuine GitHub GET, powered-off-phone demonstration and verified quota accounting. Issue #2 remains open. Android P1 later requires proper end-user identity; owner bearer token never enters APK.
