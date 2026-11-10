# ADR-0019: Cloudflare D1 inventory cannot infer completeness from a short first page

Date: 2026-11-10
Status: Accepted in P1-R source; remote Cloudflare access and acceptance remain BLOCKED.

## Decision context: actual P1-Q source-level defect

P1-Q's offline-by-default Cloudflare metadata inspector treated a D1 database list as complete when it contained fewer than 100 rows and `result_info.total_pages` was absent. Official `GET /accounts/{account_id}/d1/database` documents `result_info.total_count` (along with `count`, `page`, `per_page`) and does **not** promise `total_pages`. Thus, a D1 response with one result and `total_count:2` could be incorrectly categorized as complete and the missing target database categorized as absent. This is a **potential false negative proven from source contract**, not a remotely observed account state or incident.

Official source: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/list/ . Different Worker Scripts List endpoint is explicitly `SinglePage` rather than assumed to be paginated in groups of 20: https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/list/ .

## Chosen change (P1-R)

1. For D1, accept a page only if JSON is successful, it is an array, `result_info` supplies internally consistent `total_count`, `page` matching the requested value, `per_page=100`, and optional `count` matches row count. A missing or contradictory metadata value fails closed.
2. Read successive pages via a fixed **GET-only allowlist**: maximum ten pages of up to 100 databases, no arbitrary host/path or SQL endpoint, no unbounded pagination. Unique observed D1 UUIDs must not repeat across pages. Only when the aggregate row count matches stable `total_count` is the inventory marked complete. If the bound, request, or metadata fails before that, an absent target remains `UNKNOWN`, not `false`.
3. For Worker Scripts List, use the documented single-page semantics. If a future API response includes a contradictory `total_count`, downgrade to incomplete rather than assert target absence. Validate Cron response shape before reporting a schedule count. Source: https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/get/ .
4. D1 size is reported only after a separate GET for a UUID whose returned `name` and `uuid` match the target. An unavailable or mismatching response cannot become a numeric measurement. Source: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/ .
5. Implement an actual **stream-time cap of 262,144 response bytes**, strict UTF-8 decoding and timeout rather than `response.text()` then checking length, because post-read validation cannot bound peak memory consumption.
6. Preserve permanent `remote_acceptance:BLOCKED`, `safe_to_deploy:false`, `safe_to_activate_scheduler:false`, no user tokens or IDs in structured output, no cloud mutation, and never infer billing/Free plan/CPU/OAuth/phone-OFF from inventory.

## Adversarial evidence and unresolved limitations

- Mocked Cloudflare official-shape API response `total_count:2`, first page one non-target, second page one target: inspector requests page 2 and finds the target, preventing P1-Q false-negative classification.
- Adversarial cases cover invalid page metadata, wrong page number, inconsistent totals, repeated UUID, hitting page bound with unseen resources, failed second page, oversized streaming response, untrusted detail UUID, wrong database identity, future Worker pagination, invalid Cron array and unauthorized redirect.
- **Initial CI failure:** P1-R test fixture used substring `url.includes('page=1')`; this incorrectly matched `per_page=100` in a page-two URL. It was corrected to `new URL(url).searchParams.get('page') === '1'`. Preserve initial failed run as evidence of the test fixture error, not runtime cloud failure.
- Ten-page cap may be exceeded by a large paid account; this intentionally remains `PARTIAL_PAGES` and may demand manual inspection rather than optimistic success. `inventory_complete` only means API metadata list coverage, **not** plan, billing, quota, CPU, migrations, live Cron or physical-device evidence.
- The Cloudflare API response and source are mocked in CI, not validated against a user account. Production verification requires explicit user-led read-only account inspection followed by independent human review of billing/usage. No migration/deploy/Cron or cost-bearing activity is authorized.

## Alternatives rejected

- Assume `total_pages` always exists, or a short page means complete: unsupported by official contract.
- Treat the first page as a definitive complete account snapshot: risks missing database and false approval decisions.
- Auto-fetch unlimited pages or accept arbitrary URLs returned by API: unnecessary API load and dangerous trust boundary.
- Treat a green test or synthetic API response as an owner-provided live Cloudflare confirmation: false evidence promotion.

## Next acceptance gate

Run the **owner-reviewed** P1-R inspector in a private trusted environment with a narrowly scoped Cloudflare read-only API token and compare account dashboard subscription/billing/usage. No provider writes, Google OAuth credentials, migrations, deployment, Cron activation or physical phone-OFF experiment occurred in P1-R source work. Follow `docs/REMOTE_PILOT_READINESS.md` and issue #8.
