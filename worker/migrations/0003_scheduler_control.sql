-- Conservative, durable global scheduler fairness cursor (opt-in only).
-- One row is sufficient for the single-Worker pilot. This is not a distributed lock.
CREATE TABLE IF NOT EXISTS scheduler_control (
  id INTEGER PRIMARY KEY CHECK(id=1),
  last_owner_id TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO scheduler_control(id,last_owner_id) VALUES(1,'');
