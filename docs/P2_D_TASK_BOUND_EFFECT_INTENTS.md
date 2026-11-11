# P2-D | Immutable task-bound approvals and inert effect intents

**Scope:** backend-only, synthetic lead, typed operation and **no external provider dispatch**. This is a precursor to P2-E reconciliation, not permission to perform CRM writes or to activate Cloudflare Cron.

## Exact end-to-end contract

P2-C must first finish `SYNTHETIC_LEAD_TRIAGE_V1` with all three durable steps marked `SUCCEEDED`. A signed, already-registered OIDC user then creates exactly one approval/effect pair for this task using:

```http
POST /v1/task-approvals
Authorization: Bearer <verified OIDC ID token>
Content-Type: application/json
```

```json
{
  "clientIntentId": "e2c8a596-149c-4324-b690-6c41364b2417",
  "taskId": "524799a4-98d2-4508-8e12-2e54cd61e384",
  "provider": "SYNTHETIC_ONLY",
  "operation": "CREATE_CRM_LEAD",
  "target": "synthetic-crm",
  "payload": {
    "leadId": "f01af8bb-c925-45ce-9af6-e6b12c83fb04",
    "serviceCode": "SIGNAGE"
  }
}
```

All keys and values are strictly validated. The server, **not the client**, reads the completed task and stored typed lead, verifies owner equality, task status `SUCCEEDED`, `current_step=3`, three succeeded step rows, exact lead UUID/category, exact immutable lead SHA-256, and snapshots the final task version. A client cannot choose arbitrary provider, URL, external payload, PII, tool, free-form instructions or an HTTP destination.

The Worker calculates a canonical P2-D payload digest binding **task UUID, lead UUID, service, input digest, final task version, fixed provider/operation/target**. A separate target digest binds the fixed target to that exact task UUID. An atomic D1 `batch` creates the P2-A `synthetic_approval_intents` row and matching `synthetic_effect_intents` row. D1 unique constraints enforce **one effect per task, one effect per approval**, and P2-A retains the 5 pending/100 total owner quotas and 15-minute approval expiry. Identical clientIntentId replays return the original pair; changes to a task/payload under a reused key return a conflict. A new key cannot reserve a second effect for an already-reserved task.

The effect begins in `AWAITING_APPROVAL`, with `eligibleForDispatch:false` and `externalWrite:NOT_IMPLEMENTED`. It has **no provider credentials, HTTP request, or dispatcher**.

## Review, decision and read-back

The existing signed **`POST /v1/approval-intents/{approvalId}/decision`** API is reused, requiring `decision` (`APPROVE` or `DENY`), exact server-provided `payloadDigest` and `targetDigest`, and matching `expectedVersion`. This single owner-scoped, expiry-checked, PENDING-only D1 CAS changes the approval status. **SQLite BEFORE/AFTER triggers** require the matching immutable effect row and change its status atomically to `APPROVED_NO_DISPATCH` or `DENIED`. Neither state causes a provider write. Stale, denied, cross-owner, expired, forged digest/target, or reused decisions are rejected.

`GET /v1/task-effects` (latest 10, owner-only) and `GET /v1/task-effects/{effectId}` are **strictly read-only**, signed OIDC-only. There is NO POST dispatch, execute, retry, reconcile, send or CRM connector route. Legacy P2-A approvals created without a task remain isolated and cannot mint a P2-D effect.

Additional SQL `BEFORE UPDATE` triggers block changing immutable effect owner, task, approval identity, provider, target, payload digest, task digest/version, lead identity or creation timestamp, and block independent status transitions.

## Evidence requirements

The P2-D test set covers true RSA-signed synthetic OIDC owners, incomplete task, wrong owner/lead/service/provider, task-bound digest and version, duplicate keys, a second intent for the same task, approval/deny/replay/expiry, independent SQL updates, effects visibility, missing effect abort, and injected second-statement transaction failure with complete rollback. The Cloudflare **local workerd/D1** test must apply migration 0009 as a whole including `CREATE TRIGGER` blocks, execute the transition, and prove persisted effect status across a simulated restart. It is NOT a remote Cloudflare test.

Check **the exact final PR-head SHA**, followed by **the exact merged main SHA** and five GitHub Actions before marking P2-D complete. Node+SQLite tests alone cannot substitute for the actual local workerd D1 trigger tests.

## Failure boundaries and next milestone

- No real CRM, lead PII, Google live token, phone-OFF test, Webhook source, physical Android approval UI, Cron task dispatcher or network action.
- P2-E must introduce an explicitly allowed sandbox provider and persistent dispatch intent **separately**. Its design must address provider idempotency, late replies, crash-after-commit and `UNKNOWN_OUTCOME` with read-back reconciliation, never blindly re-send writes.
- P2-D is not a general-purpose autonomous agent: provider write approvals and real external actions are **not implemented**.

**`remote_acceptance:BLOCKED` · `safe_to_deploy:false` · `safe_to_activate_scheduler:false`**. No new cost or account write is authorized.

Related: [P2-A](P2_A_SYNTHETIC_APPROVAL_BACKEND.md), [P2-B](P2_B_SYNTHETIC_LEAD_INTAKE.md), [P2-C](P2_C_DURABLE_TASK_RUNTIME.md), [progress ledger](PROGRESS.md), [issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8).
