# ADR-0016 | Read-only signed sync must not register identities

Date: 10 November 2026
Status: MERGED via PR #21 as `4ec8bf434ece4078dca41be9099f8553f0d78f44`. Exact final PR HEAD `e223292a51826612cd9ac63e1a9b4ea1c86fdffd` passed 5/5 CI (78/78 Node/backend/preflight, 11/11 local workerd/D1, 20/20 Android security JVM). No deployment, owner/account access or remote acceptance.

## Finding

Before this change, `mobileSync(request,...)` called `ownerFromVerifiedIdentity` on **every** signed sync request, before checking the route, monitor UUID or JSON body. That helper attempted a D1 `INSERT INTO user_identities ... WHERE COUNT(*) < 20 ON CONFLICT DO NOTHING` even for users already mapped to the same `issuer+subject`. Its eventual conflict might be a no-op, but it was still a write-path statement and an unnecessary capacity count on every read. In addition, any valid Google/OIDC account could consume one of 20 durable pilot identity slots by making an otherwise invalid GET, POST or PATCH. This is supported by source inspection; no real Cloudflare D1 bill, latency or abuse incident has been measured.

The project's core principle is **bounded, cheap, owner-isolated cloud operation**. Read-only UI refreshes must not repeatedly take the identity write path. A first-time user merely opening the cloud list should not occupy permanent pilot capacity.

## Decision

1. **Always authenticate first.** `verifyOidcBearer` still verifies the signed OIDC token and returns only issuer and subject; bad JWTs receive 401 before route/body parsing, database lookup or registration. No operator bearer is accepted as mobile authority.
2. Validate known method/path and monitor UUID; reject invalid route with 404 and invalid observations query with 400. Parse bounded JSON and strict POST/PATCH schemas **before** consulting identity registration. An invalid authenticated request cannot consume one of the 20 identity slots.
3. On valid calls, perform an indexed D1 `SELECT id FROM user_identities WHERE issuer=? AND subject=?`. If the identity exists, return the existing validated UUID without attempting `INSERT` or `COUNT`. A user's legitimate repeated GET/PATCH/POST no longer invokes an identity write statement.
4. If the identity is new and the request is **GET or PATCH**, **do not register**. For a first-time `GET /v1/sync/monitors`, return the same observable `{monitors:[]}` response without any D1 write. Observation reads or PATCH against a nonexisting owner return 404. This does not expose cross-owner monitor existence.
5. Only an explicit **valid first POST /v1/sync/monitors** triggers identity registration. Preserve the existing single-statement 20-account atomic cap and `ON CONFLICT(issuer,subject) DO NOTHING`; then read the winning identity mapping. Concurrent first POST retries retain the same owner ID, idempotent draft ID and quota invariants. Reusing a signed user after hitting the 20-account cap still works; a previously unseen 21st user is 429 on first POST but may harmlessly GET an empty list.
6. Identity registration alone is *not* a paid action or a claim that remote sync/monitor execution succeeded. The server creates new monitors PAUSED and remote scheduler flags remain OFF by default. No D1 migration, worker route, account plan, Google OAuth credentials, device permission or provider call changed.

## Source tests and evidence limits

- Node integration instrumentation counts `INSERT INTO user_identities` `run()` calls: first GET = zero, first valid POST = one, and repeated valid GET/observations/status/retry POST = **zero further identity INSERT attempts**. This is a **source-level statement count**, not measured Free-tier D1 billing.
- Valid OIDC requests with invalid route/method, malformed client draft UUID, invalid status version or query UUID leave identity count at zero. JWT with incorrect audience is rejected 401 before input validation.
- A signed-user capacity regression explicitly registers 20 owners through POST and checks 21st POST returns `pilot_identity_limit` while 21st GET remains an empty, read-only 200. Existing owner can still read after capacity saturation.
- Real **local Cloudflare workerd/D1** tests verify an unknown signed user's GET and invalid observation query leave `user_identities` empty, valid explicit POST creates one identity, prior-owner ID stays stable across restart and JWKS cache tests still use two independent real RSA-signed **synthetic** tokens.
- Offline preflight static source guard and mutation tests forbid moving identity registration before route/body checks or removing the read-only unknown-identity branch.
- Final 5/5 GitHub Actions on exact PR-head SHA are required before merging; document syntax/test fixture mistakes and corrected CI with exact links. Do not infer main merge/docs-only CI.

## Risk, trade-off and next gate

Read-only-first is a deliberate behavioral change for a first-time authenticated user: viewing the empty monitor list no longer writes an identity row. Existing owner mapping, monitor access control, OIDC validation and 20-account registration cap remain. The extra read on the **first** POST is intentional to reduce repeated write-path calls. The query volume and billing impact of remote D1 were **not measured** and cannot be promised as cost savings until an owner-approved deployed pilot provides actual metrics.

The central objective, autonomous Cloudflare Cron during a physically powered-OFF Android device, is **still NOT VERIFIED**. Real owner-approved D1 migrations 0001–0005, account cost/CPU inspection, Google OAuth issued tokens, a trusted HTTPS Worker, physical device testing and independently verified remote observations remain open. No Cloudflare deployment or fee-bearing resource was initiated by P1-O.

[PROGRESS](../PROGRESS.md) · [EVIDENCE](../EVIDENCE.md) · [Issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8) · [Owner-only pilot gates](../REMOTE_PILOT_READINESS.md)
