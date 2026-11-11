-- P2-A: bounded synthetic-only approval intents, NO external provider dispatch.
-- Opt-in per authenticated, previously onboarded OIDC user. Additive migration.
CREATE TABLE IF NOT EXISTS synthetic_approval_intents (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user_identities(id),
  client_intent_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'SYNTHETIC_ONLY' CHECK(provider='SYNTHETIC_ONLY'),
  operation TEXT NOT NULL CHECK(operation='CREATE_CRM_LEAD'),
  target TEXT NOT NULL CHECK(target='synthetic-crm'),
  payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64),
  target_digest TEXT NOT NULL CHECK(length(target_digest)=64),
  lead_id TEXT NOT NULL,
  service_code TEXT NOT NULL CHECK(service_code IN ('EXHIBITION','INTERIOR','SIGNAGE')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','APPROVED_NO_DISPATCH','DENIED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  expires_at INTEGER NOT NULL,
  decided_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(owner_id,client_intent_id)
);
CREATE INDEX IF NOT EXISTS synthetic_approval_by_owner
  ON synthetic_approval_intents(owner_id,created_at DESC,id DESC);
