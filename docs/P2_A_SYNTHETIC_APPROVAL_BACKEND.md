# P2-A | Signed user synthetic CRM approval intents (backend foundation)

**Status:** source implementation and local tests only until exact CI evidence is linked. This is **NOT** a production-ready approvals service, a live CRM connector, a finished task state machine, or remote phone-off proof.

## What can be exercised in the backend

New **additive D1 migration 0006** introduces one owner-scoped table, `synthetic_approval_intents`, with strict types, a per-user client intent UUID uniqueness constraint, 5 concurrent PENDING requests, and at most 100 retained intent rows per owner in this pilot.

The signed Google/other configured OIDC identity is verified **server-side** exactly as for mobile sync. Only users with an existing `user_identities` record can create/read/decide an intent. Unknown users are NOT silently onboarded. This is not the operator API token, and no OAuth claim from Android alone is trusted.

The intentionally narrow operation is **`provider=SYNTHETIC_ONLY`, `operation=CREATE_CRM_LEAD`, `target=synthetic-crm`**. There is **no external connector**, HTTP provider request, background dispatcher, email sending, or real CRM write, even when the approval becomes `APPROVED_NO_DISPATCH`.

### Authenticated request contract

**P2-B dependency:** Before the approval POST, the signed-in user must first create a synthetic lead through `POST /v1/synthetic-leads` using exactly the same `clientLeadId` as `payload.leadId` and the same `serviceCode`. A lead ID not owned by the user, nonexistent in D1, or mismatching category returns **409** and creates no approval. See [P2-B typed intake](P2_B_SYNTHETIC_LEAD_INTAKE.md). This is a positive owner binding, but still **no real CRM effect**.

`POST /v1/approval-intents`, using the existing *signed* OIDC bearer in Authorization:

```json
{
  "clientIntentId": "3af6d5a8-6f12-4a0c-972c-83502721b33a",
  "provider": "SYNTHETIC_ONLY",
  "operation": "CREATE_CRM_LEAD",
  "target": "synthetic-crm",
  "payload": {
    "leadId": "c9421109-45a8-4e63-a1bd-b93728097e6b",
    "serviceCode": "EXHIBITION"
  }
}
```

Only `EXHIBITION`, `INTERIOR` or `SIGNAGE` service codes and two client-generated UUIDs are accepted. **No name, email, phone, free-form prompt, URL, client data, credentials or webhook payload** is admitted. The Worker hashes the canonical payload and fixed provider-operation-target itself, then records SHA-256 digests. It never trusts a client-provided digest during creation. Intent expires **15 minutes** after initial creation. The clientIntentId is an idempotency key: replay of identical creation returns the original row, even after a decision; a changed payload returns 409.

`GET /v1/approval-intents` returns at most 10 recent owner-only previews with status, version, digest and expiry. If pending and expired, UI-visible status is derived as `EXPIRED` without changing the D1 row. The preview is not secret.

`POST /v1/approval-intents/{id}/decision` accepts exactly:

```json
{
  "decision": "APPROVE",
  "expectedVersion": 1,
  "payloadDigest": "<64-lowercase-hex-from-GET-or-POST>",
  "targetDigest": "<64-lowercase-hex-from-GET-or-POST>"
}
```

`DENY` is also accepted. One D1 atomic SQL compare-and-swap checks **identity owner, UUID, version, PENDING state, future expiry, exact payload digest and exact target digest**. A failed CAS returns 409; no side effects are attempted. Approve returns **`APPROVED_NO_DISPATCH`**, not an assertion that a CRM row exists. Reusing an approval or changing the target/digest/version cannot authorize a second decision.

### Security and operational boundaries

- Both the global Cron gate and existing GitHub monitor scheduler remain unmodified; there is no code that consumes `APPROVED_NO_DISPATCH` into any external provider.
- A previously registered user can reach the API only with a correctly signed ID token accepted by the strict OIDC verifier. The existing user registration flow is unchanged.
- D1 is the state authority; memory is not. No arbitrary provider origins, no user-controlled URLs, no personal lead data or OAuth secrets saved.
- **No real external effect** means this does NOT satisfy the P2 final acceptance gate or P3 read-back verification.
- The Android UI does **not yet expose** these endpoints; P2-B will need task/admin review UX, and later P2 milestones need durable task transitions, effect intent reconciliation, and provider sandbox approval, still separately gated.
- Pilot hard limit 100 persisted intents per user is deliberately conservative; production retention/purge/export policy remains to be designed before real client data.

This milestone is one narrow backend capability, not permission to deploy. **`remote_acceptance=BLOCKED`**, **`safe_to_deploy=false`**, and **`safe_to_activate_scheduler=false`** continue. Verify CI for both exact PR HEAD and merged `main`; local synthetic tests are not Cloudflare account evidence.

Cross-references: [P1-X provider gate](P1_X_OWNER_ACCEPTANCE_GATE.md), [remote readiness](REMOTE_PILOT_READINESS.md), [master issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8).
