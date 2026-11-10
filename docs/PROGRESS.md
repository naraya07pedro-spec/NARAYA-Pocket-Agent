# Progress ledger | NARAYA Pocket Agent

## 2026-11-10 | P1-D server-side bounded multi-user scheduler (PR #10, not deployed)

**Implemented:** feature-gated (`MOBILE_SCHEDULING_ENABLED==='true'`) multi-user GitHub read-only scheduled execution, verified-owner status PATCH with optimistic `expectedVersion`, max 20 identities in pilot, max 9 ACTIVE mobile monitors, global 3 GitHub requests/tick and 1 due monitor/owner/tick. D1 migration `0003_scheduler_control.sql` persists a rotating owner cursor. Feature flag absent => legacy operator-only scheduler; no Android credentials, cloud provisioning, paid API, or external write.

**Tested at source SHA `1d7640417a7bbae9435098cd71fcc45c5418957a`:**
- [Backend CI 42755265080](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265080): **33/33 tests passing**, pinned TypeScript typecheck SUCCESS. Includes disabled-by-default, versioned PAUSE/ACTIVE, A/B IDOR, fairness across four owners, max-active enrollment, identity limit, stale-worker after pause, regression.
- [workerd/D1 local CI 42755265299](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265299): **5/5 tests passing**, includes true local D1 persisted round-robin cursor after Worker restart and owner fairness under global cap.
- [Live read-only GitHub GET CI 42755265084](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265084), [Android adapter CI 42755265417](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265417), [Android debug APK CI 42755265184](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265184): **SUCCESS** (Android runtime tests are JVM/CI; no physical device).
- Early HEAD `c7312e712f695283a1108f1ac73e7c5965690765` failed due to malformed mobile route parser syntax and did not exercise scheduler behavior; fixed on `1d7640417a7bbae9435098cd71fcc45c5418957a`. Failed runs remain inspectable.

**Evidence boundary:** server-side implementation + simulated provider identities + local Cloudflare D1/workerd; **NOT** verified Google/Firebase login, Android UI sync, remote Cloudflare Cron, powered-off phone, physical RAM/battery, actual account pricing, concurrent remote Cron invocations, or fairness SLA. `MOBILE_SCHEDULING_ENABLED` has not been configured in any deployed environment. The response `schedulerEligible` is a local authority/scheduling gate, not provider execution confirmation; success remains tied to observations. A separate exact-SHA PR-head run and merge/main run are required before claiming verification of those commits.

**Blocked / next evidence gate:** real OIDC provider configuration, secure Android token/opt-in sync, separate owner-approved real Cloudflare free-tier D1/Cron experiment, device-off acceptance. Review [ADR-0005](ADR/0005-bounded-fair-mobile-scheduler.md) and [issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8). No production deployment or cost-bearing side effects occurred.

---

## 2026-11-10 | P1-C owner isolation and idempotent mobile-sync API (PR #9 merged; not deployed)

**Implemented and merged on PR #9, merge SHA `778a8cbb42fca71074d9800607c7f5b358e51242`:
- `0002_mobile_identity_sync.sql`: additive `user_identities` table and nullable client draft/digest columns plus unique index on `(owner_id,client_draft_id)`. Legacy operator rows are not auto-adopted.
- Verified `issuer+subject` mapped to server-generated opaque UUID. Client-supplied owner IDs have no authority.
- `GET/POST /v1/sync/monitors` use OIDC bearer only, strict schema, bounded single-item body, normalized repository, atomically checked 3-monitor owner quota, replay-safe draft IDs, changed-payload conflict. Lists are SQL owner-scoped.
- `GET /v1/sync/observations?monitorId=...` requires ownership or returns 404. Operator bearer token still exclusively gates legacy endpoints.
- New mobile monitors are **PAUSED**; scheduling is explicitly NOT enabled for mobile users until the scheduler's single-owner design is safely replaced.

**Test evidence at source SHA `633ccda10beda76d864a1ee9cd1303e284bf8268`:**
- [Offline source CI 42750701827](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750701827): SUCCESS; **28/28** backend tests and TypeScript typecheck. New tests cover two accounts, IDOR, owner keys, duplicate replay, changed payload, quota, malicious fields, invalid/forged tokens, legacy separation and concurrent calls.
- [Local workerd/D1 CI 42750701808](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750701808): SUCCESS; **4/4** D1 tests including cross-owner isolation, replay after persisted runtime restart, and applying migration `0002` to a database with a prior operator row.
- [Official GitHub read CI 42750701796](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750701796), [Android live adapter CI 42750702269](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750702269), [Android build CI 42750701661](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750701661): SUCCESS, preserving prior read-only behavior.

**Evidence class**: CI_VERIFIED_SYNTHETIC for signed identity + mobile sync backed by local SQLite/workerd-D1, not a real OIDC provider or deployed Cloudflare. Android app still uses manual public GitHub preview; it has **no token acquisition or sync UI**. Remote Cloudflare Cron, user tasks executing while phone is off, RAM/battery, billing and production access remain NOT_VERIFIED. This branch's final docs commit and merge SHA must be separately checked; links above refer to precise earlier source SHA.

**PR-head gate:** all **5/5** workflows SUCCESS on final PR HEAD `fc39f66343048a8dfdbae887035bef25d9ddca63`: [source](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750920672), [D1](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750920480), [live GitHub](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750920518), [Android adapter](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750920679), [Android APK](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750920423). Merge commit confirmed via GitHub, but separate CI evidence for merged/main and this documentation-only commit is not claimed.

**Next**: choose and verify actual free-tier OIDC provider, implement secure Android login/token lifecycle and opt-in sync; implement fair bounded multi-user scheduler before permitting ACTIVE; execute real cloud and phone-off verification only after explicit owner authorization. See [issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8).

---

## 2026-11-10 | P1-C first implementation slice: server-side cryptographic identity verification

**Implemented and merged to main by PR #7, merge SHA `cd2298a6b91392af9024afa4bd7ba42d8bdc6be3`:**
- `worker/src/oidc.ts`: fail-closed, bounded RS256 JWT verification against operator-configured HTTPS JWKS. Exact issuer, audience, subject, iat, exp, optional nbf/azp, kid, key selection and WebCrypto signature verification; 3-second bounded JWKS fetch, no redirects, 64 KiB body limit. The token never selects the JWKS host.
- `GET /v1/me`: distinct read-only identity probe; returns `authenticated: true` and `monitorSync: false` only after verification. No operator bearer accepted as mobile identity. No new D1 writes, third-party sends or app token storage.
- 7 adversarial OIDC test cases with generated RSA keys and synthetic token/JWKS fixtures, plus existing 12 backend tests, included in `npm test`.
- Existing pilot owner-token endpoints and scheduler remain unchanged. User-scoped SQL, Android authenticated sync and remote Cloudflare are NOT implemented.

**Source proof:** [source CI run 42747877456](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42747877456) at source SHA `af55967f6d6370861dc1b02367a7c53883f08219`: **19/19 passing tests, TypeScript typecheck SUCCESS, no credential-file gate SUCCESS**. The test harness initially failed 1 test on prior SHA `24c83e393424f6582daa16dae1ea545929432272` because the synthetic JWKS hostname was not stubbed in the Worker endpoint test (returned expected 503 for unreachable provider); corrected by mocking global fetch in the test only, not by weakening verification. Subsequent source CI passed.

**Final PR-head proof:** all **5/5 GitHub Actions workflows SUCCESS** at PR HEAD SHA `cc42f084ed61ccb7f7cffd5cf9f2b69f8508307b` (runs: [source](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42748123959), [local D1](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42748123925), [live GitHub Worker GET](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42748123934), [Android build](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42748123872), [Android network adapter](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42748123994)). The merge SHA was confirmed by GitHub, but **separate main-run workflow evidence is not yet claimed**.

**Status separation:** IMPLEMENTED = backend verifier and probe. TESTED = deterministic synthetic crypto and CI. LIVE_VERIFIED = none for real OIDC/mobile sign-in, cloud sync, remote D1/Cron or physical Android. **Next gate:** owner-scoped authorization and D1 isolation tests, followed by idempotent sync. Provider selection, real Android OIDC integration, and deployment need separate evidence and approval. JWKS caching, provider rotation strategy and identity subject-to-user mapping need design/verification before release. Final PR HEAD CI complete on exact SHA as linked; the subsequent merged main and this ledger-only commit require separate checks if claiming main CI.

---

## 2026-11-10 | Continuation checkpoint | P1-B verified, P1-C contract prepared

**Read-only verification performed:** default-branch latest merged commit is `e1e0dd7034d85500d3e7ab4474b7bc853a8ef7d1` (PR #6). Existing issue #5 records five successful CI workflows on exact merged SHA, and Android APK SHA-256 `2f7ba572db031705cf9cca4373fa6d66a6f365283487a2a9a1a960cda83aa137` ([Android run 42669136705](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42669136705)). The earlier source SHA `d90887a3...` is not the final merge SHA.

**This continuation's deliverable:** [ADR-0004](ADR/0004-secure-android-cloud-sync.md), a proposed implementation contract for OIDC verification, SQL-level user isolation, idempotent draft sync, fail-closed authentication and replay/IDOR test gates. **Documentation/design only, not code implementation or cloud authorization.**

**Implemented:** existing P1-B backend and Android source on main. **Tested:** prior CI per issue #5. **Live-verified:** official public GitHub GET in CI, not remote Cloudflare and not physical device. **Blocked:** deployed remote D1/Cron and powered-off-device proof pending explicit owner authorization; physical Android benchmark unavailable. **Next evidence gate:** code and automated tests for verified-user identity plus cross-user isolation, then idempotent sync; independent issue #2 for real Cloudflare/phone-off acceptance.

**Decisions preserved:** Android-first; personal then business; no embedded operator token; no unapproved external writes or deployment; zero additional spend target. No claims of actual OAuth integration, synchronized monitor, device runtime, remote task completion, or user validation.

---

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
