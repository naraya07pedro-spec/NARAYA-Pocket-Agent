# Evidence register | NARAYA Pocket Agent

## P1-D: bounded multi-user scheduler (10 November 2026, pre-merge source)

| Gate | Evidence class | Source SHA and exact verification |
| --- | --- | --- |
| 20 identities / 9 ACTIVE mobile monitors / 3 GET attempts per tick / 1 monitor per owner | CI_VERIFIED_SYNTHETIC | [Backend 33/33 + TypeScript 42755265080](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265080); source `1d7640417a7bbae9435098cd71fcc45c5418957a` |
| Owner-scoped OIDC status PATCH, feature flag default disabled, stale version and pause-during-inflight | CI_VERIFIED_SYNTHETIC | Same source and run; signed fixture identities, injected GitHub responses |
| D1 cursor persistence, restart and fair owner rotation | CI_VERIFIED_LOCAL_WORKERD | [workerd/D1 5/5 42755265299](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265299); same source SHA |
| Existing GitHub and Android regression | CI_VERIFIED | [Live GitHub 42755265084](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265084), [Android network adapter 42755265417](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265417), [Android build 42755265184](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265184) SUCCESS on same source SHA |
| Real remote Cloudflare Cron / phone switched off | NOT_VERIFIED | No remote deployment, no device-off task IDs / timestamps, no billing validation |
| Android real OAuth + synced cloud monitor | NOT_IMPLEMENTED | Existing APK has manual public GitHub preview only; no mobile bearer token |
| Fairness under concurrent remote Worker ticks | NOT_VERIFIED | Lease fencing is tested; exact cursor order under overlapping remote Cron still an open risk |

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
