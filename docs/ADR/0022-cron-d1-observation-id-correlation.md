# ADR-0022: Exact Cron-to-D1 observation correlation for phone-OFF evidence

Date: 10 November 2026
Status: Accepted for P1-U source/local tests. Real Cloudflare + physical phone-OFF acceptance is **NOT VERIFIED**.

## The actual evidence integrity gap

Earlier `scheduled_tick` logs emitted only aggregate `claimed/completed/observations` counts. The P1-N owner-supplied offline evidence gate used a 60-second timestamp alignment between `scheduled_tick` and D1 `observations` as a **heuristic**. Another unrelated successful Cron could happen in the same minute, so matching clocks did not establish which specific D1 row the Cron actually wrote. This is a **code-level ambiguity**, not evidence of a live Cloudflare incident.

The project's core acceptance requires independently checking that Cron persisted a GitHub change while the Android phone was physically powered OFF. Improving the link between the Cron log and the D1 record improves the quality of *collectable evidence*. It does **not** authenticate owner-supplied manifests or the physical phone power state.

Official provider contracts:
- Cloudflare [D1 `batch()` is transactional and rolls back if a statement fails](https://developers.cloudflare.com/d1/worker-api/d1-database/).
- Cloudflare [Workers Logs include custom `console.log` records and Cron invocations](https://developers.cloudflare.com/workers/observability/logs/workers-logs/); actual account/plan logging behavior still needs verification.
- Cloudflare [Cron Events / trigger history](https://developers.cloudflare.com/workers/configuration/cron-triggers/) offers an independent invocation source, not automatically a matching D1 transaction.

## Chosen P1-U design (no schema migration)

1. `saveSuccess()` creates a single random `observationId` before calling the **existing three-statement D1 `batch()`**. The same ID is inserted into the existing `observations.id` field. After D1 confirms both the monitor's fenced UPDATE and the observation INSERT, it returns that ID. A no-change, stale lease, error, or failed claim must NOT produce an invented persisted-ID signal.
2. The `scheduled()` handler collects at most **three** IDs for its invocation through a locally scoped evidence collector. It prints one structured `scheduled_tick` log with an `observationIds` array and aggregate counts. It does **not** print owner ID, monitor ID, GitHub SHA, lease token, Google ID token, account ID, or provider credential.
3. **No D1 migration 0006** is needed: `observations.id` already exists and is returned in signed-user read-only observation responses. No new database, table, index, provider request, scheduled trigger, cloud permission or cost-bearing service is introduced in P1-U.
4. Explicitly version the **owner-supplied PRIVATE evidence manifest to v2**: `schemaVersion:2`, new required per-tick `observationIds` array, strict UUID and count consistency. Reject old v1 packages as v2, misleading timestamp-only matches, repeated/malformed IDs and unrelated Cron IDs. Preserve the existing 60-second plausibility, event-sequence SHA-chain, device-off interval, signed post-boot read, release preflight and GitHub SHA checks.
5. The offline gate remains forever `remote_acceptance:NOT_VERIFIED`, `independent_origin_verification:NOT_PERFORMED`, `physical_device_verification:NOT_PERFORMED` and `safe_to_activate_scheduler:false`, even for a valid v2 bundle. The IDs themselves are **not cryptographic attestation**; owner-supplied JSON could be fabricated, Cloudflare logs could be missing, and time synchronization could be imperfect.

## Testing and rollback considerations

- Deterministic Node tests verify exactly one captured ID equals the durable D1 row ID for baseline/change, while repeated unchanged HEAD checks capture **no** phantom row.
- Real **local Cloudflare workerd/D1** contract test invokes the exported `worker.scheduled()`, reads the signed monitor's actual observation row and confirms its `id` equals the emitted `observationIds[0]`.
- Offline red-team evidence fixtures check the v2 schema, exact ID matching (not just time), invalid/missing/duplicate IDs, and permanent refusal to call a synthetic bundle `LIVE_VERIFIED`. Documentation sample is **SYNTHETIC**, not a provider export.
- Schema-change surface is **only the offline evidence JSON package and Cron log record**, not D1 or Android API. The previous v1 offline sample intentionally no longer passes the v2 gate; archived v1 reports never established remote acceptance.
- If real account Workers Logs is not available/retained in the chosen plan, do **not** add a paid Tail Worker or services automatically. Stop, inspect account-specific conditions and seek separate owner approval.

## Remaining owner-reviewed acceptance gate

Only after independently confirmed Cloudflare billing/Workers Free CPU/D1 usage, actual owner-issued OAuth device token, backups/migrations 0001–0005, separately authorized inert deploy and separately authorized Cron activation: compare **the identical real observation ID** from Cloudflare `scheduled_tick.observationIds` to the actual remote D1 `observations.id`, with independently observed device power-off timestamps, verified GitHub SHA and signed mobile retrieval after boot. The exact ID match reduces correlation ambiguity but does not eliminate source spoofing or failed logging.

See [PROGRESS](../PROGRESS.md), [EVIDENCE](../EVIDENCE.md), [pilot runbook](../REMOTE_PILOT_READINESS.md), and [Issue #2](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/2).
