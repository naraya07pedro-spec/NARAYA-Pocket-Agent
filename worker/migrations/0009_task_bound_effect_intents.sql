-- P2-D: additive, task-bound synthetic approval and immutable effect intent.
-- Existing P2-A approvals stay legacy/inert (task_id=NULL) and CANNOT mint effects.
ALTER TABLE synthetic_approval_intents ADD COLUMN task_id TEXT REFERENCES task_runs(id);
ALTER TABLE synthetic_approval_intents ADD COLUMN task_input_digest TEXT;
ALTER TABLE synthetic_approval_intents ADD COLUMN task_version INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS synthetic_approval_single_task
  ON synthetic_approval_intents(owner_id,task_id) WHERE task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS synthetic_effect_intents (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user_identities(id),
  task_id TEXT NOT NULL REFERENCES task_runs(id),
  approval_id TEXT NOT NULL UNIQUE REFERENCES synthetic_approval_intents(id),
  provider TEXT NOT NULL CHECK(provider='SYNTHETIC_ONLY'),
  operation TEXT NOT NULL CHECK(operation='CREATE_CRM_LEAD'),
  target TEXT NOT NULL CHECK(target='synthetic-crm'),
  client_lead_id TEXT NOT NULL,
  service_code TEXT NOT NULL CHECK(service_code IN ('EXHIBITION','INTERIOR','SIGNAGE')),
  task_input_digest TEXT NOT NULL CHECK(length(task_input_digest)=64),
  task_version INTEGER NOT NULL CHECK(task_version>=1),
  payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64),
  target_digest TEXT NOT NULL CHECK(length(target_digest)=64),
  status TEXT NOT NULL DEFAULT 'AWAITING_APPROVAL'
    CHECK(status IN ('AWAITING_APPROVAL','APPROVED_NO_DISPATCH','DENIED')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  UNIQUE(owner_id,task_id),
  UNIQUE(owner_id,approval_id)
);
CREATE INDEX IF NOT EXISTS synthetic_effects_owner_recent
  ON synthetic_effect_intents(owner_id,created_at DESC,id DESC);

-- A task-linked approval can transition only when one exact bound inert
-- effect record exists with matching immutable hashes and task version.
-- A legacy approval (NULL task_id) does not invoke these triggers and never
-- acquires an effect row retroactively.
CREATE TRIGGER IF NOT EXISTS task_approval_before_decision
BEFORE UPDATE OF status ON synthetic_approval_intents
WHEN OLD.task_id IS NOT NULL AND NEW.status<>OLD.status
BEGIN
  SELECT CASE WHEN OLD.status<>'PENDING'
    OR NEW.status NOT IN ('APPROVED_NO_DISPATCH','DENIED')
    OR NOT EXISTS(
      SELECT 1 FROM synthetic_effect_intents e
      WHERE e.approval_id=OLD.id AND e.owner_id=OLD.owner_id
        AND e.task_id=OLD.task_id
        AND e.task_input_digest=OLD.task_input_digest
        AND e.task_version=OLD.task_version
        AND e.payload_digest=OLD.payload_digest
        AND e.target_digest=OLD.target_digest
        AND e.status='AWAITING_APPROVAL'
    ) THEN RAISE(ABORT,'task_effect_approval_binding_invalid') END;
END;

-- The effect state transition is atomic with the approval's single SQL
-- compare-and-swap update. No application-side two-write interval exists.
CREATE TRIGGER IF NOT EXISTS task_approval_after_decision
AFTER UPDATE OF status ON synthetic_approval_intents
WHEN OLD.task_id IS NOT NULL AND NEW.status<>OLD.status
BEGIN
  UPDATE synthetic_effect_intents SET status=NEW.status,decided_at=NEW.decided_at
  WHERE approval_id=NEW.id AND owner_id=NEW.owner_id AND task_id=NEW.task_id
    AND status='AWAITING_APPROVAL'
    AND payload_digest=NEW.payload_digest AND target_digest=NEW.target_digest;
  SELECT CASE WHEN changes()<>1 THEN
    RAISE(ABORT,'task_effect_decision_cas_invalid') END;
END;

-- Freeze immutable effect payload/target/owner/task/approval identity at
-- SQLite level even if future application code accidentally tries retargeting.
CREATE TRIGGER IF NOT EXISTS task_effect_no_retarget
BEFORE UPDATE OF owner_id,task_id,approval_id,provider,operation,target,
  client_lead_id,service_code,task_input_digest,task_version,payload_digest,
  target_digest,created_at ON synthetic_effect_intents
BEGIN
  SELECT RAISE(ABORT,'task_effect_immutable_payload');
END;
-- Never allow an effect row to be changed independently from an approval
-- decision. The above AFTER approval trigger changes approval first.
CREATE TRIGGER IF NOT EXISTS task_effect_no_unapproved_transition
BEFORE UPDATE OF status ON synthetic_effect_intents
WHEN NEW.status<>OLD.status
BEGIN
  SELECT CASE WHEN OLD.status<>'AWAITING_APPROVAL' OR
    NEW.status NOT IN ('APPROVED_NO_DISPATCH','DENIED') OR
    NOT EXISTS(
      SELECT 1 FROM synthetic_approval_intents a
      WHERE a.id=OLD.approval_id AND a.owner_id=OLD.owner_id
        AND a.task_id=OLD.task_id AND a.status=NEW.status
        AND a.payload_digest=OLD.payload_digest
        AND a.target_digest=OLD.target_digest
    ) THEN RAISE(ABORT,'task_effect_no_independent_transition') END;
END;
