# P2-G | NARAYA Android product UI refresh, anti-template design

**Stage:** native Android implementation, not a generated UI illustration. The chosen design direction combines an engineering-focused navigation hierarchy, a quiet introductory home and restrained editorial approval review. **No real Cloudflare account access, actual Android-device screenshot, or production provider integration is asserted.**

## What changed

The previously enormous single screen is separated into four navigation destinations in `MainActivity.kt`:

| Tab | Function | Data source / claims |
|---|---|---|
| **Beranda** | Quiet onboarding and useful next actions | Real local draft count; explicit *not configured/not signed in* cloud status; no fabricated leads, success percentages or cloud uptime |
| **Tugas** | Synthetic workflow creation, manual progress, filtered task list, cancellation, approval initiation | Exact signed, owner-scoped P2-B/P2-C response; progress equals completed step count / 3, no automatic task execution |
| **Approval** | Human decision inbox, confirmation dialogs, effect audit, D1-only simulation and readback | Matching task-bound approval ID and target/payload digests with unexpired approval; never a CRM write |
| **Monitor** | Original manual GitHub repository check, offline draft list, optional explicit cloud sync and cloud monitor controls | Existing P1 source and logic preserved; no auto-activation on screen render |

The navigation uses native **Material 3 NavigationBar** and contains no custom WebView, remote UI service, unknown dependency, rendered mock task, moving/glowing decorative asset, fake connection indicator or oversized stats. The palette is subdued charcoal (`#111617`), light neutral text, muted teal (`#91C5B4`) for focus and amber for pending decisions. Typography, space, hairline borders and clear CTA hierarchy replace neon dashboard cards. The app remains usable on narrow screens through scrollable independent destinations and bounded server lists.

`PocketDesign.kt` centralizes reusable design components and the static truthfully disconnected home. `PocketUiState.kt` maps backend statuses into Indonesian product copy without turning `APPROVED_NO_DISPATCH` into an implied send or `CONFIRMED_APPLIED` into real CRM success. Filtering and pending-review counts derive exclusively from a successfully fetched `ReviewSnapshot` and exact matching nonexpired approvals.

`WorkflowReviewPanel.kt` retains the signed, user-initiated API mutations and confirmation dialogs from P2-F, but presents tasks and approvals on **different screens**. A failed refresh now clears potentially stale snapshot data; after every acknowledged mutation, the signed server state must be reread. A 202/timeout does **not** imply action success or authorise a second provider write. SHA-256 and raw UUIDs remain accessible in expandable technical details, not the main approval CTA.

## Evidence standard and exclusions

Existing P2-F source-safety invariants remain mandatory: workflow UI only with `signedIn && cloudConfigured`, ephemeral Google ID bearer, exact HTTPS origin/route allowlist, no WorkManager/Cron/hidden sends, `AlertDialog` on cancellation/approval/simulation, no blind retries. Additional P2-G source-safety checks and `PocketUiStateTest.kt` cover labels, filters, actual owner snapshot counts, expiration and digest mismatch suppression. The full Android Compose UI must compile, run Android JVM tests and build a cryptographically verified debug APK in GitHub Actions; then the exact final PR head and fresh merged main must be checked before calling the code complete.

**Still not verified:** actual screenshots from a rendering Android emulator or phone, interactive small-screen visual QA, touch/contrast/accessibility instrumentation, Google live sign-in, Cloudflare account Worker/D1 remote deployment/billing/CPU costs, Cron execution with HP physically off, and provider-specific sandbox or real external CRM writes. The UI must not be called *visually QA passed* just because Kotlin compilation succeeds.

Default Android build retains **empty Google OAuth Web client ID and Worker HTTPS origin** so no accidental external cloud use. The feature gating is not removed and the application's network behavior is unchanged except for the user-initiated UI endpoints.

**`remote_acceptance=BLOCKED` · `safe_to_deploy=false` · `safe_to_activate_scheduler=false`**.

See [P2-F reviewer contract](P2_F_ANDROID_WORKFLOW_REVIEW.md), [P2-E synthetic reconciliation](P2_E_SYNTHETIC_RECONCILIATION.md), [progress ledger](PROGRESS.md) and [live owner gate issue #8](https://github.com/naraya07pedro-spec/NARAYA-Pocket-Agent/issues/8).
