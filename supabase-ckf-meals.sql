-- ============================================
-- CKF Meals — photo log with AI calorie estimates + trainer share links.
-- Run AFTER supabase-ckf-schema.sql.
-- ============================================
--
-- Two tables + one storage bucket:
--   ckf_meals          — one row per meal photo, AI estimates + manual overrides
--   ckf_meals_shares   — share tokens Curtis hands to his trainer (or anyone he picks)
--   bucket "ckf-meals" — public-read so the trainer page can render images
--                        without a signed URL roundtrip per image. URLs use
--                        unguessable UUIDs in the path.
--
-- AI vs manual: AI fields are written by ckf-meals-ai.js. Manual fields, if set,
-- override the AI estimate at display time. ai_log_to_goal_id (if set) auto-logs
-- the calorie value to a daily-sum calorie goal whenever the meal is saved.
-- ============================================

CREATE TABLE ckf_meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  meal_date DATE NOT NULL,
  meal_type TEXT CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
  image_url TEXT,                  -- public URL into Storage
  storage_path TEXT,               -- path within the ckf-meals bucket (for deletion)
  notes TEXT,
  -- AI estimates
  ai_label TEXT,
  ai_calories NUMERIC,
  ai_protein_g NUMERIC,
  ai_carbs_g NUMERIC,
  ai_fat_g NUMERIC,
  ai_ingredients JSONB DEFAULT '[]'::jsonb,
  ai_confidence TEXT CHECK (ai_confidence IN ('low','medium','high')),
  ai_raw JSONB,
  -- Manual overrides (NULL = use AI)
  manual_label TEXT,
  manual_calories NUMERIC,
  manual_protein_g NUMERIC,
  manual_carbs_g NUMERIC,
  manual_fat_g NUMERIC,
  manual_ingredients JSONB,
  -- Provenance
  source TEXT NOT NULL DEFAULT 'me' CHECK (source IN ('me','share')),
  share_id UUID,                    -- which share token uploaded it (if source='share')
  -- Optional auto-log target — if set, the calories value is logged to this goal
  log_to_goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ckf_meals_user_date ON ckf_meals(user_id, meal_date DESC, created_at DESC);

CREATE TABLE ckf_meals_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  share_token TEXT UNIQUE NOT NULL,  -- 32-char random; appears in the public URL
  label TEXT,                        -- e.g. "Trainer — Mike"
  expires_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ckf_meals_shares_token ON ckf_meals_shares(share_token) WHERE revoked = false;

ALTER TABLE ckf_meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ckf_meals_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_full_access" ON ckf_meals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON ckf_meals_shares FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER trg_ckf_meals_updated_at BEFORE UPDATE ON ckf_meals
  FOR EACH ROW EXECUTE FUNCTION ckf_set_updated_at();

-- ── Storage bucket ──
-- Public-read: image URLs are unguessable (UUID path). Public read lets the
-- trainer's browser render images without going through a Netlify function.
INSERT INTO storage.buckets (id, name, public)
  VALUES ('ckf-meals', 'ckf-meals', true)
  ON CONFLICT (id) DO UPDATE SET public = true;

-- Allow service role full access; anonymous read of objects only.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'ckf-meals service write'
  ) THEN
    CREATE POLICY "ckf-meals service write" ON storage.objects
      FOR ALL TO public USING (bucket_id = 'ckf-meals') WITH CHECK (bucket_id = 'ckf-meals');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
