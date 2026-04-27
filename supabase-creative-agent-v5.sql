-- ===========================================================================
-- Creative-agent — voiceover columns on mktg_creatives (v1.0.4).
--
-- Mirrors the same fields already on mktg_drafts.voiceover_*. The new
-- creative-agent pipeline produces a final video-script row in
-- mktg_creatives; this lets the pipeline call mktg-vo to render an
-- ElevenLabs MP3 once the script is approved and stamp the result here.
--
-- Reuses the existing public mktg-vo bucket (created in
-- supabase-creative-agent-v3 via supabase-mktg-vo.sql) -- no new bucket.
--
-- Idempotent.
-- ===========================================================================

INSERT INTO mktg_schema_versions (schema_version, changelog)
VALUES ('1.0.4', 'Add voiceover_* columns to mktg_creatives (mirror of mktg_drafts).')
ON CONFLICT (schema_version) DO NOTHING;

ALTER TABLE mktg_creatives ADD COLUMN IF NOT EXISTS voiceover_storage_path TEXT;
ALTER TABLE mktg_creatives ADD COLUMN IF NOT EXISTS voiceover_voice_id     TEXT;
ALTER TABLE mktg_creatives ADD COLUMN IF NOT EXISTS voiceover_label        TEXT;
ALTER TABLE mktg_creatives ADD COLUMN IF NOT EXISTS voiceover_generated_at TIMESTAMPTZ;
