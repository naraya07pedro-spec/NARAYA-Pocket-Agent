# ADR-0015 | Offline off-device acceptance evidence is not independent attestation

Date: 10 November 2026
Status: MERGED via PR #20 as `f53627b4eb07d4f0edde76c8b2770c6bc8bd400e`. Exact final PR-head SHA `70f2f40a94b17fc0be4623bc4b4c12b2912931c1` passed 5/5 GitHub Actions (74/74 Node/backend/preflight, 11/11 local workerd/D1, 20/20 Android security JVM). No remote cloud or physical-device testing.

## Problem and decision

The project's ultimate acceptance condition is not merely a green test suite. **A remote Cloudflare Worker must continue read-only GitHub checks while a physical Android phone is completely powered OFF, persist results in remotely deployed D1, and make them available after actual Google sign-in when the phone restarts.** P1-M already verified backend, local D1 and synthetic Android contracts but has no authorized Cloudflare account, real Google ID token or phone-off experiment.

There was no programmatic way to sanity-check a future owner-provided evidence package spanning D1 rows, Cloudflare Cron event logs, GitHub SHA corroboration, and an Android OFF/ON and post-restart read window. A screenshot, copied JSON, or manually entered flag is inherently falsifiable. It is dangerous to mistake internally consistent timestamps or a user-supplied `cloudflare:true` string for provider-authenticated proof.

P1-N introduces `scripts/offdevice-evidence-gate.mjs` as a **strict offline structural examiner** rather than a remote acceptance oracle. It neither contacts nor authenticates Cloudflare, Google, GitHub or the device. It never changes scheduler permissions and never generates a "VERIFIED" conclusion.

## Input contract: owner-provided, unverifiable assertions

`schemaVersion: 1`, `evidenceClass: "OWNER_SUPPLIED_UNVERIFIED"` and strict keys for:

1. `release`: exact 40-character source commit, migrations [1,2,3,4,5], an owner-controlled approval reference, and timestamps claiming account/quota and OAuth reviews.
2. `device`: declared OFF and ON times and a user-supplied physical evidence reference. A **30-minute or longer** declared window, capped at 24 hours for this pilot, is necessary to pass the structural check. It is not proof that the hardware was powered off or that real Cron ran.
3. `cloudflare.cronEvents`: bounded statements of scheduled tick timestamps, completion count and observation count. These are not authenticated logs; counts and timestamps are only checked for plausible ranges and a match within 60 seconds of a D1 event.
4. `cloudflare.observations`: up to 50 D1-like rows with monitor ID, UUID, persisted positive `event_sequence`, `BASELINE/CHANGE`, SHA predecessor/head and positive `observed_at`. Strict descending sequence and all adjacent SHA links are checked even when timestamps are tied or clocks regress. An original baseline may have disappeared from the 50-row page.
5. `postRestart`: owner-supplied timestamp of authenticated post-boot read and the list of returned observation IDs. At least one D1 CHANGE alleged to occur while the phone was OFF must also occur in this list.
6. `github`: a public repository slug and owner-supplied commit SHA checks at times after the alleged change and before the purported signed read. **This is not proof** that the GitHub server confirmed the change; a reviewer must independently fetch real official GitHub references and consider potential branches/races.

No arbitrary extra top-level or nested keys are accepted. All input is bounded at **65,536 bytes** in a local file. The CLI prints **only structural check names and statuses**, not any supplied timestamp, ID, SHA, file path, credentials or raw log payload. The private manifest must never be committed or uploaded as a CI artifact.

## Result and failure semantics

- Structurally consistent input returns `structural_consistency: "PASS"`, but **always** `remote_acceptance: "NOT_VERIFIED"`, `independent_origin_verification: "NOT_PERFORMED"`, `physical_device_verification: "NOT_PERFORMED"`, `cloudflare_account_quota_and_billing: "NOT_VERIFIED"`, and `safe_to_activate_scheduler: false`. Ordinary CLI exits **0** for this *limited structural result only*.
- Incomplete, unknown-schema, secret-bearing, too large, impossible ordering, impossible timestamp or misleading self-reported field returns `structural_consistency: "FAIL"` and CLI exit **1**.
- `--require-remote` always returns exit **2** for otherwise structurally consistent content. This is a deliberate permanent guard: no amount of owner-entered text can grant remote acceptance.
- Unknown switches/attempts like `--execute-deploy` return exit **64**; the CLI has no action to deploy, mutate remote D1, switch on Cron, send notifications, download credentials or run background work.
- In adversarial tests, even a completely fabricated internally consistent synthetic report is **not** counted as real Cloudflare/phone-off proof.

## Why this is useful without overstating it

This gate catches missing migration versions, release identifiers, inconsistently linked SHA changes, forged sequence types, impossible OFF/ON/response timing, unmatched provider SHA statements, omitted post-restart event IDs, extraneous credential fields and oversized evidence *before* a human reviewer spends time on a real owner-controlled pilot. It is a preparatory reviewer checklist, not the proof itself.

The structural cross-correlation is intentionally weak: the shipped Worker currently prints a generic `scheduled_tick` report, not a cryptographically signed, per-monitor, per-event receipt. Matching one Cron timestamp within 60 seconds of one D1 observation therefore cannot establish that they came from the same trusted invocation. Similarly an Android time recorded by a person does not authenticate physical power state. An adversary controlling the manifest can fabricate all matching fields.

**A real acceptance decision remains independently gated** by owner-approved Cloudflare resource and billing/CPU inspection, actual remote migrations 0001–0005 and HTTPS origin, Google OAuth configuration/device signing, server-side Cron logs captured from the real account, immutable or at least inspectable real D1 rows, public GitHub confirmation, and physical phone OFF/ON and post-boot signed sync evidence. External provenance validation, consent and cost permission are **not automated** by this script.

## Usage and execution bounds

The checked-in [synthetic example](../examples/offdevice-evidence-synthetic.example.json) is fictional and contains no real private information. A copied **private** manifest must be kept outside the repository and outside any CI runner.

```sh
node scripts/offdevice-evidence-gate.mjs --file /private/offdevice-evidence.json --json
# Exit 0 means structurally consistent only; never proof of real cloud work.
node scripts/offdevice-evidence-gate.mjs --file /private/offdevice-evidence.json --require-remote
# Exit 2 even for completely coherent JSON; independent proof is still required.
```

Tests: `tests/offdevice-evidence.test.mjs` includes deliberately forged or contradictory self-reported samples, secret fields, duplicate/broken SHA lineage, invalid time windows, missing real-world corroboration and CLI non-disclosure. `scripts/release-preflight.mjs` has a static guard preventing this feature from being accidentally promoted to a remote deployment or scheduler-activation authorization. These tests run as part of offline `npm test`.

## Evidence boundaries

- The new script's tests use **synthetic fixtures** and Node.js locally in GitHub Actions. Passing them cannot certify Cloudflare Free CPU budgets, D1 charges, true phone power, Google tokens, or remotely executed Cron.
- No network, external API, Cloudflare D1, OAuth secret, Android hardware, account metadata or fee-bearing action was accessed or modified.
- Exact final tested PR HEAD, CI run IDs, any failed tests and merge commit must be recorded separately in [PROGRESS](../PROGRESS.md), [EVIDENCE](../EVIDENCE.md) and [Issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8). **Do not infer CI on post-merge documentation commits.**

Status of the actual end-to-end target: **REMOTE ACCEPTANCE BLOCKED**.
