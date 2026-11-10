-- P1-C: non-destructive user identity and idempotent monitor sync.
-- Existing operator-owned monitors remain unchanged. Never auto-adopt old records.
CREATE TABLE IF NOT EXISTS user_identities (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(issuer, subject)
);

ALTER TABLE monitors ADD COLUMN client_draft_id TEXT;
ALTER TABLE monitors ADD COLUMN sync_request_digest TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS monitors_owner_draft_unique
  ON monitors(owner_id, client_draft_id)
  WHERE client_draft_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS monitors_owner_recent
  ON monitors(owner_id, created_at DESC, id DESC);
