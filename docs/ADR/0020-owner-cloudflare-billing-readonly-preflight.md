# ADR-0020: Separate owner-only Billing Read preflight for Cloudflare cost risk

Date: 10 November 2026
Status: Accepted for P1-S source-only milestone; production/account validation remains BLOCKED.

## Problem and sources

P1-R provides owner-initiated **D1/Worker/Cron inventory** with narrowly scoped metadata reads, but not evidence for actual Cloudflare account subscription/billing. A source-level green CI is unrelated to costs. The Pocket Agent must not add resource charges without explicit owner approval.

Cloudflare publishes:
- [List account subscriptions, GET `/accounts/{account_id}/subscriptions`](https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/methods/get/); requires **Billing Read** or Billing Write. TypeScript docs classify subscription list as `SinglePage`, subject to future provider changes.
- [Get billing history, GET `/accounts/{account_id}/billing/history`](https://developers.cloudflare.com/api/resources/billing/subresources/history/methods/list/); requires **Billing Read** or Billing Write, supports `page` and `per_page`, reports `result_info.total_count`.
- [D1 metrics](https://developers.cloudflare.com/d1/observability/metrics-analytics/) distinguish **queries** from billable rows read/written and note that metrics can miss calls failing before SQL. This milestone does not query analytics, current CPU, invoices or spending.

## Selected implementation

Add `scripts/cloudflare-billing-readonly.mjs`, entirely offline by default. Explicit `--inspect-live` uses only `CF_BILLING_ACCOUNT_ID` and **a separate least-privilege Billing Read token** `CF_BILLING_READ_TOKEN`, never the D1 inventory token. Token and account ID must be supplied **locally**, not to GitHub, ChatGPT, CI, logs or repository. It makes only bounded GET requests to the fixed Cloudflare HTTPS origin with redirects disabled:
1. `/accounts/<account-id>/subscriptions`, one officially SinglePage list, with conservative metadata consistency checks.
2. `/accounts/<account-id>/billing/history?page=N&per_page=20`, pages 1–5 maximum, count/total/page metadata validated. If records remain unseen, status is `PARTIAL_PAGES`, never a complete history assertion.

Bound every API response to 131,072 bytes **during stream reading**, strict UTF-8, per-request 7-second timeout (30 seconds maximum configurable in source only), and output no subscription IDs, invoices, currencies, amounts, account IDs, tokens, URL redirects or provider error strings. Report only a generic potential positive-price/Paid-subscription signal, positive historic-amount observation, number of scanned history rows and completeness.

The output retains `account_plan:'NOT_VERIFIED'`, `account_billing:'NOT_VERIFIED'`, `free_tier_daily_usage:'NOT_VERIFIED'`, `current_free_tier_proven:false`, `future_zero_extra_cost_proven:false`, `safe_to_deploy:false`, `safe_to_activate_scheduler:false` and `remote_acceptance:'BLOCKED'`, **including when both GETs succeed**. A historical invoice is not a current charge, a zero-price subscription is not proof of no usage-based charge, and no subscriptions returned is not a Free-plan guarantee. Subscriptions and billing history are sensitive account information; review only on a trusted private owner machine.

## Alternatives rejected

- Query accounts via a global API key or token with Billing Write: excessive privileges.
- Parse full invoice details into the GitHub issue, chat or CI artifact: discloses sensitive data without helping deployment safety.
- Assume no subscription or no recent paid item proves future Rp0 expense: false; usage-based billing, plan settings, D1 row usage and Workers CPU remain separate.
- Call GraphQL account analytics automatically: requires Account Analytics Read and a read-only GraphQL **POST**, violating the existing GET-only safety envelope. Owner can inspect dashboard metrics separately.
- Automatically create D1/Worker/Cron in order to validate costs: a side effect requiring explicit authorization.

## Verification and limitations

The CLI has deterministic mocked-fetch adversarial tests covering auth boundary, fixed GET-only paths, 403, redaction, paginated history, contradictory metadata, bounded stream, redirects, nonzero historical charges, empty/no-charge not free-tier proof, and invalid credentials. All CI source tests run without Cloudflare credentials and without network to a Cloudflare account.

An actual local `--inspect-live` result still requires a token minted by the owner with least-privilege **Billing Read** scope. API permissions or schema can differ at runtime. Operator must additionally check account billing overview, current/estimated charges, Workers Free plan, CPU and D1 rows read/written from the official dashboard. No owner account has been accessed. There is **no release approval** until a separately authorized pilot passes independent cloud, auth, cost and physically OFF Android acceptance.

See [P1-S progress](../PROGRESS.md), [evidence register](../EVIDENCE.md) and [owner runbook](../REMOTE_PILOT_READINESS.md).
