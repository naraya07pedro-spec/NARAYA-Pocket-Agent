# Evidence register | NARAYA Pocket Agent

## 2026-11-10 P1-C identity boundary: source proof only

| Gate | Classification | Evidence and limitation |
| --- | --- | --- |
| RS256 cryptographic verifier | CI_VERIFIED_SYNTHETIC | [Offline CI 42747877456](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42747877456) SUCCESS on `af55967f6d6370861dc1b02367a7c53883f08219`; 19/19 backend tests including 7 OIDC security cases, TypeScript check; generated test RSA/JWKS, not Google live |
| `GET /v1/me` | CI_VERIFIED_SYNTHETIC | Worker endpoint exercised with signed synthetic token and mocked JWKS fetch; no owner token or DB required. Response says `monitorSync:false`. Not deployed |
| Wrong issuer/audience, expiry, alg confusion, forged token, wrong/ambiguous JWKS keys | CI_VERIFIED_SYNTHETIC | Negative test cases; fail-closed behavior for these tested scenarios, NOT a complete security audit |
| Public real OIDC provider login | NOT_VERIFIED | No real Google/Firebase/OIDC credential or issuer integration |
| Mobile secure token storage and account-scoped data | NOT_IMPLEMENTED | No server user mapping, SQL owner isolation for OIDC identities, or Android login/cloud sync |
| Remote Cloudflare + powered-off phone | NOT_VERIFIED | Issue #2 stays open |
| Final PR docs/merge SHA | PENDING | CI above covers source SHA before subsequent documentation commits |

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
