-- ============================================
-- CKF Integrations — OAuth tokens + provider-specific tables.
-- Run AFTER supabase-ckf-schema.sql.
-- ============================================

-- Token storage for any third-party OAuth integration.
-- One row per (user_id, provider). Service-key access only.
CREATE TABLE ckf_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('whoop','google_calendar')),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  scope TEXT,
  external_user_id TEXT,
  oauth_state TEXT,
  state_created_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX idx_ckf_integrations_user ON ckf_integrations(user_id);

-- Per-day Whoop metrics. Sync function upserts (user_id, date).
CREATE TABLE whoop_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  date DATE NOT NULL,                     -- the day the metrics describe (NZ date)
  recovery_score NUMERIC,                 -- 0..100
  hrv_rmssd_ms NUMERIC,
  resting_heart_rate NUMERIC,
  strain NUMERIC,                         -- 0..21
  sleep_performance NUMERIC,              -- 0..100
  sleep_hours NUMERIC,
  sleep_efficiency NUMERIC,
  raw JSONB,
  pulled_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX idx_whoop_metrics_user_date ON whoop_metrics(user_id, date DESC);

-- RLS — service role only (matches the rest of the repo).
ALTER TABLE ckf_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whoop_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_full_access" ON ckf_integrations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON whoop_metrics FOR ALL USING (true) WITH CHECK (true);

-- updated_at trigger for ckf_integrations
CREATE TRIGGER trg_ckf_integrations_updated_at BEFORE UPDATE ON ckf_integrations
  FOR EACH ROW EXECUTE FUNCTION ckf_set_updated_at();

NOTIFY pgrst, 'reload schema';
