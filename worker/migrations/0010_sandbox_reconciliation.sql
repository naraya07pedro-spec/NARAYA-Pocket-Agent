-- P2-E: deterministic, D1-only synthetic provider and read-back ledger.
-- This is NOT a real CRM, webhook, HTTP request or external side effect.
-- One manual attempt per fully approved, task-bound effect. Fail closed.
CREATE TABLE IF NOT EXISTS sandbox_dispatches (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user_identities(id),
  effect_id TEXT NOT NULL UNIQUE REFERENCES synthetic_effect_intents(id),
  approval_id TEXT NOT NULL REFERENCES synthetic_approval_intents(id),
  task_id TEXT NOT NULL REFERENCES task_runs(id),
  payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64),
  target_digest TEXT NOT NULL CHECK(length(target_digest)=64),
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'PREPARED' CHECK(state IN
    ('PREPARED','IN_FLIGHT','UNKNOWN_OUTCOME','CONFIRMED_APPLIED','QUARANTINED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 1),
  lease_token TEXT,
  lease_until INTEGER,
  readback TEXT NOT NULL DEFAULT 'NOT_CHECKED' CHECK(readback IN
    ('NOT_CHECKED','FOUND_MATCH','NOT_FOUND_UNCERTAIN','FOUND_CONFLICT')),
  last_reconciled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_id,effect_id)
);
CREATE INDEX IF NOT EXISTS sandbox_dispatch_owner_recent
  ON sandbox_dispatches(owner_id,created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS sandbox_provider_records (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user_identities(id),
  effect_id TEXT NOT NULL UNIQUE REFERENCES synthetic_effect_intents(id),
  task_id TEXT NOT NULL REFERENCES task_runs(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64),
  target_digest TEXT NOT NULL CHECK(length(target_digest)=64),
  created_at INTEGER NOT NULL,
  UNIQUE(owner_id,effect_id)
);

-- An exact, valid approved P2-D binding must exist at PREPARED dispatch
-- creation, so a legacy lead-only approval cannot prepare a provider action.
CREATE TRIGGER IF NOT EXISTS sandbox_dispatch_requires_approved_effect
BEFORE INSERT ON sandbox_dispatches
BEGIN
  SELECT CASE WHEN NEW.state<>'PREPARED' OR NEW.attempt_count<>0
    OR NOT EXISTS(
      SELECT 1 FROM synthetic_effect_intents e
      JOIN synthetic_approval_intents a ON a.id=e.approval_id
      JOIN task_runs t ON t.id=e.task_id
      WHERE e.id=NEW.effect_id AND e.owner_id=NEW.owner_id
        AND e.approval_id=NEW.approval_id AND e.task_id=NEW.task_id
        AND e.status='APPROVED_NO_DISPATCH'
        AND a.owner_id=NEW.owner_id AND a.status='APPROVED_NO_DISPATCH'
        AND a.task_id=e.task_id AND a.task_version=e.task_version
        AND a.payload_digest=e.payload_digest
        AND a.target_digest=e.target_digest
        AND t.owner_id=NEW.owner_id AND t.status='SUCCEEDED'
        AND t.version=e.task_version AND t.lead_input_digest=e.task_input_digest
        AND e.payload_digest=NEW.payload_digest
        AND e.target_digest=NEW.target_digest
    ) THEN RAISE(ABORT,'sandbox_dispatch_not_approved_or_mismatched') END;
END;

CREATE TRIGGER IF NOT EXISTS sandbox_dispatch_no_retarget
BEFORE UPDATE OF owner_id,effect_id,approval_id,task_id,payload_digest,
  target_digest,idempotency_key,created_at ON sandbox_dispatches
BEGIN
  SELECT RAISE(ABORT,'sandbox_dispatch_immutable');
END;

CREATE TRIGGER IF NOT EXISTS sandbox_dispatch_state_guard
BEFORE UPDATE OF state ON sandbox_dispatches
WHEN NEW.state<>OLD.state
BEGIN
  SELECT CASE WHEN NOT (
    OLD.state='PREPARED' AND NEW.state='IN_FLIGHT'
    OR OLD.state='IN_FLIGHT' AND NEW.state IN
      ('UNKNOWN_OUTCOME','CONFIRMED_APPLIED','QUARANTINED')
    OR OLD.state='UNKNOWN_OUTCOME' AND NEW.state IN
      ('CONFIRMED_APPLIED','QUARANTINED')
  ) THEN RAISE(ABORT,'sandbox_dispatch_invalid_transition') END;
  SELECT CASE WHEN NEW.state='CONFIRMED_APPLIED'
    AND NOT EXISTS(
      SELECT 1 FROM sandbox_provider_records p
      WHERE p.owner_id=OLD.owner_id AND p.effect_id=OLD.effect_id
        AND p.task_id=OLD.task_id
        AND p.idempotency_key=OLD.idempotency_key
        AND p.payload_digest=OLD.payload_digest
        AND p.target_digest=OLD.target_digest
    ) THEN RAISE(ABORT,'sandbox_confirmation_requires_readback') END;
END;

-- This is the ONLY simulated provider side effect. It is entirely in local
-- D1 and can happen at most once by the provider idempotency key.
CREATE TRIGGER IF NOT EXISTS sandbox_provider_requires_claim
BEFORE INSERT ON sandbox_provider_records
BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM sandbox_dispatches d
    WHERE d.owner_id=NEW.owner_id AND d.effect_id=NEW.effect_id
      AND d.task_id=NEW.task_id
      AND d.idempotency_key=NEW.idempotency_key
      AND d.payload_digest=NEW.payload_digest
      AND d.target_digest=NEW.target_digest
      AND d.state='IN_FLIGHT' AND d.attempt_count=1
      AND d.lease_token IS NOT NULL
  ) THEN RAISE(ABORT,'sandbox_provider_record_without_claim') END;
END;
CREATE TRIGGER IF NOT EXISTS sandbox_provider_immutable
BEFORE UPDATE ON sandbox_provider_records
BEGIN SELECT RAISE(ABORT,'sandbox_provider_receipt_immutable'); END;
CREATE TRIGGER IF NOT EXISTS sandbox_provider_no_delete
BEFORE DELETE ON sandbox_provider_records
BEGIN SELECT RAISE(ABORT,'sandbox_provider_receipt_no_delete'); END;
