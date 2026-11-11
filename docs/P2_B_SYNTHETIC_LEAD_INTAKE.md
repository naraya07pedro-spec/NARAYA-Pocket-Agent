# P2-B | Typed synthetic lead intake + deterministic triage + approval binding

P2-B is a **backend-only, synthetic-data** business vertical. No real customer names, phone numbers, emails, arbitrary text, URLs, external CRM/WhatsApp/AI calls, outbound messaging, production signup flow or Android review UI. No remote Cloudflare deployment was attempted.

## Source interface

An **existing registered** user with a **cryptographically verified OIDC bearer token** can call:

- `POST /v1/synthetic-leads` with **exactly** `clientLeadId` (valid UUID), `source='SYNTHETIC_FORM'`, `serviceCode` (`EXHIBITION`, `INTERIOR`, `SIGNAGE`), `budgetBand` (`UNKNOWN`, `LOW`, `MID`, `HIGH`), and integer `daysToDeadline` (1–365).
- `GET /v1/synthetic-leads` for up to 10 newest rows belonging to the **same authenticated user**.

The body rejects additional PII, arbitrary descriptions, prompt instructions, provider URLs and real webhook fields. It is intentionally a synthetic test fixture API, **not a public intake form for real customers**.

Example:

```json
{
  "clientLeadId": "5fd611ae-7b21-4bb5-b2e4-d9f2be6139fc",
  "source": "SYNTHETIC_FORM",
  "serviceCode": "EXHIBITION",
  "budgetBand": "MID",
  "daysToDeadline": 12
}
```

`synthetic_leads` in additive D1 migration **0007** is restricted with CHECK constraints and `UNIQUE(owner_id, client_lead_id)`. The server creates an input SHA-256 digest for the precise typed payload. Replays with identical input do not duplicate; changing any field under the same client ID returns **409**. A conservative **100-row total owner limit** applies until safe retention and real cost are measured.

### Deterministic classification rules

Priority labels are routing rules, **not conversion probability predictions**:
- `daysToDeadline <= 14` → `TIME_SENSITIVE`;
- otherwise `budgetBand='UNKNOWN'` → `NEEDS_BUDGET`;
- otherwise `STANDARD_REVIEW`.

Draft response is a short fixed Indonesian template by `serviceCode`, **never sent**. No model inference, prompt handling, client message text, or AI expense.

### Binding to P2-A approval

`POST /v1/approval-intents` for the **synthetic-only** CRM creation operation must now first resolve an existing synthetic intake row by **the same signed user's owner ID**, exact `clientLeadId`, and matching service code. Otherwise returns a generic 409, with zero approval insertion. A foreign user's lead ID, a nonexistent ID, or mismatched category cannot obtain an approval. Even successful approval remains `APPROVED_NO_DISPATCH`; there is no provider connector or side effect.

### Remaining work

P2 is **not complete**: real form/webhook authentication with replay protection, safe handling of actual PII, reviewer UI on Android, task/step state machine, approval linked to precise immutable provider payload and dispatch intent, outbound effect verification and ambiguous-outcome reconciliation are still missing. P3's real provider, read-back, LLM and quotas are not implemented. P0's Cloudflare/real phone-OFF proof remains blocked by account/device evidence.

The new migration and tests run in SQLite and actual local workerd D1. These are **not actual Cloudflare account data**. See [P2-A](P2_A_SYNTHETIC_APPROVAL_BACKEND.md) and [Issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8).
