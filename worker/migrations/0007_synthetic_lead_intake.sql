-- P2-B: synthetic-only typed intake and deterministic triage, no real user
-- contact information, provider connection, outbound requests or AI inference.
CREATE TABLE IF NOT EXISTS synthetic_leads (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user_identities(id),
  client_lead_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source='SYNTHETIC_FORM'),
  service_code TEXT NOT NULL CHECK(service_code IN ('EXHIBITION','INTERIOR','SIGNAGE')),
  budget_band TEXT NOT NULL CHECK(budget_band IN ('UNKNOWN','LOW','MID','HIGH')),
  days_to_deadline INTEGER NOT NULL CHECK(days_to_deadline BETWEEN 1 AND 365),
  priority TEXT NOT NULL CHECK(priority IN ('TIME_SENSITIVE','NEEDS_BUDGET','STANDARD_REVIEW')),
  reply_draft TEXT NOT NULL,
  input_digest TEXT NOT NULL CHECK(length(input_digest)=64),
  created_at INTEGER NOT NULL,
  UNIQUE(owner_id,client_lead_id)
);
CREATE INDEX IF NOT EXISTS synthetic_leads_owner_recent
  ON synthetic_leads(owner_id,created_at DESC,id DESC);
