# P2-E | Synthetic provider effect idempotency + UNKNOWN_OUTCOME reconciliation

**Status:** code/test candidate; treat the milestone as IN PROGRESS until the exact final PR head and post-merge main pass all CI. This is a D1-only simulated provider, **not a real CRM or a production-grade external write**.

## Why this milestone exists

P2-C created persistent tasks and steps. P2-D bound a completed task and immutable payload/target to a human decision and inert `synthetic_effect_intents`. But neither answered the most dangerous question: *what if a provider creates an object and the network/client process dies before our Worker receives confirmation?* Blind retry can duplicate customers, emails, bills or transactions.

P2-E builds and tests this failure path with **one synthetic provider record in D1**, never external credentials, HTTP, webhooks, email, AI calls or Cron. It is a **control-plane rehearsal**, not real distributed-provider acceptance.

## Durable schema

Migration **0010_sandbox_reconciliation.sql** adds:

- `sandbox_dispatches`: exactly one record per owner + approved effect, frozen task/approval/payload/target/idempotency key, state, version, one-attempt maximum, lease UUID, lease expiry, bounded read-back counter and timestamp.
- `sandbox_provider_records`: synthetic provider's committed receipt, **one per effect and idempotency key**, bound to owner, task and immutable payload/target hashes. This is a database table, **not an external CRM**. It cannot be updated or deleted.
- SQLite triggers prevent preparing a dispatch without a matching approved P2-D effect and finished task; changing frozen dispatch data; fabricating a provider receipt without an active claim; invalid state transitions; or claiming `CONFIRMED_APPLIED` without matching provider read-back.

**States:** `PREPARED → IN_FLIGHT → CONFIRMED_APPLIED` after an exact read-back, or `IN_FLIGHT → UNKNOWN_OUTCOME` on timeout, crash or ambiguous write. `UNKNOWN_OUTCOME → CONFIRMED_APPLIED` is allowed only by a positive matching receipt; conflicting read-back is `QUARANTINED`. **No transition from UNKNOWN_OUTCOME back to PREPARED or IN_FLIGHT.** A missing receipt is recorded `NOT_FOUND_UNCERTAIN`, **never** an indication that a retry is safe.

## Signed user API

Existing already-registered user, cryptographically verified OIDC bearer required for all endpoints. `{effectId}` must be the UUID of an approved P2-D `synthetic_effect_intents` row owned by that user:

- `GET /v1/sandbox-dispatches/{effectId}`: owner-only status and evidence, no credentials/lease token/PII.
- `POST /v1/sandbox-dispatches/{effectId}/attempt` with exactly `{}`: **manual, one-and-only-one synthetic provider attempt**. It atomically claims the request for at most 45 seconds, creates at most one synthetic D1 receipt, reads back exact owner/task/target/payload/idempotency key, and confirms the result only after positive evidence. A replay returns the persisted status; never sends again.
- `POST /v1/sandbox-dispatches/{effectId}/reconcile` with exactly `{}`: **read-only regarding provider records**, maximum 10 D1 read-back attempts per dispatch. A positive exact receipt confirms; a mismatched receipt quarantines; no receipt remains UNKNOWN even after lease expiry. Does not create or re-drive a write.

The HTTP API **does not** accept simulated timeout flags. Test-only internal functions inject `BEFORE_PROVIDER_COMMIT_TIMEOUT` and `AFTER_PROVIDER_COMMIT_TIMEOUT` to model the two failure windows without exposing a fault injection API to Android users.

### Safety evidence intended

The test suite requires:
1. True RSA-signed test OIDC and owner isolation, strict empty request bodies, approved-task-only eligibility; replay and simultaneous calls can generate only one simulated provider receipt.
2. Timeout **after** the provider record is committed: response initially UNKNOWN; fresh read-back confirms the **existing** receipt, no second attempt.
3. Timeout **before** commit: read-back remains UNKNOWN and `safeToRetry=false` despite record absence; ten bounded checks, then HTTP 429.
4. Crash in IN_FLIGHT after a lease expires: reconcile, never re-run the effect.
5. Direct SQL receipt tampering or premature provider insert is denied by triggers.
6. Real *local* workerd/D1 migration plus provider-write → process restart → reconciliation, with one persisted receipt.

None of these tests verify a real third-party API's idempotency guarantee, consistency window, read-back contract or ability to reconcile a write that returns a timeout. **Real provider integration must start later behind verified provider-specific capabilities, owner authorization and quota controls**. For a provider lacking read-back or idempotency, do not interpret negative lookup as proof of absence.

## Explicit exclusions, pending next work

No general agent DAGs, real webhook/PII, external provider credential, real CRM dispatch, real Google ID token, Android review/cancel interface, background task scheduler, remote Cloudflare owner billing/deployment/remote D1, physical powered-OFF phone acceptance or live AI inference.

**Remote pilot: BLOCKED** · `safe_to_deploy=false` · `safe_to_activate_scheduler=false`.

See [P2-D immutable effect contract](P2_D_TASK_BOUND_EFFECT_INTENTS.md), [P2-C runtime](P2_C_DURABLE_TASK_RUNTIME.md), [progress ledger](PROGRESS.md) and [blocking issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8).
