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
