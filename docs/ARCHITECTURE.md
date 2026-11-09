# Architecture | P0.1

```text
[Future Android client / current owner CLI]
         | authenticated HTTPS (owner token for pilot ONLY)
         v
    [Cloudflare Worker HTTP API]
         |-- validate owner, schema, quotas, optimistic updates
         v
    [D1: monitors, observations, audit events]
         ^
         |
    [Cron every 15m] -> [bounded scheduler: max 3 checks]
                         | lease claim (atomic D1 SQL)
                         | fixed-host GitHub GET
                         | conditional observation + lease-fenced commit (D1 batch)
                         v
                    [D1 persisted result]
```

**State truth is the database, not the phone.** A scheduled invocation loads due monitors, conditionally claims a lease, reads one public GitHub default-branch commit SHA, and commits an observation and state update together. Baseline is distinct from later changes. Repeated identical SHA produces no new observation. An expired or paused lease rejects stale results.

### Limits of guarantee

D1 `batch` is used for transactional success/failure result persistence; conditional updates guard stale lease ownership. This creates at-most-one accepted observation per lease and prevents stale workers from overwriting newer state **within this storage model**. It does not guarantee exactly-once external execution, reliable push notifications, continuous availability, or crash durability beyond the actual D1 service semantics. No external writes exist yet.

### Future seams

`android/`: native lightweight UI (not yet implemented). `contracts/`: cross-platform API contract. Later auth must verify provider tokens at Worker and associate a stable owner ID with each task. Later side effects require separate intent/approval/outcome tables and provider read-back reconciliation, never speculative retries.
