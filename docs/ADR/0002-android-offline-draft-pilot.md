# ADR-0002: Android offline-first thin client without embedded owner credentials

**Date:** 2026-11-09  
**Status:** Accepted for experimental P1-A (no cloud deployment)

## Context
Pocket Agent must be controlled from Android without high RAM consumption, while actual autonomous jobs execute remotely when the device is powered off. The current Cloudflare Worker prototype exposes a single-owner bearer token, not an end-user authentication system. Placing that token in an APK would grant every APK holder the owner's authority.

## Decision
The first native Android artifact is an **offline-only draft manager**. It has no INTERNET permission and no network client; creates/reads/deletes up to 20 public-GitHub-repository monitor drafts with local SharedPreferences. All cards explicitly say DRAFT ONLY. Input is limited to public repository slugs, not messages, credentials or customer records. No background service, local large language model, AI requests, or provider writes.

The prototype persists draft changes synchronously with SharedPreferences.commit() and surfaces a failure instead of falsely claiming the draft was saved. Do not infer transaction guarantees beyond Android SharedPreferences or claim local data is encrypted at rest.

The user/owner may submit only public repository slugs in this build. Later versions require user-specific OIDC/Firebase authentication validated in a remote Worker, server-owned authorization, durable task states, and a migration from drafts to confirmed cloud jobs with explicit user intent.

## Rejected options and tradeoffs
- **Bundle OWNER_API_TOKEN in APK:** rejected as full-authority credential leakage.
- **Local background LLM/always-on worker:** rejected for RAM/battery and Android background policy. Would not work with the phone fully off.
- **Ship a login form without actual auth:** rejected as misleading.
- **Automatically sync local drafts after install:** rejected until user identity, ownership and consent are implemented.

## Proof and remaining gates
Android Gradle CI must successfully assemble a debug APK and execute unit tests before labeling it CI_VERIFIED. Instrumented UI tests, restart on a real phone, user acceptance, RAM and battery measurements remain future gates. The remote Cloudflare device-off story remains independently unverified.
