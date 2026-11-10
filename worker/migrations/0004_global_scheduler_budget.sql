-- P1-H: non-destructive hard cap on provider dispatch across overlapping
-- mobile-enabled Cron invocations. The existing single operator cursor row is
-- the atomic reservation authority, not Worker-isolate memory.
-- UTC epoch-aligned 15-minute windows. No resets when a clock moves backward.
ALTER TABLE scheduler_control
  ADD COLUMN budget_window_start INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scheduler_control
  ADD COLUMN budget_claims INTEGER NOT NULL DEFAULT 0
  CHECK(budget_claims >= 0 AND budget_claims <= 3);
