-- Single-owner pilot. No AI calls or external writes in the first milestone.
CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'PAUSED')),
  interval_minutes INTEGER NOT NULL CHECK(interval_minutes BETWEEN 30 AND 1440),
  next_due_at INTEGER NOT NULL,
  last_checked_at INTEGER,
  last_sha TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0 CHECK(fail_count >= 0),
  last_error_code TEXT,
  lease_token TEXT,
  lease_until INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_id, repo_owner, repo_name)
);
CREATE INDEX IF NOT EXISTS monitors_due ON monitors(status, next_due_at, lease_until);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  lease_token TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('BASELINE', 'CHANGE')),
  previous_sha TEXT,
  head_sha TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  UNIQUE(monitor_id, lease_token)
);
CREATE INDEX IF NOT EXISTS observations_monitor_time ON observations(monitor_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('CHECK_COMPLETED', 'CHECK_DEFERRED')),
  code TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_monitor_time ON audit_events(monitor_id, recorded_at DESC);
