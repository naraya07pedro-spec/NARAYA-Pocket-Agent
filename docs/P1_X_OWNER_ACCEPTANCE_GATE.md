# P1-X | Owner-account acceptance decision gate

**Checked:** 2026-11-11 (Asia/Jakarta). **Base source checkpoint:** `main` `116203c60588b7fb63af36579a1ea6b111338496` after P1-W PR #29.

**Decision: REMOTE ACCEPTANCE BLOCKED.** This document is an execution gate, **not** a Cloudflare account inspection result, a deploy approval, an Android-device report, or a zero-cost certificate. Nothing in GitHub Actions has owner Cloudflare API credentials. No Cloudflare migration, Worker deploy, Cron activation or actual phone-OFF run was performed as part of this documentation.

## What the existing repository has already proved

- At the independently checked `main` SHA above, five push-triggered GitHub Actions jobs completed successfully: [Node source/TypeScript](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42862046029), [local workerd/D1](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42862045972), [public GitHub read with local D1](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42862046092), [Android native adapter](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42862045892), and [Android debug APK/JVM](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42862046102). Source log shows 143/143 Node tests, and local workerd/D1 11/11. None of this is a live Cloudflare or physical-device test.
- The original Android debug APK from [Actions artifact #13786085576](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42862046102/artifacts/13786085576) has SHA-256 `0cbc4c1a0252f0f71e019c289d293e2dc8198152861716f68ed6650781e86418`, matching the producing job's printed SHA. Build-time Google Web client ID and Cloudflare API origin are absent from the default CI APK; **real cloud sign-in is intentionally disabled**.
- P1-R/P1-T already provide separate offline-by-default, owner-operated inventory and billing read-only inspectors. **Reuse them** instead of creating another mock inspector. See [existing detailed runbook](REMOTE_PILOT_READINESS.md).

## Official public limits, independently rechecked 2026-11-11

| Cloudflare service | Documented Workers Free limits | Source and boundary |
|---|---|---|
| Worker requests | 100,000/day | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (last updated 2026-10-29). Not observed owner traffic. |
| CPU per Cron invocation | **10 ms CPU**, separately from elapsed network-wait time | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/). Actual scheduler CPU not measured. |
| Cron Triggers | 5/account | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/). Actual account triggers uninspected. |
| D1 resources | Up to 10 databases, 500 MB each, 5 GB/account | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) (last updated 2026-10-30). Actual owner inventory uninspected. |
| D1 billable rows | 5 million rows read/day and 100,000 written/day | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/). Counts measure rows, not query count. |
| D1 quota behavior | Upon reaching Free daily row limits, queries fail until midnight UTC | [D1 enforcement changelog](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/) (effective 2026-09-01). Fail closed; never silently upgrade. |

A **Free domain/zone plan is not proof of the Workers account's actual plan**, available quotas, subscriptions, current charges, or that future use costs exactly zero. All owner-specific and projected-cost values remain UNKNOWN until the owner independently reviews source dashboards and metadata.

## Immediate evidence path, no provider changes authorized

1. **Private Windows owner-side inventory, no account tokens in chat or CI.** From the repo root run `npm run cloudflare:inspect-offline` first (zero network), then follow the existing [P1-R read-only PowerShell procedure](REMOTE_PILOT_READINESS.md#p1-r-paginated-d1-owner-inventory-must-not-claim-absent-before-complete) with an account-scoped read-only token. Collect only coarse sanitized flags: `d1_inventory`, `target_d1_present`, `target_worker_present`, `target_cron_schedules`, `inventory_complete`. An incomplete read is UNKNOWN, never an absent-resource assertion.
2. **Separately scoped Billing Read token.** Run `npm run cloudflare:billing-offline` first, then the existing [P1-S/P1-T billing procedure](REMOTE_PILOT_READINESS.md#p1-s-owner-only-cloudflare-subscription-and-billing-history-risk-inspection-no-billing-writes). Check `paid_subscription_signal`, `billing_metadata_complete`, `historical_positive_amount_seen`; none is a future zero-cost certificate. Compare privately to the actual billing dashboard.
3. **Dashboard review, indispensable even after GET inspections:** Workers plan and request usage, CPU usage/outcomes, deployed Workers and triggers; D1 quota, databases and billable rows-read/written; estimated/current billing and alert/upgrade settings. Capture date of the inspection and pass/fail only in any public issue; **do not paste account IDs, API tokens, invoices, internal database exports, or raw response bodies**.
4. **GO/NO-GO decision:** If the account is not demonstrably within the chosen Free constraints, if plan/billing is unclear, or if a required paid resource is unavoidable, stop. If complete, request *separate explicit approval* for any cloud-side change. The account inspection does not authorize provisioning.
5. **Only after separate cloud approval:** back up an existing target D1 if applicable; prepare and verify remote migrations `0001`–`0005`; deploy an inert Worker with `SCHEDULER_ENABLED=false`, `MOBILE_SCHEDULING_ENABLED=false`, `triggers.crons=[]` and no paid inference. Verify Google OAuth Web audience, Android client/package/signing fingerprint and real Google-issued login on a physical Android against that approved backend. Keep any real tokens private.
6. **Separate authorization for Cron:** only after owner has verified plan/cost controls and the signed-user flow. Activate bounded Cron, measure actual CPU and D1 billed rows, and inspect real remote `scheduled_tick.observationIds` against matching remote D1 rows. Stop for budget/CPU overrun and never upgrade plans automatically.
7. **Physical OFF/ON acceptance:** schedule a controlled public GitHub monitor; physically power off Android; independently corroborate its powered-off window, the live Cron execution, persisted D1 observation UUID + SHA; power on and perform a fresh signed-user read to see the same observation. The existing manifest v2 only checks structural consistency: it **cannot certify external authenticity**.

## Gate register as of this document

| Gate | State | Required evidence before passing |
|---|---|---|
| Verified main and debug artifact provenance | **PASS (CI/build only)** | Exact SHA/runs/artifact listed above. |
| Real Cloudflare Workers account plan, billing, CPU and D1 billable usage | **BLOCKED** | Owner-side GET + current dashboard confirmation. |
| Actual remote D1 migrations and inert Worker | **NOT STARTED / UNAUTHORIZED** | Explicit owner approval for provider writes, migration status and endpoint response. |
| Genuine Google Android login to live Worker | **NOT VERIFIED** | Correct account/project and actual on-device server-verified JWT; never store token evidence publicly. |
| Cron execution under Free-tier measured CPU/usage | **NOT VERIFIED / UNAUTHORIZED** | Explicit activation approval, actual remote metrics and matching event log. |
| Physical phone-OFF autonomous observation | **NOT VERIFIED** | Device observation, real remote scheduled tick, exact D1 observation UUID and signed postboot read. |

**Next action (outside GitHub):** owner-operated private account inspection. **Owner may not delegate real physical phone shutdown/Google UI approval to a code-only GitHub connector.** The authoritative full instructions remain [REMOTE_PILOT_READINESS.md](REMOTE_PILOT_READINESS.md); this page is the current gate/checklist, not another independent readiness validator.

**No private account metadata, credentials or customer data is included in this public file.**
