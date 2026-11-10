# ADR-0021: Monotonic financial evidence and cautious subscription risk detection

Date: 10 November 2026
Status: P1-T source-level decision; real Cloudflare account remains unverified.

## Problem: source-level false-negative risks after P1-S

P1-S added an owner-only Cloudflare Billing Read inspector. Two safety weaknesses were found in its source and API contract review:

1. Subscription risk classification used **only** numeric top-level `price > 0` or `state === 'Paid'`. The official Cloudflare API makes `price` optional and separately returns a `rate_plan.id` and states including `Provisioned` and `AwaitingPayment`. A record such as `{state:'Provisioned',rate_plan:{id:'pro'}}` was **not flagged as a potentially paid subscription** despite a non-free plan ID. This is a potential false-negative **in code**, not a verified live Cloudflare account incident. [Official subscription API](https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/methods/get/).
2. History scan observed a **positive** `amount` or `amount_to_pay` on a validated earlier page but reset the signal to `UNKNOWN` and scanned count to zero if a **later page** returned 403, malformed `result_info.total_count`, invalid amount, or other error. That discarded valid earlier evidence. [Official billing history API](https://developers.cloudflare.com/api/resources/billing/subresources/history/methods/list/).

Both are operationally relevant to the owner's explicit **no unapproved cloud costs** constraint. They do **not** demonstrate actual billing, actual paid subscription, or Free-tier eligibility.

## Decision

- Mark a subscription **POTENTIAL_PAID_SUBSCRIPTION_PRESENT** if any record has a documented non-free `rate_plan.id`, `state: Paid` or `AwaitingPayment`, positive finite top-level price, or `rate_plan.externally_managed===true` / `rate_plan.is_contract===true`. The latter are conservatively treated as a potential financial obligation, **not** proof of an actual charge.
- Known no-positive signals are narrow and always suffix `NOT_FREE_PROOF`. An incomplete/ambiguous record (e.g. Provisioned with no price/rate plan or cancelled/failed record) becomes `SUBSCRIPTION_FINANCIAL_STATUS_UNKNOWN`, not a reassuring no-paid signal.
- Invalid price, malformed rate-plan IDs or state types fail closed with `INVALID_RESPONSE`; do not coerce numeric strings or malformed data into $0.
- Billing history **positive signals are monotonic** for a single scan. After a successful validated page reporting a positive finite amount/amount-to-pay, later failures preserve `YES_HISTORICAL_ONLY` and count only prior validated records, while `billing_history` accurately changes to `UNAVAILABLE`, `INVALID_RESPONSE`, or `PARTIAL_PAGES`. No amounts, identifiers, currencies or raw API errors are emitted.
- Validate amount and amount_to_pay fields as finite numbers when present. Omitted optional amounts remain inconclusive, not zero-cost proof.
- Permanent invariant stays: `remote_acceptance:'BLOCKED'`, `safe_to_deploy:false`, `safe_to_activate_scheduler:false`, `current_free_tier_proven:false`, `future_zero_extra_cost_proven:false`, `account_plan:'NOT_VERIFIED'`, `account_billing:'NOT_VERIFIED'`.
- P1-T does not alter Cloudflare Worker code, D1 SQL, Android auth or deployment configuration. It remains **offline default**, explicit GET-only owner inspection with private env token. No account was contacted in development/CI.

## Scope and tests

Ten additional adversarial mock tests cover missing price with non-free rate-plan IDs, AwaitingPayment, external/contract flags, unknown/ambiguous states, invalid amount types, verified page-one positive signals followed by 403 or contradictory metadata, and incomplete history. Existing P1-S tests continue to enforce no leaks, bounded read, strict endpoint and no Free-tier claims.

**Evidence limitations:** tests use synthetic mocked HTTP responses. We have not read a real Cloudflare subscription, billing item, Workers CPU or D1 usage metric. `POTENTIAL_PAID_SUBSCRIPTION_PRESENT` is a screening warning, not a billing assertion. Nor can a historic positive amount prove current charges. The real owner's Cloudflare Dashboard remains required to verify **account-specific billing, current plan, Workers CPU usage and D1 billable rows** before separate explicit approval for any backup, migration 0001–0005, deployment, or Cron activation.

## Alternatives rejected

- Treat price omitted as price zero: directly contradicted by optional schema, hides non-free plans.
- Treat `Provisioned` as proof of free: no source-backed basis.
- Reset known positive evidence to unknown on a later request failure: loses a known fact.
- Infer charge liability from the history's `amount` alone: history may contain past, refunded or settled events.
- Fetch invoices or mutate billing settings for stronger proof: too much access for a zero-cost, GET-only preflight.

See [P1-T progress](../PROGRESS.md), [evidence register](../EVIDENCE.md), and [private owner runbook](../REMOTE_PILOT_READINESS.md).
