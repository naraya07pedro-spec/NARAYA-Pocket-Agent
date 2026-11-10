# ADR-0017 | Atomic first-monitor identity registration

Date: 10 November 2026
Status: MERGED via PR #22 as `9ed668cbc372298bacf4f3785c92a2e3dd07105d`. Exact final PR HEAD `63a43e8b35b5beff314e70d96a853e7dbbbe8bae` passed **5/5 CI** (82/82 Node/backend/typecheck, 11/11 local workerd/D1, 20/20 Android security JVM). No remote Cloudflare deployment, account read or real phone acceptance.

## Source finding

P1-O correctly made signed-user first GET read-only and restricted identity onboarding to an authenticated, valid first monitor POST. However, the first POST still used a separate D1 `INSERT INTO user_identities`, followed later by `INSERT OR IGNORE INTO monitors`, without a shared transaction. If the monitor INSERT threw, was ignored, or the Worker failed between operations, a user identity could remain persisted without a corresponding monitor. This would permanently occupy one of only 20 pilot identity slots even though no monitor was created. The **risk follows directly from source sequencing**, not from an observed remote production failure.

Official Cloudflare D1 [`batch()` documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/) guarantees sequential statements in a **single SQL transaction**, with abort/rollback of the entire list on statement error. Cloudflare's [D1 query-performance guidance](https://developers.cloudflare.com/d1/observability/find-expensive-queries/) clarifies that batching reduces round trips, **not the number of SQL statements or rows billed**. These are provider documentation assertions; no owner account quota or actual CPU data was consulted.

## Decision

1. **Authenticate and validate request first** exactly as P1-O: verified OIDC issuer/subject, known HTTP route, bounded JSON, canonical repository input and valid client draft UUID. First GET still returns `{monitors:[]}` with **zero identity INSERT attempts**, and unknown-user foreign observation/PATCH returns 404 without registering.
2. **Existing identity:** indexed `SELECT id WHERE issuer=? AND subject=?` returns a stable mapped owner UUID, and the existing atomic single-statement monitor insert is unchanged.
3. **New identity and explicitly valid first POST:** one `env.DB.batch([statementA,statementB,statementC])`:
   - A: `INSERT INTO user_identities ... SELECT ... WHERE COUNT(*) < 20 ON CONFLICT(issuer,subject) DO NOTHING`. Retains the atomic global pilot identity capacity, issuer+subject uniqueness and concurrent first-request conflict handling.
   - B: `INSERT OR IGNORE INTO monitors ... SELECT new_monitor_id, identity.id, ... FROM user_identities identity WHERE issuer=? AND subject=? AND owner_monitors<3`. Creates a **PAUSED** monitor with the same canonical repository/draft digest and SQL uniqueness constraints. It derives the winning owner ID inside the batch even under concurrent first requests; no stale candidate owner ID is trusted.
   - C: `DELETE FROM user_identities WHERE id=? AND issuer=? AND subject=? AND NOT EXISTS(SELECT 1 FROM monitors WHERE owner_id=?)`. Deletes **only the random identity candidate from this request**, and **only if** that identity still owns zero monitors. This handles B's `INSERT OR IGNORE` returning zero changes. A concurrent request's different winning identity cannot be deleted by this condition.
4. If statement B **throws**, D1's transactional batch rolls back statement A and no orphan identity persists. If B is ignored and C removes this request's newly created identity, the Worker reports a **generic internal error, never 201 or an active monitor**. The caller may retry the same draft safely.
5. Require D1 batch `meta.changes` to be **0 or 1 for all three statements**. Missing or abnormal metadata is fail-closed; do not claim a successful monitor or a valid capacity outcome on an ambiguous write.
6. After a successful committed transaction, re-query the verified issuer+subject mapping and read the owner-scoped monitor to render the same `{monitor,created}` JSON and HTTP 201/200 contracts as before. Nonexistent 21st identity with no winning mapping is 429 `pilot_identity_limit`. Original three-monitors-per-owner capacity and draft idempotency remain.

This intentionally adds an extra conditional SQL statement on the **first** registration only, to close the partial-write failure mode; it is not presented as an unconditional D1 billing improvement. Existing users remain on the cheaper read-first route. A repeated first draft/parallel POST still has only one identity and one monitor due the DB uniqueness constraints.

## Source and runtime verification

- Three new Node tests inject an exception **after the first identity INSERT but before monitor persistence**, and a simulated successful-but-zero-change `INSERT OR IGNORE`. The first two assert **no identity, no monitor, HTTP 500, then safe same-draft retry 201**, with later idempotent retry 200. The third simulates **a committed transaction with missing batch result metadata** and asserts HTTP 500 despite committed rows, followed by a safe same-draft replay 200 with no duplicates.
- A real **local Cloudflare workerd/D1** test injects a *valid SQL* unique-key violation as the **second** statement of the same D1 batch, designed to fail only after A inserted the candidate identity. It verifies the original identity and monitor counts remain **zero** after the transaction fails, then the normal first POST succeeds. This tests actual local D1 rollback, not remote Cloudflare.
- Existing Node and workerd tests re-check authenticated user isolation, 20-identity quota, concurrent first POST retries, invalid JWT precedence, PAUSED creation, and scheduler/Android regression. Source preflight mutation checks that future edits cannot silently separate A/B from the transactional `batch`, drop C's owner-scoped cleanup, or misrepresent the response after cleanup.
- **Known design boundary:** A successful insert can still have an ambiguous client-side response if the network or Worker fails *after* the D1 commit. Existing idempotent draft replay resolves this on retry; no claim of an exactly-once network delivery guarantee.
- This feature does not independently validate private Cloudflare account D1 usage charges, CPU, Free-plan quota, real Google-issued Android ID tokens, physical phone power-OFF, or remotely deployed Cron.

## Release and operations

No D1 schema migration is required by P1-P; migrations **0001–0005** remain mandatory before future owner-approved deployment. The Worker remains unpublished with no real bound D1 UUID in source. Both scheduler flags are still OFF by default. No billing permission, account secrets, remote resource or provider write was accessed.

Before merge, verify **five GitHub Actions** at the **exact final PR-head source SHA**: Node source+TypeScript/preflight, Cloudflare local workerd/D1, public GitHub read using local D1, Android adapter, Android debug APK/JVM. Record all failed CI runs and the exact final merge SHA in [PROGRESS](../PROGRESS.md), [EVIDENCE](../EVIDENCE.md), and [Issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8). These checks **do not** certify the later merged/docs-only `main` SHA without separately running it.

Actual remote acceptance remains **BLOCKED** until explicit owner approval, account/Free CPU/quotas/billing inspection, backup and remote migrations, Google OAuth on an installed device, and an independently verified physical phone-OFF test.
