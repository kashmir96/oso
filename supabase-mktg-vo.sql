-- ============================================
-- mktg_drafts — voiceover columns + public mktg-vo storage bucket.
--
-- voiceover_storage_path : path inside the mktg-vo bucket (relative)
-- voiceover_voice_id     : ElevenLabs voice id used for the rendering
-- voiceover_label        : free-text label so Curtis can name the VO row
--                          in the Settings library (defaults to draft objective)
-- voiceover_generated_at : timestamp of last successful render
--
-- Storage: a NEW public bucket `mktg-vo`. Public so the resulting MP3 URL is
-- permanently shareable (the team/contractor opens it directly to download —
-- same model as the trainer-share link). The MP3 contains an ad script that
-- will be in a public Meta ad anyway, so secrecy is not the concern.
--
-- Idempotent: safe to re-run.
-- ============================================

ALTER TABLE mktg_drafts ADD COLUMN IF NOT EXISTS voiceover_storage_path TEXT;
ALTER TABLE mktg_drafts ADD COLUMN IF NOT EXISTS voiceover_voice_id     TEXT;
ALTER TABLE mktg_drafts ADD COLUMN IF NOT EXISTS voiceover_label        TEXT;
ALTER TABLE mktg_drafts ADD COLUMN IF NOT EXISTS voiceover_generated_at TIMESTAMPTZ;

-- Bucket creation. INSERT … ON CONFLICT keeps it idempotent.
INSERT INTO storage.buckets (id, name, public)
VALUES ('mktg-vo', 'mktg-vo', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- RLS policy: the service role bypasses RLS so the netlify function can
-- upload/delete. We add a permissive read policy so any browser can GET
-- the public URL — that's what "public bucket" means functionally.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='mktg_vo_public_read'
  ) THEN
    CREATE POLICY mktg_vo_public_read
      ON storage.objects FOR SELECT
      USING (bucket_id = 'mktg-vo');
  END IF;
END$$;
