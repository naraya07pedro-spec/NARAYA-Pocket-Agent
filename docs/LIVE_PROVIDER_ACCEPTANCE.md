# P0.2-B partial: real public GitHub API, local Cloudflare runtime

The test `tests/github-live.test.mjs` is a **live read-only** integration test. It creates a public repository monitor through the shipped Worker API, passes the real public GitHub HTTP response to the shipped scheduler, saves a BASELINE observation in Cloudflare's **local workerd/D1**, and compares the saved head SHA with a separate official GitHub `git/ref/heads/main` endpoint.

It uses the public repository `naraya07pedro-spec/NARAYA-Pocket-Agent`, only official fixed-host GET operations, no GitHub token, no Cloudflare secret, no customer data and no provider writes. The test runs in GitHub Actions; its result can be reproduced by the dedicated `.github/workflows/github-live-read.yml` workflow.

### Evidence interpretation
- Pass means actual public GitHub GET + local workerd D1 persistence and cross-endpoint SHA equality at that moment.
- It **does not** prove a deployed Cloudflare Worker, D1 production, Cron trigger delivery, mobile-device-off acceptance, uptime or account cost.
- It is network-dependent. If GitHub rate limits or network connectivity fails, the CI run must fail. A green offline test must never be substituted as live proof.
- A changing upstream branch may cause cross-endpoint mismatch; investigate timestamps and source movement before retrying.
- The repository uses a read-only provider, so there is **no** external write outcome to verify in this milestone.

### Remaining P0.2-B gates
Account plan/quotas and zero-spend eligibility inspected; separate owner approval for any disposable remote D1/Worker provisioning; real D1 migrations, remote Cron, actual external read and recorded cloud state, powered-off-phone verification, cleanup, and billing limits. Keep issue #2 open until verified.
