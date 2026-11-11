# P2-C | Durable synthetic task runtime, D1 leases and safe control plane

**Status: implementation candidate.** Exact final PR-head and post-merge `main` CI evidence must be checked before calling this milestone complete. This is an intentionally inert step engine for typed synthetic leads, **not** a general provider-write agent or real Cloudflare deployment.

## Why this milestone matters

P1 implemented a GitHub monitoring scheduler. P2-A/B added OIDC-scoped dummy lead intake, classification and non-dispatch approvals, but lacked a durable task+step execution runtime. P2-C adds a three-step durable **control plane** with explicit safe state transitions and does not add external side effects.

### Storage and invariants

Additive migration **0008_durable_task_runtime.sql** introduces:

- `task_runs`: per-owner and per-client-task idempotency, immutable `kind=SYNTHETIC_LEAD_TRIAGE_V1`, owner-scoped existing `client_lead_id` and its original input digest, `status` (**QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED**), `current_step` (0 to 3), optimistic version and timestamps.
- `task_steps`: exactly three immutable ordered step codes **VERIFY_LEAD, VERIFY_TRIAGE, VERIFY_DRAFT**, one persistent row each; states **WAITING, READY, RUNNING, SUCCEEDED, FAILED, CANCELLED**; bounded attempt count, execution lease UUID and expiration, backoff, bounded result code and timestamps.
- `task_step_budgets`: one row per owner with a fixed UTC hourly window and atomic reservation cap **12 step claims per owner/hour**, including overlapping invocations. Backward clock movement cannot reset a newer window; failed/ambiguous refunds favor underuse over exceeding the budget.

A single D1 `batch()` transaction creates a task plus three steps. Task creation is limited to **three concurrent unfinished tasks** and **50 total persisted tasks per user**. A replay with the same `clientTaskId` yields the original task; if the lead ID or immutable lead input digest differs, returns **409**, not a duplicate run.

### Authenticated endpoints (no operator bearer in Android)

All routes require a cryptographically verified ID token from the established OIDC verifier **and an existing registered `user_identities` row**. They cannot silently register a new user.

- `POST /v1/tasks`: exactly `clientTaskId` UUID, `kind=SYNTHETIC_LEAD_TRIAGE_V1`, and `leadId` UUID referencing an already stored synthetic lead owned by the same signed-in user.
- `GET /v1/tasks`: at most the 10 most recently created owner tasks, no secrets or lease token.
- `GET /v1/tasks/{taskUuid}`: owner-scoped task detail and the fixed ordered three steps.
- `POST /v1/tasks/{taskUuid}/advance`: exactly `{"expectedVersion":N}`. **One user-initiated step per HTTP request**. Requires quota and an atomic lease claim linked to the current task version, then runs ONLY built-in deterministic D1 checks. It atomically completes the step, updates task version/index and activates the next step, or marks a bounded retry with backoff. Three failures produce terminal **FAILED**. A process-death lease may be claimed again after **45 seconds**, but previous invocation's stale lease token cannot finalize it. No automatic background task execution is configured.
- `POST /v1/tasks/{taskUuid}/cancel`: exactly `{"expectedVersion":N}`. One atomic D1 transaction updates the owner-scoped task and invalidates any outstanding lease plus nonterminal steps. Stale completion and duplicate cancel both fail.

**One-step verification results only:** `LEAD_VERIFIED`, `TRIAGE_VERIFIED`, or `DRAFT_VERIFIED_NO_SEND`. Results never contain actual lead PII or generated external messages. The draft text remains in its owner-scoped `synthetic_leads` record, never sent. Step executor does **not** call `fetch`, CRM, Gmail, WhatsApp, GitHub, LLMs, arbitrary tools, or Cloudflare admin APIs.

Example create:

```json
{
  "clientTaskId": "527ea93e-130c-4452-b6c3-d9e3d96d7928",
  "kind": "SYNTHETIC_LEAD_TRIAGE_V1",
  "leadId": "5956c6f0-0407-4c0c-8e06-ace19a0800cc"
}
```

A valid lead must have been inserted first using the signed synthetic P2-B intake endpoint. The task controls are not exposed in the Android UI yet.

### Verification strategy

- Signed OIDC tests cover registered users, cross-tenant access, strict request schema, fixed ordered plan, idempotent replay and no unsigned operator bypass.
- Concurrency/adversarial tests cover cancellation while a step is executing, stale lease completion, reclaim after 45 seconds, backoff to terminal failure, hourly claim limits and clock rollback.
- Real local Cloudflare workerd D1 tests apply migration 0008 and demonstrate step-state continuity across persistence/restart.
- Preflight checks remain **remote BLOCKED**, and protect the no-provider/no-Cron boundary.

### Deliberate unresolved items

1. **No real provider-effect state machine.** This runtime does not consume P2-A `APPROVED_NO_DISPATCH` rows or authorize a real CRM creation. That will need immutable effect intent, provider idempotency, crash-before/after-send modeling, read-back reconciliation, unknown outcome handling, and a separate owner-approved provider sandbox.
2. A full general-purpose task language, arbitrary step DAG and scheduling are not implemented. `SYNTHETIC_LEAD_TRIAGE_V1` is a *fixed three-step control-plane pilot* with reusable D1 task/step primitives, not a claim of supporting arbitrary agent tasks.
3. No server-originated retries or wakeups. Retry/backoff is enforced on **explicit user-triggered** advances, not an automatic background dispatcher.
4. The API and D1 runtime are local-test only until authenticated owner Cloudflare billing/plan, D1 remote migration, Google OAuth configuration, scheduled cost guard, real Android app and physical powered-OFF execution have independent evidence.
5. No real lead/customer PII is accepted; privacy policy, retention deletion, analytics, data deletion and actual commercial integrations are unimplemented.

**Remote status remains `BLOCKED`**, `safe_to_deploy=false`, `safe_to_activate_scheduler=false`. No provider keys, paid services, cloud account writes, real customer data or phone-off effects were used.

Related: [P2-A approvals](P2_A_SYNTHETIC_APPROVAL_BACKEND.md), [P2-B intake](P2_B_SYNTHETIC_LEAD_INTAKE.md), [global progress](PROGRESS.md), [blocking issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8).
