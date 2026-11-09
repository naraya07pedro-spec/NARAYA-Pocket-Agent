# Progress ledger | NARAYA Pocket Agent

## 2026-11-10 | P1-B: Android manual live-provider preview and durable local snapshots

**Implementation committed to feature branch:** Kotlin `GithubHeadClient` with fixed official GitHub HTTPS GET and redirects disabled; bounded 32 KiB response, UTF-8/SHA validation, error classification; background-thread execution via coroutines; Compose UI manual Check now action; locally saved successful commit SHA/timestamp; backwards-compatible `DraftCodec` retaining P1-A drafts and ignoring individual corrupt records. Android version 0.2.0-alpha adds only INTERNET permission, no backend operator token.

**Testing introduced:** deterministic JVM tests for parser, statuses, oversized responses, invalid slug, I/O failures and schema migration; independent live network JVM integration test with GitHub branch-ref SHA cross-check and explicit no-skip CI gate; clean Android CI that inspects actual APK permissions and generates a debug APK.

**Source CI result:** 5/5 workflows SUCCESS on source SHA `d90887a3d407d5178368ce197bb99e6e8c84545a`. Exact links and APK SHA-256 in the evidence section below. Verify PR HEAD and final merged `main` separately before calling stage complete. No physical device, RAM, cloud sync or phone-off autonomy claim.

**Unverified:** mobile physical hardware, WiFi/mobile data behavior, RAM/PSS and battery, Google/OIDC identity, cloud monitoring and remote Cloudflare deployment. Free-spend guardrail and issue #2 remain unchanged.

## P1-B source CI evidence (2026-11-10)

Source commit `d90887a3d407d5178368ce197bb99e6e8c84545a` passed **all 5 workflows**:
- [Backend offline tests + TypeScript](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086317): SUCCESS.
- [Local Cloudflare workerd/D1](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086457): SUCCESS.
- [Worker's official live GitHub GET](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086552): SUCCESS.
- [Native Android debug APK + unit tests + manifest permission gate](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086432): SUCCESS. APK SHA-256 `aefbceab40f1cf17c54a930cf682540d21f5d6766e0ea21a9562cdf6434d48ad`; [ephemeral artifact 13696608733](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086432/artifacts/13696608733), expires 16 November 2026 UTC.
- [Android GitHub adapter real network acceptance](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086200): SUCCESS; JUnit XML asserts **1 test executed, 0 skipped, 0 failed, 0 errors**.

This is CI at source SHA, not yet the merge SHA. **No physical Android, Cloudflare remote, powered-off device, RAM/battery benchmark, OAuth login, or cloud sync verified.**

---

## Earlier milestones (historical)

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
