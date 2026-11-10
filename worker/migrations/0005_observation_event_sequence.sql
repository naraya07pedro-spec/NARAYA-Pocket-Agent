-- P1-M: durable causal insertion order for observations. Applied after 0004.
-- Historical rows are backfilled in preexisting ROWID insertion order.
-- The copied value is durable across SQLite VACUUM; future writes assign
-- one greater than the existing maximum inside the same INSERT statement.
-- No rows, monitor identities, provider secrets or observations are deleted.
ALTER TABLE observations ADD COLUMN event_sequence INTEGER;
UPDATE observations SET event_sequence = rowid;
CREATE UNIQUE INDEX IF NOT EXISTS observations_event_sequence_unique
  ON observations(event_sequence);
CREATE INDEX IF NOT EXISTS observations_monitor_sequence
  ON observations(monitor_id, event_sequence DESC);
