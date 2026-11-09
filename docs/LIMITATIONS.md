# Limitations and non-claims

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
