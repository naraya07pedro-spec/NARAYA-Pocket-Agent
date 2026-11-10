# ADR-0013 | Cross-runtime observation history integrity

Date: 10 November 2026
Status: MERGED via PR #18 as `a9303f8635c271180f3764c52fb64b7b082ab7c5`. Exact final PR-head SHA `68763a31860bdd831606037644f478b384996c33` passed 5/5 CI (62/62 backend/preflight, 10/10 local D1, 20/20 Android security JVM). Not deployed remotely.

## Source audit: individually valid events can still form an impossible history

The P1-K Android `CloudSyncClient.observations()` enforced each event's UUID, owner monitor ID, `BASELINE/CHANGE` type, SHA shape, positive timestamp and newest-first order. It **did not validate the relationship** between a newer `CHANGE.previous_sha` and the immediately older `head_sha`. For example, an isolated response could contain a valid-format CHANGE from SHA `d` to `c` followed by an older entry whose SHA is `b`; Android would still display these as verified observations.

This is a **client/source integrity gap**, not evidence that a live Cloudflare D1 returned corrupted observations. The current remotely undeployed scheduler is designed to atomically persist correct SHA predecessor links on each successful monitor lease.

## P1-L implementation

1. The Android observation client now runs an additional **bounded in-memory coherence pass** on the at-most-50 owner-scoped events, without new network requests or persistent data. It rejects more than one BASELINE, a CHANGE whose `previous_sha` equals its `head_sha` (a no-op event), and any BASELINE with another event at a strictly earlier timestamp.
2. **When every event has a distinct timestamp**, newest-first order is unambiguous. Every newer row must be CHANGE and its `previous_sha` must equal the immediately older event's `head_sha`; otherwise the entire response fails with `INVALID_SERVER_RESPONSE`. A 50-row response can legitimately omit the oldest BASELINE, so a missing baseline is **not** automatically an error.
3. **When two events have the same millisecond timestamp**, the Worker intentionally orders them by random UUID as the secondary sort key. This does not encode commit causality. The Android client therefore **does not invent a total causal order** or reject a history only because SHA adjacency disagrees with the arbitrary UUID ordering. In this case it retains per-event shape, no-op, baseline count and non-strict-oldest checks, but cannot certify cross-event linkage. This is a documented conservative limitation, not complete validation of tied-time histories.
4. To remove independent hand-written API schema assumptions, source and Android tests consume **the same nonsecret test resource** `android/app/src/test/resources/mobile-observations-v1.json` (three linked events, fixed synthetic UUIDs and positive epoch-millisecond times). One signed-owner Node test inserts those synthetic rows into isolated SQLite/D1-like storage, then calls the **real Worker `GET /v1/sync/observations`** and requires exactly the same JSON field names, types and ordering. A second owner gets 404.
5. A **separate** Node test creates a signed mobile monitor, authorizes it with both Cron gates, and invokes the shipped `runScheduler()` locally three times in distinct time/quota windows using deterministic **fake provider SHA responses**. The resulting BASELINE → CHANGE → CHANGE is read back through the real owner-scoped HTTP API and must have two correct predecessor links. The static seeded fixture is **not** presented as proof of a scheduler run.
6. Kotlin JVM adversarial tests consume the shared file and mutate predecessor SHA, duplicate baseline, no-op CHANGE, baseline chronology and missing oldest baseline. Tests explicitly require tied timestamps not to be falsely rejected. Offline source preflight includes a mutation guard so removing the chain check, its baseline count, or the distinct-time safeguard cannot quietly pass CI.
7. No change to Cloudflare runtime schedule, database migrations, bearer authentication, identity quotas, Android manifest/permissions, stored login tokens or default-disabled remote configuration.

## Meaning and limits of the resulting proof

- **Validated:** the current Worker API serializes the same synthetic observation JSON that the current Android JVM parser accepts; the local scheduler's actual state transitions produce a correctly linked sequence under deterministic, isolated conditions; malformed unique-time chains are rejected fail-closed on Android.
- **Not established:** that arbitrary production database histories are valid, that every tied-time history is causally coherent, that server event timestamps are trustworthy against a compromised cloud, that all history exists beyond the latest 50 rows, or that the Android UI actually ran on physical hardware.
- The two tests use **different evidence sources**: a *seeded* contract fixture for schema compatibility and *generated* local scheduler observations for causality. Neither is Google-issued authentication, a deployed Cloudflare Cron or phone-off acceptance.
- An older backend with different serialization would be rejected by Android rather than silently trusted. Controlled app/backend version pairing remains necessary for a future authorized pilot.
- A validation failure leaves local public-repository drafts and previously saved SHA snapshots untouched; it does not initiate a provider write, remote retry storm or automatic cloud activation.

## Required evidence before closure

1. Source CI with Node tests, preflight and TypeScript; real **local workerd/D1** integration; external public GitHub GET test on isolated local D1; Android official provider adapter and debug APK JVM tests. Require **5/5 successful workflows on exact final PR HEAD**.
2. Log both corrected implementation and any failing intermediate runs, including exact source SHA and actual JUnit counts, in [PROGRESS](../PROGRESS.md) and [EVIDENCE](../EVIDENCE.md); preserve artifacts and URL evidence.
3. Merge only after exact final-head proof; write merge SHA and any documentation-only `main` SHA separately. Do **not** infer CI of post-merge SHA from pre-merge evidence.
4. Keep [Issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8), [Issue #5](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/5) and [Issue #2](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/2) open until independent **owner-approved remote Cloudflare, real Google OAuth, and physical phone-OFF** acceptance. Both scheduler permissions remain OFF in the checked-in configuration.

No Cloudflare remote D1/Worker/Cron was deployed or migrated; no OAuth registration, paid service, or external provider mutation occurred.
