# ADR-0004: P1-C secure Android-to-cloud synchronization contract

Date: 2026-11-10
Status: PARTIALLY IMPLEMENTED (server-only RS256 identity probe merged via PR #7; synthetic CI verification, no deployment)
Baseline: main `e1e0dd7034d85500d3e7ab4474b7bc853a8ef7d1`

## Decision and scope

Ship the smallest authenticated Android ↔ Cloudflare Worker synchronization path for **public GitHub repository monitors**, without replacing the existing local-only manual preview.

1. Android continues to create local drafts and manually preview public GitHub commit heads with no operator secrets.
2. After user sign-in, Android obtains a short-lived user identity token from an OIDC provider. The Worker verifies its issuer, audience, signature against pinned/allowlisted issuer JWKS, expiry, not-before and subject. Cache JWKS defensively with key rotation; reject unknown algorithms, issuers and audiences. Provider choice is provisional until actual availability and free-tier verification.
3. Worker maps verified `issuer + subject` to a server-owned internal user ID. Ignore client supplied `ownerId`, `userId`, or `subject` for authorization. Never accept the existing `OWNER_API_TOKEN` from mobile, and keep the pilot operator endpoints isolated.
4. All monitor reads, creates, pause/resume requests and observations are scoped to the authenticated owner at the SQL boundary. For existing data, do not migrate or expose pilot owner records automatically. Any migration requires explicit ownership mapping and tests.
5. Client sync is explicit/manual in the first milestone; scheduled cloud execution stays server side. No continuously running Android service. Offline cache is informative, not an authorization oracle.
6. No production deployments, provider writes, external sends, paid APIs or cloud resources without separate explicit operator authorization.

## Proposed minimal contract (subject to implementation tests)

- `GET /v1/me` returns internal opaque user identifier and minimal client capabilities.
- `POST /v1/sync/monitors` accepts a bounded list of public-repository monitor drafts with client-generated stable UUIDs, normalized repo slug, approved interval, and optional local revision. Server verifies ownership, quota and schema; deduplicates on `(owner_id, client_draft_id)`.
- `GET /v1/sync/monitors?cursor=...` returns owner-scoped monitors, versions and current server state, with bounded pagination and opaque server-generated cursor. Cursor must not grant authority, leak another owner or allow arbitrary SQL filters.
- `GET /v1/observations?monitorId=...` remains server-owned and owner-scoped after auth.
- `PATCH /v1/monitors/{id}` requires `expectedVersion` for optimistic concurrency.
- Error codes: `401` missing/invalid identity, `403` forbidden operation, `404` nonexistent or foreign record (prefer no existence disclosure), `409` stale state, `413` oversized payload, `429` quota. No raw tokens/claims in errors or logs.
- Idempotent draft upload must return the same server mapping after retry; if the same `client_draft_id` is reused with conflicting canonical content, return explicit conflict rather than silently overwrite.

## Trust boundaries and migration order

A. Introduce verifier interface with injectable JWKS fetcher and deterministic fixture identities; verify fail-closed behavior offline. No real credential in source/tests.

B. Add per-owner SQL tests before routes: authenticated owner A cannot list, read, pause, update or observe B's monitors; invalid cursor and IDOR attempts do not disclose data. Exercise D1 workerd binding in CI separately from SQLite doubles.

C. Add migration with unique `(owner_id, client_draft_id)` and indexes; retain existing schema/data without destructive migration. No automatic merge of legacy pilot owner with sign-in account.

D. Add sync routes with request bytes/items quotas, typed validation, idempotent reservation and stable response shape. Version check and write must be atomic.

E. Android introduces opt-in sign-in and authenticated sync adapter with secure token handling; no refresh or access token in SharedPreferences plaintext, APK resources, logs or cloud audit. Use OS-supported credential/token storage; verify actual behavior with Android instrumented tests.

F. Manual acceptance: sign in, sync one existing draft, create cloud monitor, observe a legitimate GitHub change in Worker/D1, restore Android app, resync exactly the same monitor ID. Device-off + real Cron is **separate acceptance** in issue #2, not implied by sync tests.

## Non-negotiable acceptance/security tests

- Missing/expired/wrong-issuer/wrong-audience/forged JWT: reject before database access or external fetch.
- JWKS timeout, malformed key set, algorithm confusion: reject without insecure fallback.
- A/B account isolation for create/list/read/update/observations, including guessed IDs and stale cursors.
- Replay same draft ID + same body: exactly one monitor, stable mapping. Same ID + changed body: conflict.
- Retry after simulated network drop/timeout: no duplicate creation.
- Stale `expectedVersion`: 409, no mutation.
- Quota limits and malformed payload: fail safely without partially creating unbounded records.
- Offline Android: existing drafts and last verified read remain available, no fabricated cloud success.
- Revoked/expired session: no background silent mutation; require reauthentication.
- GitHub provider failure/rate-limit: bounded and auditable, no untrusted URL or redirect.
- Test provenance: commit SHA, workflow run links, environment and failures recorded in EVIDENCE.md.

## Failure modes and rollback

- Auth provider free tier unavailable: keep P1-B manual read only; do not weaken identity verification.
- Auth verification fails closed due to JWKS outage: show temporary authentication unavailable; never fall back to OWNER_API_TOKEN.
- D1 migration failure: retain P1-B branch as functional offline baseline, do not deploy partial schema.
- Cross-user leak or uncontrolled paid usage: block release immediately and investigate before continuing.
- Cloud task remote schedule not verified: status remains `NOT_VERIFIED`, never advertise powered-off autonomy.

## Evidence gate

The server-side RS256/JWKS verifier and read-only `GET /v1/me` probe exist on main (merged PR #7). PR #9 adds server-owned identity mapping, non-destructive D1 migration, `POST/GET /v1/sync/monitors` single-item replay-safe sync, and owner-scoped observation reads, tested using synthetic signed JWTs and local workerd/D1 (see EVIDENCE.md). New synced monitors remain PAUSED; legacy single-owner scheduler is not enabled for them. **Real OAuth sign-in, Android client sync, JWKS caching/rotation, safe multi-user scheduler, remote D1, phone-off demo and device benchmarks remain unimplemented/unverified.** The next engineering gate is owner-scoped SQL isolation and idempotent sync, not a claim of end-to-end Android login.
