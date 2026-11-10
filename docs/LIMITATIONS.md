# Limitations and non-claims

## Current P1-I source and remote status (10 November 2026)

The Worker has a global **default-OFF Cron kill-switch** `SCHEDULER_ENABLED`, separate from mobile owner scheduling. An offline release preflight checks source config, migration chain, ignored private pilot config, Android OAuth defaults and CI no-deploy rules. A valid preflight **must still report remote readiness BLOCKED** because there is no owner-approved Cloudflare deployment, actual Google OAuth account/token, remote D1 database, public Worker HTTPS route, real Cron execution, physically powered-off-device acceptance or account CPU/billing measurements.

Cloudflare Workers Free publishes **10ms CPU per Cron trigger**, and D1 Free has its own limits; tests under local workerd do **not** prove that a production invocation satisfies the Free CPU cap. An OFF Cron can still be invoked and counted by the platform even though the handler makes no D1 or provider calls. A future owner-approved configuration must check quotas and charges before turning on triggers.

Android **source** implements explicit Credential Manager login, manual owner-scoped sync, status PATCH and observation GET. The standard debug APK lacks Google Web Client ID and Worker origin, so those cloud controls are disabled. Android has **not** been installed on consenting physical hardware for a signed-in end-to-end test. Neither source/JVM/CI nor a mocked RSA token proves production security, performance, reliability or real-world autonomy.

Source and acceptance: [ADR-0010](ADR/0010-default-off-cron-release-gate.md), [REMOTE_PILOT_READINESS](REMOTE_PILOT_READINESS.md), [PROGRESS](PROGRESS.md), [EVIDENCE](EVIDENCE.md).

---

## Historical stage P1-B snapshot (2026-11-10; superseded by P1-E/P1-I)

Android now has an experimental **manual public GitHub HTTPS preview**, with a debug APK and JVM tests. INTERNET permission is intentionally present for this single read-only feature. Snapshot storage remains local and not encrypted. No verified Android hardware test, actual RAM/thermal/battery measurement, multi-user authentication, cloud sync, device-off autonomy, production deployment or paid AI exists. The code does not embed the owner backend secret. Rate-limits, connectivity loss, and upstream changes can prevent a check; previous valid snapshot is retained. No third-party writes or automatic Android background work occur.

## Historical stage descriptions (retained for audit history)

- No Android APK, Google Sign-In, Firebase, FCM, local Room cache, device benchmark or actual powered-off-phone acceptance exists yet.
- No Cloudflare account, D1 database, Worker route or Cron deployment was provisioned during this stage.
- Tests run Node's built-in SQLite through a D1-like shim, not genuine Cloudflare D1 or platform Cron; remote semantics and CPU usage remain unverified.
- GitHub HTTP is injected during tests; no real public GitHub call, OAuth account, API write or business effect is claimed from local CI.
- Single-owner bearer secret is for operator/CLI only, inappropriate for shipping to Android. No production-ready multi-user identity, rate-limiting gateway or enterprise data controls.
- Auto-pause after failures protects quotas but may delay detection until the owner explicitly resumes; API quotas can still be exhausted by other apps.
- Repo commit-head checks can miss rapid intermediate commits between polling intervals; not an event-complete changelog.
- GitHub API and D1 can be down. No 24/7 uptime promise, SLA, independent performance results, real-world ROI, or autonomous access to apps on a powered-off phone.
- Observations are source snapshots, not signed authenticity proof; GitHub default-branch head changes do not guarantee a business outcome.
- No license grant for this public source at the current stage; commercial/open-source decision deferred.

## P0.2-B and P1-A (9 November 2026)

Live GitHub public API reading and local Cloudflare workerd/D1 persistence are CI verified, but neither is a deployed Worker nor a real remote Cron trigger. An Android Kotlin/Compose debug APK has been built by CI, but the current app only stores public GitHub monitor drafts on the phone and has no INTERNET permission, login, backend sync, agent execution or notifications. Real-device installation, RAM, battery, uptime and powered-off-phone acceptance remain unverified. Never embed the owner-only bearer token in the APK. A debug-signed Android artifact is not a production-signed release.
