-- Deploy failure tracking for deploy-alert scheduled function
-- Run this in Supabase SQL Editor

CREATE TABLE deploy_failures (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_key    text NOT NULL,
  site_name   text NOT NULL,
  deploy_id   text NOT NULL,
  error_message text DEFAULT '',
  failed_at   timestamptz NOT NULL,
  alerted     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_deploy_failures_site ON deploy_failures (site_key);

ALTER TABLE deploy_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_full_access" ON deploy_failures
  FOR ALL USING (true) WITH CHECK (true);
