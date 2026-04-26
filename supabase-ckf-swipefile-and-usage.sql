-- ============================================
-- CKF — Swipefile (personal knowledge base) + API usage tracking.
-- Run AFTER supabase-ckf-schema.sql.
-- ============================================

-- ── Swipefile ──
-- Trusted sources Curtis curates: notes, links, images, PDFs, audio.
-- AI references these first when answering. Each item carries optional
-- "why_it_matters" plus an importance to bias what bubbles to the top.
CREATE TABLE ckf_swipefile_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('note','link','image','document','audio')),
  title TEXT,
  source_text TEXT,                -- plain-text body / transcript / extracted text
  source_url TEXT,                 -- original URL for 'link'
  storage_path TEXT,               -- bucket path (image/document/audio)
  storage_url TEXT,
  category TEXT NOT NULL DEFAULT 'personal'
    CHECK (category IN ('personal','health','business','social','finance','marketing','other')),
  tags TEXT[] DEFAULT '{}'::text[],
  why_it_matters TEXT,             -- short explanation of why he trusts this source
  author TEXT,                     -- e.g. book author / podcast host
  importance INT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ckf_swipefile_user_active
  ON ckf_swipefile_items(user_id, archived, importance DESC, created_at DESC);

-- Full-text search over title + body + tags + why_it_matters.
CREATE INDEX idx_ckf_swipefile_fts ON ckf_swipefile_items USING gin (
  to_tsvector('english'::regconfig,
    coalesce(title,'') || ' ' ||
    coalesce(source_text,'') || ' ' ||
    coalesce(why_it_matters,'') || ' ' ||
    coalesce(array_to_string(tags, ' '), '')
  )
);

ALTER TABLE ckf_swipefile_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_full_access" ON ckf_swipefile_items FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER trg_ckf_swipefile_updated_at BEFORE UPDATE ON ckf_swipefile_items
  FOR EACH ROW EXECUTE FUNCTION ckf_set_updated_at();

-- Storage bucket for swipefile attachments — keep private (signed URLs);
-- only the owner views. We'll add a public flag = false and rely on signed
-- URLs from server side when surfacing.
INSERT INTO storage.buckets (id, name, public)
  VALUES ('ckf-swipefile', 'ckf-swipefile', false)
  ON CONFLICT (id) DO NOTHING;

-- ── API usage tracking ──
-- Every external API call (Anthropic, OpenAI Whisper, ElevenLabs) writes a
-- row here so the user can see token + dollar spend in Settings.
CREATE TABLE ckf_api_usage (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID REFERENCES ckf_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('anthropic','openai','elevenlabs')),
  action TEXT NOT NULL,            -- 'chat','auto_open','diary_summary','weekly','ninety','meal_vision','stt','tts'
  model TEXT,
  input_tokens INT,
  output_tokens INT,
  cache_read_tokens INT,
  cache_creation_tokens INT,
  audio_seconds NUMERIC,
  chars INT,
  cost_usd NUMERIC NOT NULL DEFAULT 0,
  occurred_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ckf_api_usage_user_time ON ckf_api_usage(user_id, occurred_at DESC);
CREATE INDEX idx_ckf_api_usage_provider_time ON ckf_api_usage(provider, occurred_at DESC);

ALTER TABLE ckf_api_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_full_access" ON ckf_api_usage FOR ALL USING (true) WITH CHECK (true);

-- ── Conversation scope ──
-- Split chat history per surface: 'personal' (Home) vs 'business' (Business tab).
-- Existing rows default to 'personal' so nothing is lost.
ALTER TABLE ckf_conversations
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'personal'
    CHECK (scope IN ('personal','business'));

-- Replace the today-lookup index with one keyed by (user, scope, nz_date).
DROP INDEX IF EXISTS idx_ckf_conversations_user_date;
CREATE INDEX IF NOT EXISTS idx_ckf_conversations_user_scope_date
  ON ckf_conversations(user_id, scope, nz_date DESC);

NOTIFY pgrst, 'reload schema';
