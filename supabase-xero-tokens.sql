-- Xero OAuth token storage
-- Run this in Supabase SQL editor before connecting Xero

CREATE TABLE IF NOT EXISTS xero_tokens (
  id            SERIAL PRIMARY KEY,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  tenant_id     TEXT NOT NULL,
  org_name      TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  connected_by  INTEGER REFERENCES staff(id),
  connected_at  TIMESTAMPTZ DEFAULT NOW(),
  oauth_state   TEXT,
  state_created TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
