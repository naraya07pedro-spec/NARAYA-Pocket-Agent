# Product baseline | 2026-11-09

Authoritative product decisions from the owner-approved **Pocket Agent Master Project Brief v1.0**. The full brief is retained in the project's supporting files. This repository records the implementation-facing constraints so engineering decisions cannot silently drift.

- Target: Android first; personal research monitoring and business lead triage, developed incrementally.
- Execution: mobile client is lightweight control/approval surface; long-running tasks execute off-device on a cloud-resident durable state machine. A powered-off phone cannot execute Android-local actions.
- Autonomy: safe read-only operations automatic within quotas; any external send/write requires fresh server-side payload/target-bound owner approval. AI output is **never** an authorization grant.
- Cost: **Rp0 additional required for the pilot**. No unapproved billable API, paid fallback, VPS purchase, or automatic infrastructure deployment.
- Defaults: Cloudflare Workers/D1/Cron; Workers AI optional later; Kotlin/Compose/Room, Android Keystore and optional FCM after cloud proof.
- Privacy and correctness: synthetic demonstration data, secrets never committed or logged, fixed provider endpoints, explicit `UNKNOWN_OUTCOME`, no blind external-write replay, status determined by verified effects.
- Proof: product demo, clean setup, SHA-bound CI, happy/failure paths, threat model, measured benchmark, read-back for any live-provider **write** claims, documented trade-offs.
- Excluded from MVP: unrestricted Android control/accessibility, arbitrary code execution, destructive operations, autonomous payments, mass messaging, multi-agent complexity, big on-device LLM, unbounded 24/7 inference.

## Scope of P0.1

Only a single-owner GitHub public commit-head monitor and its safe execution machinery are implemented. It does **not** read customer conversations, write to GitHub, send email, deploy any model or serve an Android application. P0.1 uses an owner-controlled bearer secret for CLI tests; this is **not** the approved authentication architecture for an Android release. The owner-approved later stage uses identity-provider-backed authentication and server-side verification.

## P0 → P4 acceptance milestones

P0: Cloud scheduler + durable database + safe read-only GitHub adapter; real powered-off-phone experiment after owner-approved deployment.
P1: Android install, login, task feed, approval UI, Room cache, FCM notifications, device restart recovery.
P2: Business synthetic lead intake, immutable action intent, payload-bound approval; no external write before approval.
P3: Controlled provider sandbox write + external read-back; optional quota-bounded AI inference.
P4: Android device memory/battery benchmark and recruiter-first release evidence.

No implementation may claim a later milestone complete before passing its explicit evidence gate.
