# ADR-0003: bounded native GitHub read-only previews before cloud identity

**Date:** 2026-11-10
**Status:** Accepted for P1-B, experimental mobile pilot

## Problem
P1-A shipped an offline Android draft manager, but it could not do anything with a real provider. The cloud Worker still uses an owner-only full-authority bearer token; bundling that token inside an APK would disclose operator control. A no-setup, low-RAM, immediately useful feature is needed while safe multi-user cloud auth remains unimplemented.

## Decision
Add a manually initiated GitHub public **read-only latest commit** preview on Android:
- `owner/repo` input goes through the same constrained slug validation as the existing Worker.
- Build a URL to `https://api.github.com/repos/{owner}/{repo}/commits?per_page=1`. Transport verifies HTTPS and the **fixed exact host**, sends GET with no authorization header, disables redirects and enforces 6s connect and 6s socket-read timeouts.
- Parse a maximum **32,768-byte** body through a bounded byte stream and strict UTF-8 decoding. Validate a one-entry JSON array containing an exact 40-digit hexadecimal SHA. Rate limits, errors, invalid bodies and network failures fail closed.
- Perform network IO in a coroutine IO dispatcher; avoid networking or AI inference on the main UI thread.
- Persist a successful SHA/time pair and show cached data across launches; preserve previous verified values when a check fails.
- Keep at most 20 public draft entries and a backwards-compatible local JSON codec. Bad individual records do not erase healthy neighbors.
- Declare the Android INTERNET permission intentionally; no contacts, location, microphone, SMS, notification or automation permission at this stage.
- Mark all cloud schedules **DRAFT ONLY**. The only active feature is a user-initiated read. There is no cloud data sync or phone-off agent execution in this APK.

## Trade-offs / rejected approaches
- **Put operator token in the APK:** rejected as irreversible full-authority exposure.
- **Public unauthenticated Worker endpoints for monitor management:** rejected as unauthorized task creation.
- **On-device continuous polling:** rejected for battery, RAM and Android background policy.
- **Full offline model:** rejected as unnecessary for a reliable public-commit preview.
- **Heavy local database/framework:** premature for 20 public snapshots; use existing bounded SharedPreferences, explicitly without encryption claims.

## Proof and constraints
Use deterministic JVM tests for strict input, status/error mapping, response bounds, invalid data, old-schema migration and state persistence codec; an opt-in live JVM integration test for real official GitHub GET and independent SHA corroboration; clean Gradle Android CI and manifest inspection. These do not prove network performance or persistence on a physical phone, nor Cloudflare Cron delivery.

GitHub unauthenticated rate limits and errors are external constraints. No SLA, verified RAM baseline, uptime or physical-device acceptance is claimed. The feature is deliberately reversible and isolated from future authenticated cloud APIs.
