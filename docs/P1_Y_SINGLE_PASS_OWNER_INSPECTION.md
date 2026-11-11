# P1-Y | One-pass owner Cloudflare inventory + billing gate (2026-11-11)

**Purpose:** consolidate the **existing** P1-R account inventory and P1-S/P1-T Billing Read inspectors into one *explicit owner-operated*, **GET-only** report. This is not a new remote inspector or a way for GitHub Actions to use account credentials.

## Zero-network verification first

From this repository root, with Node.js 22.16.x on a trusted Windows computer:

```powershell
npm run cloudflare:owner-offline
# Equivalent: powershell -NoProfile -File scripts/cloudflare-owner-acceptance.ps1
```

Default output has `inspection_mode=OFFLINE_DEFAULT_NO_NETWORK`. It does not read account credentials, query an API, deploy a Worker, or change D1. `remote_acceptance=BLOCKED` and all `safe_to_*` are false.

## Owner-authorized private read-only account inspection

1. Independently access the correct Cloudflare dashboard. Confirm the target account ID **privately**, not in chat or in GitHub. Create **two distinct account-scoped least-privilege API tokens**: one allowing only the inventory read endpoints, the other explicitly **Billing Read**. Review the [inventory runbook](REMOTE_PILOT_READINESS.md#p1-r-paginated-d1-owner-inventory-must-not-claim-absent-before-complete) and [Billing Read instructions](REMOTE_PILOT_READINESS.md#p1-s-owner-only-cloudflare-subscription-and-billing-history-risk-inspection-no-billing-writes) before creating them. Never provide Write, Edit, deployment or account-admin permissions.
2. On your **own private Windows machine**, using a trusted checkout of this repository, run:

```powershell
powershell -NoProfile -File scripts/cloudflare-owner-acceptance.ps1 -Live
```

3. Enter the account ID and the **two different READ-only tokens in the private prompts**. The wrapper temporarily passes secrets in the child Node process environment, then removes the environment variables in its cleanup path. Because same-user privileged processes may inspect a process environment, only run on a trusted local device; never via public CI/remote terminal, untrusted machine, PowerShell transcript, screen recording or screen share. Avoid storing tokens in your shell history.
4. Only sanitized, allowlisted metadata status fields are printed. **Zero output fields contain the Cloudflare account ID, tokens, database UUID, invoice details, provider error body or raw responses.** The report *can* be shared after a human verifies that it contains no unintended sensitive information. Prefer sharing only the `inventory.complete`, `billing.complete`, `paid_subscription_signal`, and `metadata_reads_complete` statuses if discussing next steps.
5. **Mandatory manual review** even if `metadata_reads_complete=true`: account plan, current and estimated charges, subscription flags, Worker CPU and request usage, D1 daily billable rows and quotas, and any deployed Cron schedules **in the actual provider dashboard**. GET success is not a Free-plan or zero-cost certification.

The Node entrypoint is `npm run cloudflare:owner-live`, but that expects four private environment variables: `CF_READONLY_ACCOUNT_ID`, `CF_BILLING_ACCOUNT_ID` (must be identical), `CF_READONLY_API_TOKEN` and `CF_BILLING_READ_TOKEN` (must be distinct). **Use the PowerShell wrapper** to avoid hand-typing secrets into command history.

## Report semantics and stop conditions

- `metadata_reads_complete=true` means **only** that the two independently scoped inspectors finished their supported GET metadata reads. It does **not** prove account plan, CPU, actual rows billed, future bill, deployed code authenticity, signed Google login, or device power-OFF.
- A `POTENTIAL_PAID_SUBSCRIPTION_PRESENT` warning always requires manual billing review. A successful scan with no paid signal still does **not** prove future charges will be zero. Positive historical invoice observations are *historical*, not current debt.
- Incomplete API pages, invalid token, wrong permission, bad network, unavailable provider or conflicting account IDs never become `safe_to_deploy=true`; errors are sanitized without raw provider details.
- There is **no** account or application token in the Git repository or APK. Do not save raw inspection responses in CI/artifacts.

## Evidence gate after this milestone

Separate, explicit owner decisions remain mandatory for any Cloudflare D1 backup/migrations 0001-0005, inert Worker deployment (both scheduling flags OFF and zero triggers), Google project/auth setup, Cron activation and physically OFF Android observation. Actual results must be tied to event SHA/UUID and observed Workers/D1 CPU/usage counters. Refer to [P1-X gate register](P1_X_OWNER_ACCEPTANCE_GATE.md), [full runbook](REMOTE_PILOT_READINESS.md) and [Issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8).

## Evidence classification

`IMPLEMENTED` when source is committed; `SYNTHETIC_TESTED` when six new injection/adversarial Node tests pass; `CI_VERIFIED` only for the exact PR/main SHA with finished GitHub Actions runs; **owner account inspection remains `NOT_VERIFIED` unless live owner-side evidence is independently checked**. No deployment permission is implied by this document.
