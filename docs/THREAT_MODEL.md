# Threat model | P0.1

**Assets:** Cloudflare secret token, task ownership, GitHub source selection, observation truth, quotas and public monitor metadata. **Attacker:** anonymous HTTP client, compromised browser/CLI token, malicious GitHub repository metadata, racing scheduler invocations, and a mistaken operator.

| Threat | Implemented control | Residual risk / next gate |
| --- | --- | --- |
| Unauthorized access | 32+ character secret required; digest-based fixed-length comparison; no-store, no CORS | Bearer token is full authority for single-owner pilot. Must not ship in Android. Rotate after exposure. |
| Cross-owner query | SQL uses server-owned `OWNER_ID`; observation join scopes owner | Single-owner config is not multi-user identity; Firebase/OIDC token verification is required before release. |
| SSRF/redirect | Fixed `api.github.com`, slug validation, GET only, redirects rejected | GitHub upstream data and availability remain external dependencies. |
| Unbounded polling | 3 monitors, 3 checks/tick, min 30-minute interval, auto-pause after 5 consecutive failures | Account and provider rate-limit interactions need actual deployment validation. |
| Duplicate processing | Conditional D1 lease claims and lease-bound state writes | D1 semantics and geographically distributed contention not yet tested against real D1. |
| Stale worker | Lease token checked on all state/evidence writes, pause clears lease | A late fetch still consumes an outbound read; maximum provider call cost remains bounded. |
| False success | SHA format validation, explicit failure codes, no observation on timeout/429/invalid payload | GitHub API response is source evidence, not a signed attestation or independent release proof. |
| Secrets and logs | No credentials or response bodies committed/logged; redacted error codes | Provider account secrets must be reviewed before actual deployment. |
| Request abuse | 4-KiB streaming JSON bound, strict body/route validation, no browser CORS | Token theft and volumetric abuse remain possible; deploy-time WAF/rate controls are future work. |
| Supply chain | Zero runtime dependencies for source unit tests, no automatic deploy | Wrangler installation and cloud pipeline not yet verified. |

No professional penetration test, production security audit, or real user traffic has occurred. Do not use this pilot with customer data or embed bearer secrets into mobile builds.
