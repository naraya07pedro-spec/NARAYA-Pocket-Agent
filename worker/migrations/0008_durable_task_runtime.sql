-- P2-C: additive, bounded, synthetic-only durable task + step runtime.
-- No triggers, no external provider dispatch, no AI inference, no PII.
CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user_identities(id),
  client_task_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind='SYNTHETIC_LEAD_TRIAGE_V1'),
  client_lead_id TEXT NOT NULL,
  lead_input_digest TEXT NOT NULL CHECK(length(lead_input_digest)=64),
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  current_step INTEGER NOT NULL DEFAULT 0 CHECK(current_step BETWEEN 0 AND 3),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE(owner_id,client_task_id)
);
CREATE INDEX IF NOT EXISTS task_runs_by_owner ON task_runs(owner_id,created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL CHECK(step_index BETWEEN 0 AND 2),
  step_code TEXT NOT NULL CHECK(step_code IN ('VERIFY_LEAD','VERIFY_TRIAGE','VERIFY_DRAFT')),
  status TEXT NOT NULL CHECK(status IN ('READY','WAITING','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  lease_token TEXT,
  lease_until INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  result_code TEXT,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(task_id,step_index)
);
CREATE INDEX IF NOT EXISTS task_steps_due ON task_steps(task_id,step_index,status,lease_until);

-- Hour-aligned D1 quota prevents unlimited manual replays and cross-isolate
-- request bursts. Failed/ambiguous refunds are conservative: quota can only
-- be reduced, never exceeded. Never reset a newer window from an old clock.
CREATE TABLE IF NOT EXISTS task_step_budgets (
  owner_id TEXT PRIMARY KEY REFERENCES user_identities(id),
  window_start INTEGER NOT NULL DEFAULT 0 CHECK(window_start>=0),
  claims INTEGER NOT NULL DEFAULT 0 CHECK(claims BETWEEN 0 AND 12)
);
