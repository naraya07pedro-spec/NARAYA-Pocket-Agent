# Progress ledger | NARAYA Pocket Agent

## 2026-11-10 | P1-I default-OFF Cron, offline release preflight and owner-only pilot template (PR #15 merged; not deployed)

**Problem and security correction:** The P1-H mobile scheduler gate did not disable the **legacy operator-only** scheduled handler. A Worker deployed with a Cron trigger and an existing ACTIVE operator monitor could attempt GitHub reads even though mobile scheduling was OFF. In addition, `worker/wrangler.jsonc` deliberately has `workers_dev:false`, no routes and no real D1 UUID: source CI was never evidence of an Android-accessible remote Worker.

**Implemented:**
- Worker `scheduled()` now returns immediately without D1/provider calls unless `SCHEDULER_ENABLED === 'true'`, a new global opt-in independent of `MOBILE_SCHEDULING_ENABLED === 'true'`. A disabled invocation emits only `{"event":"scheduled_disabled"}` with no owner, token, repo or provider data. Configured Cron triggers can still consume Cloudflare invocation quotas even when this handler does no work.
- `scripts/release-preflight.mjs` performs an entirely **offline** source audit before every `npm test`: production route remains absent, exact default-off gates, fixed 15-minute Cron declaration, additive migrations 0001–0004, fake local D1 fixture, nonsecret Wrangler variables, Android blank OAuth Web Client ID/Worker origin, and lack of automatic Cloudflare-deployment GitHub workflow. Fail-closed invalid source; structured `--json` result.
- `npm run preflight:require-remote` intentionally returns status code **2**: `source_safety: PASS` does **not** equal `remote_readiness: BLOCKED`. Account billing/quota, real Google OAuth, actual remote Worker/D1, 10ms Cron CPU budget and physically-off device cannot be verified offline.
- `worker/wrangler.pilot.example.jsonc` is deliberately **not directly deployable**: placeholder Worker name and invalid D1 ID, `workers_dev:true`, **zero Cron triggers**, and both scheduler permissions `false`. New .gitignore rules exclude an owner-specific copied config and private D1 exports.
- `docs/REMOTE_PILOT_READINESS.md` provides owner approval, Cloudflare read-only quota checks, backup, ordered 0001–0004 migrations, trusted Google OAuth/HTTPS, controlled Cron enable and rollback gates. No deploy script, provider write, account sign-in, secret or hosted endpoint was created.
- `docs/LIMITATIONS.md` and runbook updated to distinguish historical P1-B statements from current P1-E/P1-I source capability.

**First complete tested source SHA `63a625128a9729aa4dbec85344af92a22935b1b5`: 5/5 CI SUCCESS**
- [Offline backend and preflight 42780576969](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42780576969): **53/53 tests PASS**, TypeScript gate, explicit `P1-I offline source checks: PASS` and `Remote deployment status: BLOCKED`. Source adversarial tests include strict Cron ON/OFF, source-mutant preflight, template safety and CLI exit code 2.
- [Local real Cloudflare workerd/D1 42780576610](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42780576610): **10/10 PASS**, including new active operator monitor under default-OFF Cron no D1 claim, no quota reservation, no GitHub request.
- [Live public GitHub Worker adapter + local D1 42780576662](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42780576662), [Android public provider adapter 42780576882](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42780576882), [Android debug APK 42780576952](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42780576952): SUCCESS; 13 Android security tests executed, 0 skipped/failures/errors. Debug APK SHA256 `1c4124226f23b1d6a770336fa6bcbfbfee8cd083db3fccc9f622d03704c465f8`.
- A later README/runbook/ADR follow-up SHA `aa940280557d6c8ab270d9b26d657dc0204608b3` also passed 5/5 workflows, but **final PR-head CI must be independently checked after this ledger commit**. Do not equate these CI runs with a different SHA.

**Final PR-head CI and merge evidence:** source SHA `1f1ff9006853a535ee6e4a312afd2abc9d906e07` passed **all 5/5 workflows** after all documentation edits: [Node/source 42781427926](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42781427926) **53/53 PASS**, with preflight `source_safety: PASS` and `remote_readiness: BLOCKED`; [workerd/D1 42781427816](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42781427816) **10/10 PASS**; [real GitHub GET, local D1 42781428111](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42781428111) SUCCESS; [Android network adapter 42781427857](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42781427857) SUCCESS; [Android debug APK 42781427789](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42781427789) SUCCESS, **13/13 Android security tests executed, 0 skipped/failures/errors**, debug APK SHA256 `3ca70f474e6c1ab6ebce083444c9c7fd8b79dc98ee874e801ed3ac059ff6dc26`. [PR #15](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/pull/15) merged as `0a344f334ccbc4ca6881b2d2cf7d91aef134c990`. These are **PR HEAD** CI checks; no independent assertion about CI of merged-`main` SHA or following documentation-only commits.

**What is NOT VERIFIED:** any real Cloudflare deployment/route/D1/Cron, current Free quota or provider account balance, actual 10ms Cron CPU, public Google OAuth issuer/audience/JWKS and genuine on-device ID token, actual Android RAM/battery, or task continuing while the phone is physically switched off. `SCHEDULER_ENABLED` and mobile flag remain OFF by default. No external cloud provisioning, migrations, paid services, or provider writes were done. See [ADR-0010](ADR/0010-default-off-cron-release-gate.md), [REMOTE_PILOT_READINESS](REMOTE_PILOT_READINESS.md), [EVIDENCE](EVIDENCE.md), [Issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8) and [Issue #2](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/2).

---

## 2026-11-10 | P1-H shared D1 Cron dispatch budget (PR #14 merged; not deployed)

**Problem demonstrated:** the previous three-GitHub-GET cap was per scheduler invocation, so two overlapping Cron invocations could independently make up to six requests. The `last_owner_id` cursor improved approximate fairness, not distributed quota enforcement.

**Implemented:**
- Non-destructive additive `worker/migrations/0004_global_scheduler_budget.sql` adds `budget_window_start` and `budget_claims` to the single existing `scheduler_control` row, retaining monitor data, owner identities and fairness cursor.
- Every scheduler mode, **operator-only and opt-in mobile**, now **reserves an atomic D1 slot before attempting a leased provider fetch**. Strictly at most three successful reservations in one *fixed* UTC quarter-hour across invocations using the **same D1 database**. A later window resets allowance. A backward/replayed window and missing migration deny provider I/O; a verified failed monitor lease claim refunds its unused slot.
- One provider attempt consumes a reservation even if GitHub times out or returns errors. No new external write APIs, no cloud deployment or alteration of Android APK source. Mobile scheduling default remains OFF.
- Preserved per-monitor lease fencing and existing 3-checks-per-invocation maximum. Overlapping scheduler cursor updates can still reorder fairness; exact remote fairness has **not** been proven.
- **Trade-offs:** up to six attempts can straddle two fixed-window boundaries, so this is not a *rolling* 15-minute cap. A crash after reservation may waste quota; backlog may delay scheduled checks. Missing migration intentionally prevents even operator-only Cron from making upstream calls.

**Local evidence**: source SHA `067b7905f9781193cba11beb3eaf650c6ecec5c4` **5/5 workflows SUCCESS**: [Node backend 42777373598](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777373598) **43/43 tests + TypeScript**, [workerd/D1 42777373148](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777373148) **9/9 tests**, [real public GitHub read against *local* D1 42777373157](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777373157), [Android public GitHub adapter 42777373129](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777373129), [Android debug APK 42777373585](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777373585): SUCCESS. The two new workerd/D1 tests prove overlapping claims against one local binding, process restart preserving allowance, next-window backlog, and applying 0004 after an existing legacy monitor/cursor. Three added Node tests prove parallel cap, clock replay rejection, quota refund, and fail-closed missing migration. **Final PR HEAD `352a99ab4860e0ac31ee50312ee01ac142c8a251` passed 5/5 workflows:** [backend 42777929307](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777929307) **43/43**, [workerd/D1 42777929046](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777929046) **9/9**, [live read-only GitHub 42777929294](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777929294), [Android provider adapter 42777929001](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777929001), [Android debug APK 42777929189](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777929189) with **13 tests run / 0 fail / 0 error / 0 skipped**, APK SHA256 `01c0ecb948924082c089ac5e7598e9d8a8c1984647ef77b307a602cc6be37ab9`. [PR #14](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/pull/14) **merged** as `b7cdca9ddd03b1f6e5f1f6f2ad3a7ab6b6946640`. This verifies final PR-head code, **not independently the merge commit nor subsequent ledger-only commits**.

**Failure and correction:** source SHA `7f66a2197eb16f2edadd2acafc4161bbdfdbc7be` had [live-read CI 42777198245](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42777198245) **FAILED** because `tests/github-live.test.mjs` only applied migration 0001; its local D1 was missing `scheduler_control`. Updated fixture to apply the full **0001–0004** chain at SHA `067b790...`, then all five workflows passed. This failure is a test bootstrap regression, not a live remote Cloudflare incident. Preserve the failed run.

**Evidence boundary:** synthetic scheduler overlap against SQLite + real **local** workerd/D1 binding; the source still has no real Cloudflare Worker/Cron/D1 deployment, Google-issued mobile token or physically-powered-off-device observation. No external paid/provisioned cloud operations. Actual Cloudflare Free CPU/query costs and bills are unverified. The primary Cloudflare documentation confirms cron uses UTC and a D1 database processes queries serially; see [ADR-0009](ADR/0009-d1-global-cron-budget.md). It does not prove remote execution or the account's free-tier eligibility.

**Next:** enforce migration ordering in any approved remote acceptance, verify real billing/quota and Google OAuth configuration, then record true remotely scheduled observations during a physically powered-off phone window. [Issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8), [Issue #2](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/2), [Issue #5](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/5).

---

## 2026-11-10 | P1-G bounded public OIDC JWKS cache (PR #13 merged; no remote deployment)

**Implemented:** Cloudflare Worker now optionally caches **public provider JWKS bytes only** in a dedicated `caches.open('naraya-pocket-agent-public-jwks-v1')` namespace. Cache discovery happens **per request**; neither user credentials nor request-scoped Promise is saved globally. Only the operator-configured HTTPS JWKS URL is fetched. Provider must send `Cache-Control: public, max-age=N` with positive safe integer TTL and without private/no-store/no-cache. Cap at **300 sec (5 min)**, JWKS body at **64 KiB** and key array at 32. Every token still requires RS256 signature, issuer, audience, time and kid verification. Expired JWKS + provider outage fails closed, never uses stale keys. Cache API unavailable/corrupt is treated as an optional acceleration, not an authorization bypass.

**Adversarial correction:** an initial candidate with module-level `WeakMap` and an in-flight fetch Promise (source SHA `ea5af66ff404c038f72899c3d8d88f8b676c439e`) was **replaced before merge** after consulting Cloudflare's current rule against request-scoped global I/O state. The final design intentionally does **not** promise single-flight across concurrent requests.

**Tested source SHA `5bdad79e2821f0cb7418e0d1e2b09e542a26e4e0`, 5/5 CI SUCCESS:**
- [Backend + TS source CI 42770060702](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770060702): **40/40 tests PASS**, TypeScript typecheck. Seven additional tests cover real RSA signature checks on cache hit, forged JWT, no-store/private/bad cache headers, bounded TTL, stale/provider outage, key rotation, corrupt Cache API, named namespace and request concurrency.
- [Cloudflare local workerd/D1 CI 42770060770](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770060770): **7/7 tests PASS**, including two signed synthetic identities using one shared public key cache but separated D1 user mappings.
- [Worker live read-only GitHub CI 42770060997](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770060997), [Android GitHub adapter CI 42770061012](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770061012), [Android debug APK CI 42770060723](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770060723): all SUCCESS, preserving previous behavior.

**Final PR-head gate:** all **5/5 workflows SUCCESS** at exact SHA `21bcd3625072f6a57ef4420ff80d73b188d03361`: [backend 42770459491](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770459491) **40/40**, [local workerd/D1 42770459535](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770459535) **7/7**, [live GitHub Worker GET 42770459875](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770459875), [Android adapter 42770459458](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770459458), and [Android APK 42770459499](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42770459499), with Android `CloudSyncClientTest` **13 executed / 0 failures/errors/skipped** and debug APK SHA256 `22d7f1a66c56e825f38dcbe041e673e9f6ea83048a3883a9b0749b690523cf5f`. [PR #13](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/pull/13) merged to `main` as `f9f551940f8cc9e83b3d14783dbc41ff63aeefe0`. These CI links certify the PR HEAD; **a separate exact main-merge SHA CI has not been established**.

**Evidence class:** source/local CI and synthetic JWT/Cache API. Google recommends caching public signing keys per HTTP directives; Cloudflare documents Cache API locality/availability and request-scope isolation, see [ADR-0008](ADR/0008-request-safe-oidc-jwks-cache.md). **Not proven:** live Google-issued token, Cloudflare remote JWKS cache effectiveness/cost, real OAuth configuration, deployed Worker/D1/Cron, physically powered-off phone, real Android RAM/battery or account-level free-tier/billing. Caching may miss or be unavailable and will fetch JWKS normally. There was **no deployment, production identity request, purchased service, API credential submission or billable cloud operation**.

**Next:** verify exact final PR-head SHA after documentation; merge only with 5/5 CI. Then owner-approved Google OAuth/Cloudflare remote pilot and device-off acceptance remain [Issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8), [Issue #2](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/2), and [Issue #5](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/5).

---

## 2026-11-10 | P1-F Android cloud monitor controls and observation evidence (merged PR #12; not remotely deployed)

**Merged:** [PR #12](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/pull/12) as `4028d783bd332470e198a6fd0607c2562b0ca726`. Final tested PR HEAD `9bfb371520592ee5afa3297873a9a4b08a8d4c52`.

**New implementation:**
- Compose adds explicit **Request cloud activation / Pause cloud monitor**, plus **Read server observations**. It acts only on server-confirmed owner-scoped monitor rows. Responses must confirm the expected UUID, `status`, monotonically incremented `version` and `schedulerEligible`. A 401 clears all session/cloud UI data. Conflict, provider errors or offline states do **not** invent success or wipe local drafts and verified SHA.
- Android fixed-HTTPS-origin adapter now supports narrowly allowlisted `PATCH /v1/sync/monitors/{UUID}` and `GET /v1/sync/observations?monitorId={UUID}` in addition to existing explicit GET/POST. Response parsing validates monitor UUID, observation UUID, `BASELINE`/`CHANGE`, previous/head 40-char hex SHA, positive ordered timestamps, and max 50 observations. Only first five are shown.
- Client reads up to **2 KiB** of HTTP 409 error data and maps only `scheduler_disabled`, `stale_version`, `active_monitor_limit` to finite typed errors without echoing untrusted provider response or bearer. Other conflict details remain generic.
- No new backend endpoint was needed; existing signed-user D1/status/observation contracts were exercised through a **new real local workerd/D1 integrated test**: two RSA-signed users, foreign status/observations 404, scheduler flag OFF rejection, flag ON ACTIVE ACK, simulated official GitHub response, persisted baseline, PAUSE, and zero further claims after pause.
- The Android default APK still intentionally has **no real Google Web OAuth Client ID and no Worker origin**. `MOBILE_SCHEDULING_ENABLED` stays OFF by default. New controls **cannot** prove real remote cloud execution or physically powered-off-phone autonomy.

**Exact final source evidence at PR HEAD `9bfb371520592ee5afa3297873a9a4b08a8d4c52` (5/5 workflows SUCCESS):**
- [Android debug APK and JVM run 42765189002](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42765189002): **13/13 `CloudSyncClientTest` executed; 0 skipped, failed or errored**. Final APK SHA-256 `095d69e1f8edd11fe3e56cec33730c9871980ab8ddecb5705c52b46e0729ab8a`.
- [Cloudflare workerd/D1 local run 42765188864](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42765188864): **6/6 PASS** including full signed-owner control + observation contract.
- [Backend Node tests + TypeScript 42765189297](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42765189297): **33/33 PASS**, typecheck successful.
- [Real read-only GitHub Worker GET 42765188869](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42765188869): SUCCESS.
- [Real read-only Android GitHub JVM adapter 42765188843](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42765188843): SUCCESS.

**Failed checkpoint preserved:** intermediate commit `7c9bd63a18c6719b58af60f90be31f7fb811e6c9` failed [Android APK CI 42764978876](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42764978876) and [Android adapter CI 42764978636](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42764978636) because a new Kotlin test function name started with `409`, an invalid identifier. Renamed test on `9bfb371...`; all five CI workflows passed afterward. No known source failures are hidden.

**Evidence classification:** CI_VERIFIED_LOCAL / CI_VERIFIED_SYNTHETIC_SIGNED_JWT, not real Google identity or remotely deployed Cloudflare D1/Cron. Real mobile sign-in, real cloud sync, free-tier account counters, mobile RAM/battery, JWKS rotation/cache, concurrent remote Cron fairness and powered-off-device experiment remain **NOT_VERIFIED**. GitHub merge SHA is confirmed, but independent CI success on the merged `main` SHA and subsequent ledger-only commits is **not claimed**.

**Next gate:** verify and authorize genuine OAuth + trusted Worker domain, obtain real device sign-in, validate per-owner GET/POST/PATCH/observations over deployed D1, then perform actual remote Cron + physically-off phone acceptance only after explicit user authorization/cost gates. See [ADR-0007](ADR/0007-android-cloud-control-observation-evidence.md), [Issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8), [Issue #5](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/5), and [Issue #2](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/2).

---

## 2026-11-10 | P1-E Android opt-in Google identity + manual cloud sync (PR #11 merged; not deployed)

**Implemented on Android source:**
- Credential Manager explicit Google sign-in with ephemeral ID token in RAM; no token, client secret or operator bearer in resources or SharedPreferences. Actual Google provider configuration is intentionally absent from default build.
- BuildConfig public Web OAuth Client ID and trusted HTTPS Worker origin are sourced only from explicit Gradle properties. Both default empty; cloud controls disabled in checked-in CI APK.
- Bounded fixed-origin HTTP adapter: one manual POST using the existing draft UUID, `GET /v1/sync/monitors` on explicit refresh, no redirects, 4 KiB upload, 16 KiB response, typed 401/409/429/offline failures, no automatic Android polling.
- Compose shows cloud state only from validated server replies; local SHA/history preserved after errors. Logout clears token and displayed server state. Local delete explicitly says it does **not** delete the cloud monitor.
- Google Credential Manager 1.6.0 / googleid 1.1.1; googleid 1.2.1 was incompatible with the repository's Kotlin compiler metadata. Version fixed without bypassing metadata validation.

**CI verified**: [Android APK + JVM 42760135711](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760135711) SUCCESS and [Android public GitHub adapter 42760135615](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760135615) SUCCESS on source SHA `fbde24642ee96b8e4d8a78a33d89d49431526e0d`; source backend, local D1 and live GitHub CI also SUCCESS (see EVIDENCE). Debug APK SHA-256 `c4959e4d469e5c6eebd89ceb1c1d8ff7af0abd91052237bd9f60d1aca130e3d8` on the same SHA. This proves build and synthetic tests, not real Google login. **Later security gate verified:** source SHA `c0842663c98f2ef67d73b3fabda657fe708aa313` passed **all 5/5 workflows**: [Android build/test 42760557852](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760557852), [live adapter 42760557793](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760557793), [backend 42760557716](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760557716), [local D1 42760557874](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760557874), [live GitHub GET 42760558191](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42760558191). Android CI parsed actual JUnit XML and confirmed **CloudSyncClientTest 7 executed / 0 failed / 0 errors / 0 skipped**. APK SHA-256 on this SHA: `96d5a706cb310b874cccb3fce4787922f834ecab5b02c27bae8b52c9f26d51db`. Subsequent defensive response contract and docs changes still require final PR-head CI before merge.

**PR #11 final-head evidence (all 5/5 workflows SUCCESS):** source SHA `e1dc90816ecc85df064fa379bda114c35541e967`. [Android debug APK + executed unit tests 42761079608](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42761079608) confirmed `CloudSyncClientTest` **7 run, 0 failed, 0 errors, 0 skipped**; APK SHA-256 `172d937de4f021716be1504ea74bc9329070edc39722402e98a6b801722c3bc0`. [Android real public GitHub adapter 42761079643](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42761079643), [backend tests/TypeScript 42761079408](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42761079408), [local workerd/D1 42761079456](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42761079456), [live public GitHub read 42761079496](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42761079496) all SUCCESS. **Merged PR #11 as `a1b86a3a95895c8516d3be766379ec6b42faee17`**. These runs are PR-head checks, NOT independently confirmed main-merge SHA checks. No Google sign-in, Worker deployment, remote D1 or phone-off action verified.

**Failure evidence:** [Android initial build 42759905864](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42759905864) and [live adapter build 42759905986](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42759905986) failed on `cbc107b5c730ddc097f2e5efd8b8e3f0397985b5` because `googleid:1.2.1` used Kotlin metadata 2.4.0 and the compiler expected 2.2.0. The code did not bypass type safety; dependency was pinned to 1.1.1 and successful runs verified after the correction.

**NOT_VERIFIED/NOT_IMPLEMENTED**: real Google OAuth registration and signed-in mobile session, deployed Worker/D1/Cron, actual Android→Cloudflare sync, device-off scheduled monitor acceptance, physical Android RAM/battery, account-level free-tier quota, JWKS caching/rotation, Android cloud monitor start/stop control. No deployments, paid APIs or provider writes performed. Backend already has owner isolation, replay protection and feature-flagged scheduler, but it has not been deployed. See [ADR-0006](ADR/0006-android-google-identity-manual-sync.md) and issues #8/#2/#5.

---


## 2026-11-10 | P1-D server-side bounded multi-user scheduler (PR #10 merged, not deployed)

**Merged:** [PR #10](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/pull/10) to `main`, merge SHA `2368b27c18d0f6c07c2e61377c12ad6331b1c36b`. Feature gate remains OFF by default.

**Implemented:** feature-gated (`MOBILE_SCHEDULING_ENABLED==='true'`) multi-user GitHub read-only scheduled execution, verified-owner status PATCH with optimistic `expectedVersion`, max 20 identities in pilot, max 9 ACTIVE mobile monitors, global 3 GitHub requests/tick and 1 due monitor/owner/tick. D1 migration `0003_scheduler_control.sql` persists a rotating owner cursor. Feature flag absent => legacy operator-only scheduler; no Android credentials, cloud provisioning, paid API, or external write.

**Tested at source SHA `1d7640417a7bbae9435098cd71fcc45c5418957a`:**
- [Backend CI 42755265080](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265080): **33/33 tests passing**, pinned TypeScript typecheck SUCCESS. Includes disabled-by-default, versioned PAUSE/ACTIVE, A/B IDOR, fairness across four owners, max-active enrollment, identity limit, stale-worker after pause, regression.
- [workerd/D1 local CI 42755265299](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265299): **5/5 tests passing**, includes true local D1 persisted round-robin cursor after Worker restart and owner fairness under global cap.
- [Live read-only GitHub GET CI 42755265084](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265084), [Android adapter CI 42755265417](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265417), [Android debug APK CI 42755265184](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755265184): **SUCCESS** (Android runtime tests are JVM/CI; no physical device).
- Early HEAD `c7312e712f695283a1108f1ac73e7c5965690765` failed due to malformed mobile route parser syntax and did not exercise scheduler behavior; fixed on `1d7640417a7bbae9435098cd71fcc45c5418957a`. Failed runs remain inspectable.

**Final PR-head CI gate:** **5/5 workflows SUCCESS** on exact PR HEAD `fa8471459ed7608fd6bf3f45d13cca74006851b5`: [backend](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755625591), [D1 workerd](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755625446), [live GitHub GET](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755625823), [Android adapter](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755625621), [APK build](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42755625491). Merge SHA is confirmed by GitHub, but **independent main SHA workflow success has not been established** by these PR-head runs.

**Evidence boundary:** server-side implementation + simulated provider identities + local Cloudflare D1/workerd; **NOT** verified Google/Firebase login, Android UI sync, remote Cloudflare Cron, powered-off phone, physical RAM/battery, actual account pricing, concurrent remote Cron invocations, or fairness SLA. `MOBILE_SCHEDULING_ENABLED` has not been configured in any deployed environment. The response `schedulerEligible` is a local authority/scheduling gate, not provider execution confirmation; success remains tied to observations. The PR-head commit has 5/5 verified runs; the merged main SHA and subsequent documentation-only commits require separate evidence before claiming exact main-SHA CI.

**Blocked / next evidence gate:** real OIDC provider configuration, secure Android token/opt-in sync, separate owner-approved real Cloudflare free-tier D1/Cron experiment, device-off acceptance. Review [ADR-0005](ADR/0005-bounded-fair-mobile-scheduler.md) and [issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8). No production deployment or cost-bearing side effects occurred.

---

## 2026-11-10 | P1-C owner isolation and idempotent mobile-sync API (PR #9 merged; not deployed)

**Implemented and merged on PR #9, merge SHA `778a8cbb42fca71074d9800607c7f5b358e51242`:
- `0002_mobile_identity_sync.sql`: additive `user_identities` table and nullable client draft/digest columns plus unique index on `(owner_id,client_draft_id)`. Legacy operator rows are not auto-adopted.
- Verified `issuer+subject` mapped to server-generated opaque UUID. Client-supplied owner IDs have no authority.
- `GET/POST /v1/sync/monitors` use OIDC bearer only, strict schema, bounded single-item body, normalized repository, atomically checked 3-monitor owner quota, replay-safe draft IDs, changed-payload conflict. Lists are SQL owner-scoped.
- `GET /v1/sync/observations?monitorId=...` requires ownership or returns 404. Operator bearer token still exclusively gates legacy endpoints.
- New mobile monitors are **PAUSED**; scheduling is explicitly NOT enabled for mobile users until the scheduler's single-owner design is safely replaced.

**Test evidence at source SHA `633ccda10beda76d864a1ee9cd1303e284bf8268`:**
- [Offline source CI 42750701827](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750701827): SUCCESS; **28/28** backend tests and TypeScript typecheck. New tests cover two accounts, IDOR, owner keys, duplicate replay, changed payload, quota, malicious fields, invalid/forged tokens, legacy separation and concurrent calls.
- [Local workerd/D1 CI 42750701808](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750701808): SUCCESS; **4/4** D1 tests including cross-owner isolation, replay after persisted runtime restart, and applying migration `0002` to a database with a prior operator row.
- [Official GitHub read CI 42750701796](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750701796), [Android live adapter CI 42750702269](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750702269), [Android build CI 42750701661](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750701661): SUCCESS, preserving prior read-only behavior.

**Evidence class**: CI_VERIFIED_SYNTHETIC for signed identity + mobile sync backed by local SQLite/workerd-D1, not a real OIDC provider or deployed Cloudflare. Android app still uses manual public GitHub preview; it has **no token acquisition or sync UI**. Remote Cloudflare Cron, user tasks executing while phone is off, RAM/battery, billing and production access remain NOT_VERIFIED. This branch's final docs commit and merge SHA must be separately checked; links above refer to precise earlier source SHA.

**PR-head gate:** all **5/5** workflows SUCCESS on final PR HEAD `fc39f66343048a8dfdbae887035bef25d9ddca63`: [source](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750920672), [D1](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750920480), [live GitHub](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750920518), [Android adapter](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750920679), [Android APK](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42750920423). Merge commit confirmed via GitHub, but separate CI evidence for merged/main and this documentation-only commit is not claimed.

**Next**: choose and verify actual free-tier OIDC provider, implement secure Android login/token lifecycle and opt-in sync; implement fair bounded multi-user scheduler before permitting ACTIVE; execute real cloud and phone-off verification only after explicit owner authorization. See [issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8).

---

## 2026-11-10 | P1-C first implementation slice: server-side cryptographic identity verification

**Implemented and merged to main by PR #7, merge SHA `cd2298a6b91392af9024afa4bd7ba42d8bdc6be3`:**
- `worker/src/oidc.ts`: fail-closed, bounded RS256 JWT verification against operator-configured HTTPS JWKS. Exact issuer, audience, subject, iat, exp, optional nbf/azp, kid, key selection and WebCrypto signature verification; 3-second bounded JWKS fetch, no redirects, 64 KiB body limit. The token never selects the JWKS host.
- `GET /v1/me`: distinct read-only identity probe; returns `authenticated: true` and `monitorSync: false` only after verification. No operator bearer accepted as mobile identity. No new D1 writes, third-party sends or app token storage.
- 7 adversarial OIDC test cases with generated RSA keys and synthetic token/JWKS fixtures, plus existing 12 backend tests, included in `npm test`.
- Existing pilot owner-token endpoints and scheduler remain unchanged. User-scoped SQL, Android authenticated sync and remote Cloudflare are NOT implemented.

**Source proof:** [source CI run 42747877456](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42747877456) at source SHA `af55967f6d6370861dc1b02367a7c53883f08219`: **19/19 passing tests, TypeScript typecheck SUCCESS, no credential-file gate SUCCESS**. The test harness initially failed 1 test on prior SHA `24c83e393424f6582daa16dae1ea545929432272` because the synthetic JWKS hostname was not stubbed in the Worker endpoint test (returned expected 503 for unreachable provider); corrected by mocking global fetch in the test only, not by weakening verification. Subsequent source CI passed.

**Final PR-head proof:** all **5/5 GitHub Actions workflows SUCCESS** at PR HEAD SHA `cc42f084ed61ccb7f7cffd5cf9f2b69f8508307b` (runs: [source](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42748123959), [local D1](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42748123925), [live GitHub Worker GET](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42748123934), [Android build](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42748123872), [Android network adapter](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42748123994)). The merge SHA was confirmed by GitHub, but **separate main-run workflow evidence is not yet claimed**.

**Status separation:** IMPLEMENTED = backend verifier and probe. TESTED = deterministic synthetic crypto and CI. LIVE_VERIFIED = none for real OIDC/mobile sign-in, cloud sync, remote D1/Cron or physical Android. **Next gate:** owner-scoped authorization and D1 isolation tests, followed by idempotent sync. Provider selection, real Android OIDC integration, and deployment need separate evidence and approval. JWKS caching, provider rotation strategy and identity subject-to-user mapping need design/verification before release. Final PR HEAD CI complete on exact SHA as linked; the subsequent merged main and this ledger-only commit require separate checks if claiming main CI.

---

## 2026-11-10 | Continuation checkpoint | P1-B verified, P1-C contract prepared

**Read-only verification performed:** default-branch latest merged commit is `e1e0dd7034d85500d3e7ab4474b7bc853a8ef7d1` (PR #6). Existing issue #5 records five successful CI workflows on exact merged SHA, and Android APK SHA-256 `2f7ba572db031705cf9cca4373fa6d66a6f365283487a2a9a1a960cda83aa137` ([Android run 42669136705](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42669136705)). The earlier source SHA `d90887a3...` is not the final merge SHA.

**This continuation's deliverable:** [ADR-0004](ADR/0004-secure-android-cloud-sync.md), a proposed implementation contract for OIDC verification, SQL-level user isolation, idempotent draft sync, fail-closed authentication and replay/IDOR test gates. **Documentation/design only, not code implementation or cloud authorization.**

**Implemented:** existing P1-B backend and Android source on main. **Tested:** prior CI per issue #5. **Live-verified:** official public GitHub GET in CI, not remote Cloudflare and not physical device. **Blocked:** deployed remote D1/Cron and powered-off-device proof pending explicit owner authorization; physical Android benchmark unavailable. **Next evidence gate:** code and automated tests for verified-user identity plus cross-user isolation, then idempotent sync; independent issue #2 for real Cloudflare/phone-off acceptance.

**Decisions preserved:** Android-first; personal then business; no embedded operator token; no unapproved external writes or deployment; zero additional spend target. No claims of actual OAuth integration, synchronized monitor, device runtime, remote task completion, or user validation.

---

## 2026-11-10 | P1-B: Android manual live-provider preview and durable local snapshots

**Implementation committed to feature branch:** Kotlin `GithubHeadClient` with fixed official GitHub HTTPS GET and redirects disabled; bounded 32 KiB response, UTF-8/SHA validation, error classification; background-thread execution via coroutines; Compose UI manual Check now action; locally saved successful commit SHA/timestamp; backwards-compatible `DraftCodec` retaining P1-A drafts and ignoring individual corrupt records. Android version 0.2.0-alpha adds only INTERNET permission, no backend operator token.

**Testing introduced:** deterministic JVM tests for parser, statuses, oversized responses, invalid slug, I/O failures and schema migration; independent live network JVM integration test with GitHub branch-ref SHA cross-check and explicit no-skip CI gate; clean Android CI that inspects actual APK permissions and generates a debug APK.

**Source CI result:** 5/5 workflows SUCCESS on source SHA `d90887a3d407d5178368ce197bb99e6e8c84545a`. Exact links and APK SHA-256 in the evidence section below. Verify PR HEAD and final merged `main` separately before calling stage complete. No physical device, RAM, cloud sync or phone-off autonomy claim.

**Unverified:** mobile physical hardware, WiFi/mobile data behavior, RAM/PSS and battery, Google/OIDC identity, cloud monitoring and remote Cloudflare deployment. Free-spend guardrail and issue #2 remain unchanged.

## P1-B source CI evidence (2026-11-10)

Source commit `d90887a3d407d5178368ce197bb99e6e8c84545a` passed **all 5 workflows**:
- [Backend offline tests + TypeScript](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086317): SUCCESS.
- [Local Cloudflare workerd/D1](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086457): SUCCESS.
- [Worker's official live GitHub GET](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086552): SUCCESS.
- [Native Android debug APK + unit tests + manifest permission gate](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086432): SUCCESS. APK SHA-256 `aefbceab40f1cf17c54a930cf682540d21f5d6766e0ea21a9562cdf6434d48ad`; [ephemeral artifact 13696608733](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086432/artifacts/13696608733), expires 16 November 2026 UTC.
- [Android GitHub adapter real network acceptance](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42668086200): SUCCESS; JUnit XML asserts **1 test executed, 0 skipped, 0 failed, 0 errors**.

This is CI at source SHA, not yet the merge SHA. **No physical Android, Cloudflare remote, powered-off device, RAM/battery benchmark, OAuth login, or cloud sync verified.**

---

## Earlier milestones (historical)

Rules: **Implemented** = source exists. **Tested** = observed in named environment. **CI verified** = public run and exact commit SHA. **Live verified** = real Cloudflare/owner device/provider. None imply a later level automatically.

## 2026-11-09 | Stage P0.1 | Safe cloud-monitor backend

**Implemented and merged into `main`:** TypeScript Worker API, D1 migration, conditional scheduler lease/state machine, GitHub public default-branch reader, owner token gate, pause/resume with optimistic version, observation log, GitHub Actions offline test configuration, threat model and operator runbook.

**Local tested:** Node.js 22.16, Node built-in SQLite test double, 10 deterministic tests across authentication/input validation/deduplication/real SQL queries/provider errors/lease fencing/status changes. Source TypeScript typecheck run with `tsc` 5.8.3.

**GitHub Actions verified:** PR head `982f6ad8d331035a73ff5e97c88f9cada697e73a` and merged source `main` commit `d8298143a942d75ad6846fcd1510ea4ea2cde704` both passed offline tests and TypeScript checks. [Main CI run](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42651566624).

**Unverified:** actual Cloudflare D1/Cron behavior, live GitHub provider read, Android hardware, off-device acceptance, uptime, user adoption, billing impact. Read `docs/EVIDENCE.md` for current class.

**Next evidence gate:** owner-approved real Cloudflare D1 test, then powered-off-phone test. See [issue #2](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/2). No production deploy until explicit authorization.

**Owner choices retained:** Android first; personal + business incrementally; safe actions automatic, sensitive actions approval-gated; zero additional spending.


## 2026-11-09 | P0.2-A | Local Cloudflare D1 and security hardening

**Implemented:** Separate Wrangler 4.158.0 workerd/D1 local-acceptance suite with isolated temporary persistence, schema application via D1 prepared statements, API create/list, scheduled-state evaluation, baseline/change, runtime restart and stale lease fencing. Owner configuration now fails closed; streamed GitHub response is byte-limited to 32 KiB and validated with strict UTF-8.

**Evidence at source SHA `09f8a927830285e0cbf8f83c19193123c7d9fb19`:**
- [Offline CI 42655079899](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42655079899): **SUCCESS**, 12/12 Node+SQLite behavioral tests, TypeScript check and secret-file gate.
- [Cloudflare-local D1 CI 42655079982](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42655079982): **SUCCESS**, 2/2 `workerd` D1 integration tests including restart persistence and stale-worker rejection.
- Initial CI on `f1b838e62c` failed: offline suite unintentionally included Wrangler-dependent test, and `D1.exec` rejected multiline SQL input. Corrected by separating test suites and applying complete SQL statements through D1.prepare; failed runs remain visible, no skip introduced.

**Evidence class:** CI_VERIFIED on *local Cloudflare runtime*, NOT LIVE_VERIFIED on Cloudflare's remote platform. No remote D1, Cron delivery, powered-off Android, external provider GET, account billing or uptime proof. No Cloudflare resource created or deployed.

**Next:** P0.2-B owner-approved disposable remote D1/Worker, exact remote migration, genuine GitHub GET, powered-off-phone demonstration and verified quota accounting. Issue #2 remains open. Android P1 later requires proper end-user identity; owner bearer token never enters APK.

## 2026-11-09 | P0.2-B partial, P1-A mobile pilot | public provider and Android source

**Implemented on development branch:** an independently triggered, read-only live GitHub provider acceptance job; official commit-head GET -> shipped scheduler -> local Cloudflare workerd/D1 -> separate official GitHub ref cross-check. A Kotlin/Jetpack Compose Android draft manager allows creation, listing and removal of public GitHub repo monitor drafts saved through local SharedPreferences. It has no INTERNET permission, cloud credentials, agent inference, background service, or user-auth pretence.

**Verified CI before final documentation changes:**
- [Live GitHub network read 42661442994](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42661442994): SUCCESS on SHA `dddbba531304c29efc6495983d1500173999b40a`. Public GitHub source `naraya07pedro-spec/NARAYA-Pocket-Agent`, matching branch HEAD `7dd952b9a1f1a02d1f68f538e11164e542beff4c`. Stored locally via workerd/D1; no deployed Cloudflare.
- [Android native build 42661442547](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/actions/runs/42661442547): SUCCESS on same source SHA, Gradle 9.4.1 / AGP 9.2.1, SDK 37.0, JVM unit tests and debug APK artifact. This does not prove a real-device install or resource footprint.
- Existing offline 12-case suite and Cloudflare-local D1 2-case suite were also SUCCESS on the same source SHA.
- Early Android CI failures (runs `42661033339` and `42661215368`) were from SDK setup configuration: an obsolete `tools` package and the wrong `platforms;android-37` identifier. Fixed by installing platform-tools and `platforms;android-37.0`, without skipping source tests.

**Still NOT verified:** remote Cloudflare Worker/D1 or real Cron; end-to-end phone-off autonomy; Android owner-device install and RAM measurements; Google/OIDC user authentication, sync, or approval; business workflows; external write state. No provider writes, no cloud resource provisioning and no paid API use.

**Next evidence gates:** final PR/main SHA CI, APK manifest no-INTERNET proof, and owner-approved remote D1/Cron acceptance. See issue #2 and ADR-0002.
