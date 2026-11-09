# Evidence register | Stage P0.1

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
