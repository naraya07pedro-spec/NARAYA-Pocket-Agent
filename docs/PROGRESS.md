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

## 2026-11-09 | P0.2-B partial, P1-A mobile pilot | public provider and Android source

**Implemented on development branch:** an independently triggered, read-only live GitHub provider acceptance job; official commit-head GET -> shipped scheduler -> local Cloudflare workerd/D1 -> separate official GitHub ref cross-check. A Kotlin/Jetpack Compose Android draft manager allows creation, listing and removal of public GitHub repo monitor drafts saved through local SharedPreferences. It has no INTERNET permission, cloud credentials, agent inference, background service, or user-auth pretence.

**Verified CI before final documentation changes:**
- [Live GitHub network read 42661442994](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42661442994): SUCCESS on SHA `dddbba531304c29efc6495983d1500173999b40a`. Public GitHub source `naraya07pedro-spec/NARAYA-Pocket-Agent`, matching branch HEAD `7dd952b9a1f1a02d1f68f538e11164e542beff4c`. Stored locally via workerd/D1; no deployed Cloudflare.
- [Android native build 42661442547](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42661442547): SUCCESS on same source SHA, Gradle 9.4.1 / AGP 9.2.1, SDK 37.0, JVM unit tests and debug APK artifact. This does not prove a real-device install or resource footprint.
- Existing offline 12-case suite and Cloudflare-local D1 2-case suite were also SUCCESS on the same source SHA.
- Early Android CI failures (runs `42661033339` and `42661215368`) were from SDK setup configuration: an obsolete `tools` package and the wrong `platforms;android-37` identifier. Fixed by installing platform-tools and `platforms;android-37.0`, without skipping source tests.

**Still NOT verified:** remote Cloudflare Worker/D1 or real Cron; end-to-end phone-off autonomy; Android owner-device install and RAM measurements; Google/OIDC user authentication, sync, or approval; business workflows; external write state. No provider writes, no cloud resource provisioning and no paid API use.

**Next evidence gates:** final PR/main SHA CI, APK manifest no-INTERNET proof, and owner-approved remote D1/Cron acceptance. See issue #2 and ADR-0002.
