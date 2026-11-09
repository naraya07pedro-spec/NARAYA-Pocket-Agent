# ADR 0001 | Cloud-resident tasks + lightweight Android client

**Accepted for MVP**, 2026-11-09. Owner decisions: Android first, personal + business use cases, approval for side effects, zero additional cost.

## Decision

Execute scheduled work in a Cloudflare Worker triggered by Cron and persist task/observation state in D1. The Android app is a control surface. Start with the deterministic, public GitHub read-only vertical; do not couple initial success to AI inference, Google Sign-In, or APK distribution.

## Rationale

A powered-off Android phone cannot run a local background agent. Pushing inference and continuous scheduling off-device avoids a resident model in RAM and permits task progression during device shutdown. Serverless short invocations avoid paying for an always-on compute instance for the MVP.

## Consequences and alternatives

- Cloudflare Free has quotas, scheduler granularity, and strict CPU limits. Splitting work into small durable steps adds state complexity and may require redesign under larger workload.
- A paid VPS supports longer-running operations but costs more, requires patching and backups, and is explicitly deferred.
- A fully on-device agent improves offline privacy but cannot work while the phone is off and may pressure battery/RAM.
- Bearer owner token is **temporary developer-only auth**. It is not an appropriate credential for distributing an Android APK. Provider-validated per-user identity replaces it before P1.
- Public GitHub REST reads do not prove cross-provider write reliability. That will be measured only after separate sandbox acceptance in P3.

No remote resources are provisioned or deployed by this ADR.
