# Evidence register | NARAYA Pocket Agent

## P1-I: Cron global OFF and no-network release preflight (10 November 2026; PR #15 merged, not deployed)

| Gate / claim | Evidence class | Exact source, result and limitations |
| --- | --- | --- |
| Default-OFF global `SCHEDULER_ENABLED`; mobile scheduler independently OFF; disabled Cron does not touch D1/provider | CI_VERIFIED_OFFLINE_AND_LOCAL_WORKERD | Source `63a625128a9729aa4dbec85344af92a22935b1b5`; [Node/SQLite source CI 42780576969](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42780576969) **53/53 PASS**; [Cloudflare local workerd/D1 42780576610](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42780576610) **10/10 PASS**, including an ACTIVE operator monitor and disabled Cron with zero D1 reservation, provider GET and observations |
| Offline static config gate: no auto deploy/secret injection, migration 0001–0004, blank Android OAuth/origin, fake local D1, inert pilot template | CI_VERIFIED_SOURCE_STATIC_ONLY | [Source CI 42780576969](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42780576969) printed `P1-I offline source checks: PASS` and `Remote deployment status: BLOCKED`. Eight new preflight tests (including the inert pilot template) plus two new Node Cron handler tests, all 53 total |
| Real public GitHub read with shipped Worker, isolated local D1 | CI_VERIFIED_PROVIDER_READ_LOCAL_D1 | [Live GitHub read 42780576662](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42780576662), SUCCESS; **not a remote Cloudflare deployment** |
| Android API adapter regression, APK build and JVM security | CI_VERIFIED_JVM_BUILD_ONLY | [Android adapter 42780576882](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42780576882), [Android debug APK 42780576952](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42780576952) SUCCESS; **13 executed/0 failed/errors/skipped**, APK SHA256 `1c4124226f23b1d6a770336fa6bcbfbfee8cd083db3fccc9f622d03704c465f8` |
| Real Cloudflare CPU 10ms Cron, quota/billing, remote D1, real Google OAuth, physical Android phone-off proof | NOT_VERIFIED | Source audit intentionally emits `remote_readiness: BLOCKED`; no provider/account tool authentication, Cloudflare deployment, remote D1 migration, registered Google app, hardware benchmark or phone-off test |

**Final gate:** exact PR-head SHA `1f1ff9006853a535ee6e4a312afd2abc9d906e07`, **5/5 workflows SUCCESS**. [Node/source 42781427926](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42781427926) **53/53, preflight PASS/remote BLOCKED**; [Cloudflare local D1 42781427816](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42781427816) **10/10**; [real public GitHub local D1 42781428111](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42781428111) SUCCESS; [Android public GitHub adapter 42781427857](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42781427857) SUCCESS; [Android debug APK 42781427789](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42781427789) SUCCESS, **13/13 CloudSyncClientTest executed**, 0 skips/errors/failures; APK SHA256 `3ca70f474e6c1ab6ebce083444c9c7fd8b79dc98ee874e801ed3ac059ff6dc26`. [PR #15](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/pull/15) merged as `0a344f334ccbc4ca6881b2d2cf7d91aef134c990`. **No independent merged-main/ledger-only CI claim.** No remote Cloudflare/Google account or actual phone-off proof.

**Current source evidence:** 5/5 workflow SUCCESS at source `63a625128a9729aa4dbec85344af92a22935b1b5`. Later documentation SHA `aa940280557d6c8ab270d9b26d657dc0204608b3` independently showed 5/5 SUCCESS; the **final PR HEAD** still requires its own 5/5 verification after these ledgers. No work was performed asynchronously or without direct GitHub connector calls. No Cloudflare real resource was created/modified.

**Static checker limitation:** It reads JSON-compatible `.jsonc` configs and tests known fields/code patterns, so it is an engineering guardrail, not cryptographic proof that the implementation is harmless or a substitute for Cloudflare's actual account/API/billing/CPU readings. In particular, `workers_dev:false` and absent route mean the checked-in Worker **is not reachable by Android**, and the pilot template's invalid placeholder ID means **it cannot be deployed as-is**. This is intentional until explicit owner permission. A deployed Cron trigger itself can consume platform allowance even when the entrypoint does no D1 work.

Sources: Cloudflare [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 Free limit enforcement 2026-09-01](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/). Design: [ADR-0010](ADR/0010-default-off-cron-release-gate.md), [REMOTE_PILOT_READINESS](REMOTE_PILOT_READINESS.md), [PROGRESS](PROGRESS.md).

---

## P1-H | Cross-invocation D1 global Cron dispatch budget (10 November 2026; merged PR #14; not deployed)

| Verification | Evidence class | Exact proof |
| --- | --- | --- |
| At most three provider reservations **per fixed UTC quarter-hour per D1 database**, even with interleaved scheduler invocations; safe refund on failed lease and reject clock rewind/missing migration | CI_VERIFIED_SQLITE_SYNTHETIC | [Backend CI 42777373598](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777373598): **43/43 PASS + TypeScript typecheck**, corrected source `067b7905f9781193cba11beb3eaf650c6ecec5c4`, three added backend adversarial tests |
| Shared quota, restart persistence, additive 0004 migration preserves existing cursor/operator monitor | CI_VERIFIED_LOCAL_WORKERD_D1 | [workerd/D1 CI 42777373148](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777373148): **9/9 PASS**, two added real **local** D1 binding tests on same corrected source SHA |
| Shipped scheduler against real public GitHub REST read in local Cloudflare D1 | CI_VERIFIED_PUBLIC_PROVIDER_LOCAL_DB | [GitHub live-read 42777373157](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777373157): SUCCESS after applying migrations 0001–0004 to isolated local D1; **not a deployed Cron** |
| Android JVM/provider adapter and APK regression | CI_VERIFIED_JVM_BUILD | [Android adapter 42777373129](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777373129), [Android debug APK 42777373585](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777373585): SUCCESS, no on-device run, app source unchanged |
| First live-read test run with **outdated local migration fixture** | FAILED_TEST_SETUP_FIXED | [Failed workflow 42777198245](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777198245), old head `7f66a2197eb16f2edadd2acafc4161bbdfdbc7be`; error `D1_ERROR: no such table: scheduler_control`. Test fixture incorrectly applied **only 0001**. Fixed to apply 0001–0004 in `tests/github-live.test.mjs`; rerun 42777373157 SUCCESS |
| Real remote Cloudflare Cron concurrency, account quota/charge, phone-off Android acceptance, live Google OAuth | NOT_VERIFIED | No deployment, provisioned D1, billable service, real Google signed-in device, actual cloud usage counters or physical device metrics |

**Final 5/5 PR-head gate:** source SHA `352a99ab4860e0ac31ee50312ee01ac142c8a251`; [backend 42777929307](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777929307) **43/43 PASS**, [D1 workerd 42777929046](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777929046) **9/9 PASS**, [real public GitHub local D1 42777929294](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777929294) SUCCESS, [Android adapter 42777929001](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777929001) SUCCESS, [Android debug build 42777929189](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777929189) SUCCESS, **13/13 Android sync security tests executed, 0 skips/failures/errors**, APK SHA256 `01c0ecb948924082c089ac5e7598e9d8a8c1984647ef77b307a602cc6be37ab9`. [PR #14](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/pull/14) merged as `b7cdca9ddd03b1f6e5f1f6f2ad3a7ab6b6946640`. No independent CI assertion is made on this merge SHA or subsequent docs-only commits. **No real Cloudflare remote operation was tested.**

**Claim precision:** source/runtime local CI at `067b7905f9781193cba11beb3eaf650c6ecec5c4` **5/5 SUCCESS**, not yet the final docs-head/merge SHA. "Global" applies **only to invocations sharing the same D1 database**, not other Worker projects or database bindings. A fixed 15-minute UTC bucket is not a rolling 15-minute cap; six attempts can straddle the boundary. A granted reservation may be forfeited on a crash and tasks can be delayed. Neither exact owner fairness under remote contention nor Cloudflare Workers Free CPU viability has been tested.

**References:** [ADR-0009](ADR/0009-d1-global-cron-budget.md), [PROGRESS](PROGRESS.md), Cloudflare <https://developers.cloudflare.com/workers/configuration/cron-triggers/> and D1 single-database query processing <https://developers.cloudflare.com/d1/reference/faq/>.

---

## P1-G: request-safe public JWKS Cache API (10 November 2026, merged PR #13; no remote deployment)

| Claim | Evidence classification | Exact SHA and proof |
| --- | --- | --- |
| Public JWKS Cache API named namespace, bounded TTL ≤300sec, no user data / auth outcomes cached, RSA signature checked for each token, fail-closed expired keys | CI_VERIFIED_SYNTHETIC | [Backend source CI 42770060702](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770060702), SHA `5bdad79e2821f0cb7418e0d1e2b09e542a26e4e0`, **40/40 tests PASS**, TypeScript typecheck. Seven added adversarial verifier cases use mock cache and signed test JWTs |
| Cloudflare local D1 + two subject isolation with key reuse | CI_VERIFIED_LOCAL_WORKERD | [Cloudflare workerd/D1 CI 42770060770](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770060770), same SHA, **7/7 PASS**. Cache API namespace injected locally, real D1 binding, test RSA keys; NOT Google production keys or Cloudflare remote caching |
| Read-only GitHub provider / Android regressions | CI_VERIFIED | [Worker provider read 42770060997](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770060997), [Android adapter 42770061012](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770061012), [Android APK 42770060723](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770060723), SUCCESS on same SHA |
| Real Google OIDC production issuer/audience/cache headers, Cloudflare remote Cache API efficiency, phone-off Cron, account quotas and actual spend | NOT_VERIFIED | No live OAuth account or token, deployed Cloudflare Worker/cache/cron/D1, physical device, account billing data or latency measurements used |

**Final merge gate:** all **5/5** workflow checks SUCCESS on PR HEAD `21bcd3625072f6a57ef4420ff80d73b188d03361`: [backend 42770459491](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770459491) **40/40 tests**, [local D1 42770459535](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770459535) **7/7 tests**, [GitHub Worker live-read 42770459875](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770459875), [Android provider adapter 42770459458](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770459458), [Android APK 42770459499](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770459499) with **13/13 CloudSyncClientTest executed, zero skipped/failures/errors**, APK SHA256 `22d7f1a66c56e825f38dcbe041e673e9f6ea83048a3883a9b0749b690523cf5f`. [PR #13](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/pull/13) merged as `f9f551940f8cc9e83b3d14783dbc41ff63aeefe0`. No exact merged-main SHA CI result is inferred from these PR checks, and no remote cache/provider access was performed.

**Red-team design history:** first candidate `ea5af66ff404c038f72899c3d8d88f8b676c439e` used a module-global WeakMap/in-flight JWKS fetch Promise. After checking Cloudflare current best practices for reused isolates, it was **abandoned and replaced** with a per-request discovery of a dedicated Cache API namespace. No cross-request single-flight guarantee remains. Do not claim the first candidate is running.

**Source references:** Google OIDC documentation https://developers.google.com/identity/openid-connect/openid-connect, Cloudflare request-scoped state https://developers.cloudflare.com/workers/best-practices/workers-best-practices/, Cloudflare Cache API https://developers.cloudflare.com/workers/runtime-apis/cache/. See [ADR-0008](ADR/0008-request-safe-oidc-jwks-cache.md).

**Important:** the above workflows are tied to **source SHA `5bdad79e2821f0cb7418e0d1e2b09e542a26e4e0`**. Documentation follow-up commits and merged `main` have separate SHAs and must not inherit a fabricated claim of independent CI. JWKS cache is opportunistic; the code does not promise production hit rates or free-tier account costs. `MOBILE_SCHEDULING_ENABLED` remains OFF by default.

---

## P1-F: Android monitor-control and owner-observation evidence (10 November 2026, PR #12 merged)

| Gate | Evidence class | Exact evidence / limitation |
| --- | --- | --- |
| Explicit version-ACK Android ACTIVE/PAUSED and bounded owner observation reads | CI_VERIFIED_ANDROID_JVM_SYNTHETIC | [Android APK/JVM run 42765189002](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42765189002), source `9bfb371520592ee5afa3297873a9a4b08a8d4c52`; **13 executed, 0 skipped/failures/errors** `CloudSyncClientTest`; debug APK SHA256 `095d69e1f8edd11fe3e56cec33730c9871980ab8ddecb5705c52b46e0729ab8a` |
| Signed owner vs foreign owner, OFF→ON server gate, valid ACK, baseline read and PAUSED fence | CI_VERIFIED_LOCAL_WORKERD | [D1 workerd run 42765188864](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42765188864); **6/6 PASS**, synthetic real RSA-signed JWT fixtures, local DB. It does not prove actual Google login, remote D1, or real Cloudflare Cron |
| Backend regression, validation, TypeScript | CI_VERIFIED_OFFLINE | [Source run 42765189297](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42765189297): **33/33 PASS**, typecheck at same PR HEAD |
| Existing real public GitHub provider tests | CI_VERIFIED_READ_ONLY_PROVIDER | [Worker GET 42765188869](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42765188869), [Android JVM adapter 42765188843](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42765188843): SUCCESS; not a remotely scheduled task |
| Mobile OAuth sign-in, deployed remote Worker, D1/Cron, provider quotas, actual phone-off task, RAM/battery | NOT_VERIFIED | No Google production ID token or signed-in device, deployed server, account billing proof, or powered-off-phone experiment. No real provider writes or paid API |

**Final HEAD / merge:** all **5/5** PR-head CI SUCCESS on `9bfb371520592ee5afa3297873a9a4b08a8d4c52`. [PR #12](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/pull/12) merged as `4028d783bd332470e198a6fd0607c2562b0ca726`. The merge SHA is confirmed by GitHub but **main-merge CI and documentation-only follow-up SHAs are not independently verified** by these PR-triggered runs.

**Failure preserved:** intermediate source SHA `7c9bd63a18c6719b58af60f90be31f7fb811e6c9` failed [Android build 42764978876](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42764978876) and [Android adapter 42764978636](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42764978636) because a Kotlin test function was named starting with `409`. Corrected function identifier, not a bypass of test execution. Rerun has exact test count above.

**Budget:** source gates cap three external GitHub GET attempts per scheduled tick when feature-gated mobile mode is enabled; real Cloudflare allowance and account charges have not been inspected. Enabling remote Cron remains prohibited without explicit approval. No cloud job is currently claimed to be running. For rationale see [ADR-0007](ADR/0007-android-cloud-control-observation-evidence.md).

---

## P1-E Android Google sign-in + manual cloud adapter (10 November 2026; PR #11 merged, not deployed)

| Gate | Result | Exact environment/source |
| --- | --- | --- |
| Native Android debug APK + JVM unit tests | SUCCESS | [Android run 42760135711](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760135711) on `fbde24642ee96b8e4d8a78a33d89d49431526e0d`; APK SHA-256 `c4959e4d469e5c6eebd89ceb1c1d8ff7af0abd91052237bd9f60d1aca130e3d8` |
| Existing real public GitHub Android JVM adapter | SUCCESS | [Run 42760135615](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760135615), same SHA, JVM not physical device |
| Source backend + TS | SUCCESS | [Run 42760135523](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760135523), same SHA |
| Local workerd/D1 | SUCCESS | [Run 42760135508](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760135508), same SHA; not real Cloudflare remote |
| Live public GitHub Worker GET | SUCCESS | [Run 42760135668](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760135668), same SHA; not Cron/device-off |
| Explicit Android signed-in cloud sync | NOT_VERIFIED | Google Web Client ID and Worker HTTPS origin intentionally blank in CI; tests mock transport and token-shaped strings |
| Real Google sign-in + actual server ID token verification | NOT_VERIFIED | No configured Google OAuth project/device/real issued token |
| Device installation, RAM/battery, powered-off Cloudflare Cron | NOT_VERIFIED | Device and remote setup/authorization required |

**Final PR-head CI gate:** 5/5 workflows SUCCESS on SHA `e1dc90816ecc85df064fa379bda114c35541e967`: [Android 42761079608](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42761079608) with `CloudSyncClientTest` 7/7 executed, 0 skipped/failures/errors and debug APK SHA-256 `172d937de4f021716be1504ea74bc9329070edc39722402e98a6b801722c3bc0`; [Android provider adapter 42761079643](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42761079643); [backend 42761079408](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42761079408); [local D1 42761079456](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42761079456); [GitHub read 42761079496](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42761079496). [PR #11](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/pull/11) merged as `a1b86a3a95895c8516d3be766379ec6b42faee17`. Main merge SHA and later docs commits have not been independently CI-verified. No remote Cloudflare, real Google identity, phone-off test or spending.

**Initial failure and correction:** Android runs [42759905864](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42759905864) and [42759905986](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42759905986) failed on `cbc107b5c730ddc097f2e5efd8b8e3f0397985b5` due to Google ID SDK 1.2.1 Kotlin 2.4 metadata incompatible with app compiler 2.2 metadata reader. Pinning `googleid:1.1.1` yielded green CI, without unsafe skip flags.

**Follow-up XML gate verified** on source SHA `c0842663c98f2ef67d73b3fabda657fe708aa313`: [Android run 42760557852](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760557852) SUCCESS. CI log: `Cloud sync security tests: {'tests': 7, 'failures': 0, 'errors': 0, 'skipped': 0}`. Debug APK SHA-256 `96d5a706cb310b874cccb3fce4787922f834ecab5b02c27bae8b52c9f26d51db`. Other four workflows on that SHA also SUCCESS: [backend](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760557716), [local D1](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760557874), [live GitHub Worker GET](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760558191), [Android adapter](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760557793). This validates source and JVM test execution, not real Google login or mobile remote Worker. Later response-hardening and documentation commits require an independent final-head CI check. Live providers, Google OAuth registration, real backend domain and remote Cloudflare remain unverified.

---


## P1-D: bounded multi-user scheduler (10 November 2026, merged PR #10, not deployed)

| Gate | Evidence class | Source SHA and exact verification |
| --- | --- | --- |
| 20 identities / 9 ACTIVE mobile monitors / 3 GET attempts per tick / 1 monitor per owner | CI_VERIFIED_SYNTHETIC | [Backend 33/33 + TypeScript 42755265080](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265080); source `1d7640417a7bbae9435098cd71fcc45c5418957a` |
| Owner-scoped OIDC status PATCH, feature flag default disabled, stale version and pause-during-inflight | CI_VERIFIED_SYNTHETIC | Same source and run; signed fixture identities, injected GitHub responses |
| D1 cursor persistence, restart and fair owner rotation | CI_VERIFIED_LOCAL_WORKERD | [workerd/D1 5/5 42755265299](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265299); same source SHA |
| Existing GitHub and Android regression | CI_VERIFIED | [Live GitHub 42755265084](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265084), [Android network adapter 42755265417](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265417), [Android build 42755265184](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265184) SUCCESS on same source SHA |
| Real remote Cloudflare Cron / phone switched off | NOT_VERIFIED | No remote deployment, no device-off task IDs / timestamps, no billing validation |
| Android real OAuth + synced cloud monitor | NOT_IMPLEMENTED | Existing APK has manual public GitHub preview only; no mobile bearer token |
| Fairness under concurrent remote Worker ticks | NOT_VERIFIED | Lease fencing is tested; exact cursor order under overlapping remote Cron still an open risk |

**Final PR-head gate:** all **5/5 GitHub Actions workflows SUCCESS** on `fa8471459ed7608fd6bf3f45d13cca74006851b5`: [source 42755625591](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755625591), [local D1 42755625446](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755625446), [live GitHub 42755625823](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755625823), [Android adapter 42755625621](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755625621), [Android APK 42755625491](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755625491). [PR #10](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/pull/10) merged as `2368b27c18d0f6c07c2e61377c12ad6331b1c36b`. **Main-merge SHA run and subsequent ledger-only commits are not independently verified**. No remote D1, billable API or phone-off tests were performed.

**Initial failure preserved:** [first PR-head source run 42755148731](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755148731) failed due to malformed route TypeScript syntax; corrected with complete route replacement. Do not equate syntactic failure with a passed scheduler test. Source proof above is after the fix. For full technical limitations, see [ADR-0005](ADR/0005-bounded-fair-mobile-scheduler.md).

---

## 2026-11-10 | P1-C scoped user monitor sync (source CI)

| Gate | Class | Concrete proof and limits |
| --- | --- | --- |
| Server-owned identity mapping | CI_VERIFIED_SYNTHETIC | Signed RS256 test identities map to opaque UUID in D1, not client owner fields; no real OIDC provider verified |
| Owner-isolated monitors and observations | CI_VERIFIED_LOCAL | 28/28 tests [offline CI 42750701827](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750701827); cross-account list/observation access denied |
| Idempotent create and quota | CI_VERIFIED_LOCAL | Same draft ID/content replays to same server monitor ID, changed payload conflicts; owner-specific cap 3 checked in atomic SQL statement |
| Real Cloudflare-compatible local D1 | CI_VERIFIED_LOCAL_WORKERD | 4/4 [workerd/D1 CI 42750701808](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750701808); migration upgrade preserves operator row, replay works across runtime restart |
| Regression on preexisting GitHub and Android | CI_VERIFIED | [Worker live GET 42750701796](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750701796), [Android adapter 42750702269](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750702269), [Android build 42750701661](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750701661) all SUCCESS |
| Actual Android identity + client sync | NOT_IMPLEMENTED | No mobile OIDC login, token lifecycle or cloud-monitor screen; backend API only |
| Multi-user scheduled execution | NOT_IMPLEMENTED | Mobile monitors created PAUSED, legacy scheduler scoped to OWNER_ID |
| Remote Cloudflare D1/Cron + phone off | NOT_VERIFIED | No deployed resource or device-off test. See issue #2 |

The above development-source CI links refer to **source SHA `633ccda10beda76d864a1ee9cd1303e284bf8268`**. In addition, **all 5/5 workflow checks SUCCESS on final PR HEAD `fc39f66343048a8dfdbae887035bef25d9ddca63`**: [source](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750920672), [local D1](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750920480), [live GitHub GET](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750920518), [Android live adapter](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750920679), [Android APK](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750920423). [PR #9](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/pull/9) merged as `778a8cbb42fca71074d9800607c7f5b358e51242`. Separate CI on the merge/main and later documentation commits has not been claimed. No cloud resource provisioning, live OIDC token, external writes or free-tier accounting was performed. Review final HEAD and merged main separately.

---

## 2026-11-10 P1-C identity boundary: source proof only

| Gate | Classification | Evidence and limitation |
| --- | --- | --- |
| RS256 cryptographic verifier | CI_VERIFIED_SYNTHETIC | [Offline CI 42747877456](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42747877456) SUCCESS on `af55967f6d6370861dc1b02367a7c53883f08219`; 19/19 backend tests including 7 OIDC security cases, TypeScript check; generated test RSA/JWKS, not Google live |
| `GET /v1/me` | CI_VERIFIED_SYNTHETIC | Worker endpoint exercised with signed synthetic token and mocked JWKS fetch; no owner token or DB required. Response says `monitorSync:false`. Not deployed |
| Wrong issuer/audience, expiry, alg confusion, forged token, wrong/ambiguous JWKS keys | CI_VERIFIED_SYNTHETIC | Negative test cases; fail-closed behavior for these tested scenarios, NOT a complete security audit |
| Public real OIDC provider login | NOT_VERIFIED | No real Google/Firebase/OIDC credential or issuer integration |
| Mobile secure token storage and account-scoped data | NOT_IMPLEMENTED | No server user mapping, SQL owner isolation for OIDC identities, or Android login/cloud sync |
| Remote Cloudflare + powered-off phone | NOT_VERIFIED | Issue #2 stays open |
| Final PR HEAD | CI_VERIFIED | 5/5 workflows SUCCESS at `cc42f084ed61ccb7f7cffd5cf9f2b69f8508307b`: [backend](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42748123959), [D1](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42748123925), [GitHub GET](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42748123934), [Android build](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42748123872), [Android adapter](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42748123994) |
| Merge into main | MERGED / MAIN_CI_UNVERIFIED | [PR #7](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/pull/7) merged, commit `cd2298a6b91392af9024afa4bd7ba42d8bdc6be3`; no separate main-commit CI evidence recorded yet |

**Observed failure/correction:** source run 42747699679 failed one integration assertion on SHA `24c83e393424f6582daa16dae1ea545929432272`: test referenced synthetic JWKS hostname without a fetch fixture, causing 503. Fixed test stub only; source run 42747877456 then passed. This is test infrastructure evidence, not a live-provider outage.

---

## Current milestone: 2026-11-10 P1-B

| Gate | Status pending final CI | Interpretation |
| --- | --- | --- |
| Manual Android-to-public-GitHub read | CI_VERIFIED_JVM_LIVE | [Run 42668086200](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086200) SUCCESS on `d90887a3d407d5178368ce197bb99e6e8c84545a`; 1 executed, 0 skipped, 0 failure; NOT physical Android device |
| Local snapshot after verified read | CI_VERIFIED_JVM | [Android CI 42668086432](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086432) deterministic codec tests; older drafts preserved, individual corrupt records isolated. SharedPreferences hardware persistence NOT verified |
| APK build and permissions | CI_VERIFIED | [Android CI 42668086432](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086432) SUCCESS, debug APK aefbceab40f1cf17c54a930cf682540d21f5d6766e0ea21a9562cdf6434d48ad; `aapt` found INTERNET and excluded tested sensitive permissions |
| UI/background safety | SOURCE REVIEWED | Manual-only, coroutine IO; no continuous background polling, no local LLM, no owner bearer token |
| Full cloud agent when phone off | NOT VERIFIED | Cloudflare remote Worker, D1, Cron and authenticated Android sync still absent |
| Resource benchmark | NOT MEASURED | No device memory, thermal or battery data exists |

**Evidence standard:** see PR and GitHub Actions links in final progress update. The earlier phase tables below are historical snapshots, not statements about today's full implementation.

---

## Historical evidence: Stage P0.1

| Check | Current evidence class | Evidence / gap |
| --- | --- | --- |
| Product use case | IMPLEMENTED | GitHub public repository commit-head monitor via Worker API and scheduler; not yet live deployed |
| Clean-environment setup | LOCAL_TESTED | Node 22.16 + no runtime dependencies, offline test; remote Wrangler/Cloudflare setup pending |
| CI, SHA and results | CI_VERIFIED | [main run 42651566624](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42651566624) passed on `d8298143a942d75ad6846fcd1510ea4ea2cde704`; PR head `982f6ad8` also passed. Subsequent documentation-only ledger commits have their own CI status. |
| Happy path and failure paths | LOCAL_TESTED | 10 Node/SQLite tests, synthetic GitHub HTTP responses |
| Threat model | DOCUMENTED | `docs/THREAT_MODEL.md`, residual risks clearly identified |
| Benchmark with environment | NOT_MEASURED | No latency/RAM/battery claims; see `docs/BENCHMARKS.md` |
| Real-provider state | NOT_VERIFIED | No live GitHub read or remote D1; no external writes in P0.1 |
| Design decisions | DOCUMENTED | `docs/ADR/0001-cloud-execution.md` |

**Test isolation matters:** deterministic fake GitHub GET and Node SQLite are strong behavioral evidence, but do not establish live Cloudflare or owner-device acceptance. Update this ledger only after reading actual CI and committing a SHA-bound verification record.


## P0.2-A CI verification | 9 November 2026

| Check | Classification | Evidence |
| --- | --- | --- |
| Native-compatible D1 local binding | CI_VERIFIED_LOCAL | [Run 42655079982](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42655079982) **SUCCESS**, 2/2 workerd/D1 integration tests on `09f8a927830285e0cbf8f83c19193123c7d9fb19` |
| Offline regression after hardening | CI_VERIFIED | [Run 42655079899](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42655079899) **SUCCESS**, 12/12 tests and TS typecheck on same SHA |
| Owner fail-closed | CI_VERIFIED | Missing, malformed or absent OWNER_ID rejects API operations and scheduler processing |
| Provider-body bound | CI_VERIFIED | Streaming limit 32768 bytes, malformed UTF-8 rejected, no fabricated observation |
| Persistence after local runtime restart | CI_VERIFIED_LOCAL | Local D1 workerd is disposed and reopened with preserved state, baseline and subsequent change are verified |
| Stale worker fencing | CI_VERIFIED_LOCAL | Concurrent scheduled fetch then pause; stale continuation cannot write an observation |
| Real remote Cloudflare D1/Cron | NOT_VERIFIED | Requires authorized Cloudflare account provisioning and disposable deployment |
| Real external GitHub GET from deployed Worker | NOT_VERIFIED | All current injected provider responses remain synthetic |
| Android running/phone switched off | NOT_VERIFIED | No APK or owner-device acceptance yet |

**Boundaries:** Local `getPlatformProxy` emulates Cloudflare bindings via `workerd`, not a remotely provisioned Cloudflare service. The test applies complete migration statements through D1.prepare rather than running remote Wrangler migrations. CI success does not certify external cloud availability or cost. Source commit tested is different from later documentation-only commits; review exact run SHA.

## 2026-11-09: P0.2-B partial + P1-A evidence additions

| Requirement | Status | Evidence / boundary |
| --- | --- | --- |
| Real GitHub provider read | LIVE_PROVIDER_READ_TESTED | [CI 42661442994](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42661442994) succeeded on SHA `dddbba531304c29efc6495983d1500173999b40a`: official public GitHub GET + local workerd/D1 observation + independent GitHub ref matched HEAD `7dd952b9a1f1a02d1f68f538e11164e542beff4c`. This is read-only source truth, not a live Cloudflare deployment. |
| Android product artifact | APK_CI_VERIFIED | [Android CI 42661442547](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42661442547) built an experimental debug APK and executed JVM unit tests. Not a physical-device acceptance, polished production app or secure cloud-connected client. |
| Android auth boundary | SOURCE_IMPLEMENTED | Manifest contains no INTERNET permission; no owner token is embedded. Actual APK permission inspection is a separate follow-on CI gate. |
| Android RAM/battery | NOT_MEASURED | No physical device benchmark, PSS, battery, thermal or crash evidence. |
| Independent remote autonomy | NOT_VERIFIED | Local D1 and GitHub Actions tests cannot prove a powered-off phone and operational cloud scheduler. |
| Engineering ADR and runbook | DOCUMENTED | [ADR-0002](ADR/0002-android-offline-draft-pilot.md), [Android acceptance](ANDROID_ACCEPTANCE.md) and [live provider acceptance](LIVE_PROVIDER_ACCEPTANCE.md). |

Historical passing build/run IDs are deliberately linked to **exact tested source SHAs**. Do not upgrade source-only additions to current-main CI proof until the final merged SHA passes.
