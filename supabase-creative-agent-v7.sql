-- ===========================================================================
-- Creative-agent — generated assets (v1.0.6).
--
-- Stores AI-generated images / videos / captions tied to a creative. Curtis
-- triggers generation from chat ("/image of a whipped balm jar...") or via
-- the Creative ResultCard's asset panel. Assets are public-bucket so the
-- editor can drag the URL into their video tool.
--
-- Phase 1 (this migration): images via OpenAI gpt-image-1.
-- Phase 2 (later): video via Gemini Veo (long-running -- needs polling).
-- Phase 3 (later): caption SRT/VTT via ElevenLabs STT on the VO.
--
-- Idempotent.
-- ===========================================================================

INSERT INTO mktg_schema_versions (schema_version, changelog)
VALUES ('1.0.6', 'Add mktg_generated_assets table + public mktg-assets bucket for AI-generated images/videos/captions.')
ON CONFLICT (schema_version) DO NOTHING;

CREATE TABLE IF NOT EXISTS mktg_generated_assets (
  asset_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES ckf_users(id) ON DELETE CASCADE,
  creative_id     UUID REFERENCES mktg_creatives(creative_id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('image','video','caption_srt','caption_vtt')),
  -- Provenance: which model + prompt produced this asset.
  provider        TEXT NOT NULL,                                       -- 'openai' | 'gemini' | 'elevenlabs'
  model           TEXT NOT NULL,                                       -- e.g. 'gpt-image-1', 'veo-2.0-generate-001'
  prompt          TEXT,
  seed_asset_id   UUID REFERENCES mktg_generated_assets(asset_id) ON DELETE SET NULL,  -- for image-to-image / image-to-video
  -- Storage: where the bytes live.
  storage_path    TEXT NOT NULL,                                       -- inside the mktg-assets bucket
  mime_type       TEXT NOT NULL,
  size_bytes      INTEGER,
  width           INTEGER,
  height          INTEGER,
  duration_sec    NUMERIC,                                             -- for video / audio
  -- Cost telemetry. Feeds the Health page.
  cost_usd        NUMERIC,
  status          TEXT NOT NULL DEFAULT 'ready'
                  CHECK (status IN ('pending','ready','failed','deleted')),
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ready_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mktg_assets_user      ON mktg_generated_assets(user_id);
CREATE INDEX IF NOT EXISTS idx_mktg_assets_creative  ON mktg_generated_assets(creative_id);
CREATE INDEX IF NOT EXISTS idx_mktg_assets_kind      ON mktg_generated_assets(kind);
CREATE INDEX IF NOT EXISTS idx_mktg_assets_created   ON mktg_generated_assets(created_at DESC);

-- Public bucket so the editor / production team can drag URLs into their
-- video tool the same way they do with mktg-vo voiceovers.
INSERT INTO storage.buckets (id, name, public)
VALUES ('mktg-assets', 'mktg-assets', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Permissive read policy for the public bucket (service role bypasses RLS
-- for writes; reads need an explicit policy when public=true).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='mktg_assets_public_read'
  ) THEN
    CREATE POLICY mktg_assets_public_read
      ON storage.objects FOR SELECT
      USING (bucket_id = 'mktg-assets');
  END IF;
END$$;
