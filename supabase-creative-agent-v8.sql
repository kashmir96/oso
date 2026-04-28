-- ===========================================================================
-- Creative-agent — long-running provider operations (v1.0.7).
--
-- Veo (Google's video model) is long-running -- a generation request returns
-- an operation name; the actual video appears 30-90s later when polled.
-- Add a column to track that operation so a cron can poll-and-fetch
-- without needing the client to keep a connection open.
--
-- Idempotent.
-- ===========================================================================

INSERT INTO mktg_schema_versions (schema_version, changelog)
VALUES ('1.0.7', 'Add provider_operation_id to mktg_generated_assets for Veo long-running ops + status=pending support.')
ON CONFLICT (schema_version) DO NOTHING;

ALTER TABLE mktg_generated_assets ADD COLUMN IF NOT EXISTS provider_operation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_mktg_assets_pending
  ON mktg_generated_assets(status, created_at)
  WHERE status = 'pending';
