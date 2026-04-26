-- ============================================
-- PrimalPantry Marketing Playbook — Supabase schema
-- Run AFTER supabase-ckf-schema.sql + supabase-ckf-chat-schema.sql.
-- Uses the existing ckf_users table for auth (single-user system, same login).
--
-- ID convention: most entities use a text primary key matching the seed-data
-- ids ("tallow-balm", "V1", "VS3", "tallow-D-emotional"). This keeps the
-- relationships legible and lets the seed loader upsert without ambiguity.
-- ============================================

-- ── Locked brand-level decisions (founder/customer-count/retail-status/etc.) ──
CREATE TABLE IF NOT EXISTS mktg_locked_decisions (
  key            TEXT PRIMARY KEY,
  value          TEXT NOT NULL,
  resolved_date  DATE NOT NULL,
  notes          TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Campaigns ──
CREATE TABLE IF NOT EXISTS mktg_campaigns (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  slug            TEXT,
  role_in_funnel  TEXT,
  description     TEXT,
  weekly_cadence  TEXT,
  domain_default  TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Products ──
CREATE TABLE IF NOT EXISTS mktg_products (
  id             TEXT PRIMARY KEY,
  campaign_id    TEXT REFERENCES mktg_campaigns(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  full_name      TEXT,
  tagline        TEXT,
  description    TEXT,
  price_from_nzd NUMERIC,
  variants       JSONB DEFAULT '[]'::jsonb,
  ingredients    JSONB DEFAULT '[]'::jsonb,
  size           TEXT,
  format         TEXT,
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','launching','limited_edition','discontinued')),
  url_slug       TEXT,
  notes          TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mktg_products_campaign ON mktg_products(campaign_id);

-- ── Trust signals ──
CREATE TABLE IF NOT EXISTS mktg_trust_signals (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  details     TEXT,
  applies_to  JSONB NOT NULL DEFAULT '[]'::jsonb, -- string[] of campaign ids or ["all"]
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Symptoms / pain points ──
CREATE TABLE IF NOT EXISTS mktg_symptoms (
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('condition','pain_point')),
  applies_to  JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Copy archetypes ──
CREATE TABLE IF NOT EXISTS mktg_copy_archetypes (
  id                                TEXT PRIMARY KEY,
  campaign_id                       TEXT REFERENCES mktg_campaigns(id) ON DELETE SET NULL,
  type_label                        TEXT,
  name                              TEXT NOT NULL,
  description                       TEXT,
  status                            TEXT NOT NULL DEFAULT 'tested'
                                       CHECK (status IN (
                                         'workhorse','efficient','top_revenue',
                                         'tested','library_proven','new','gap',
                                         'experimental','retired'
                                       )),
  example_body                      TEXT,
  structure                         TEXT,
  pairs_with_visual_archetype_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  pairs_with_video_opener_ids       JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes                             TEXT,
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mktg_copy_arch_campaign ON mktg_copy_archetypes(campaign_id);

-- ── Visual archetypes (V1..V26) ──
CREATE TABLE IF NOT EXISTS mktg_visual_archetypes (
  id                              TEXT PRIMARY KEY,
  name                            TEXT NOT NULL,
  description                     TEXT,
  used_by_ad_names                JSONB NOT NULL DEFAULT '[]'::jsonb,
  pairs_with_copy_archetype_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  vibe                            TEXT,
  notes                           TEXT,
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Video openers (VS1..VS5) ──
CREATE TABLE IF NOT EXISTS mktg_video_openers (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  description           TEXT,
  structure             TEXT,
  examples_by_campaign  JSONB NOT NULL DEFAULT '{}'::jsonb,
  best_for              JSONB NOT NULL DEFAULT '[]'::jsonb,
  length_words_min      INT,
  length_words_max      INT,
  best_formats          JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Concepts ──
CREATE TABLE IF NOT EXISTS mktg_concepts (
  id                     TEXT PRIMARY KEY,
  campaign_id            TEXT REFERENCES mktg_campaigns(id) ON DELETE SET NULL,
  name                   TEXT NOT NULL,
  copy_archetype_id      TEXT REFERENCES mktg_copy_archetypes(id) ON DELETE SET NULL,
  visual_archetype_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  video_opener_ids       JSONB NOT NULL DEFAULT '[]'::jsonb,
  status                 TEXT NOT NULL DEFAULT 'new'
                            CHECK (status IN (
                              'workhorse','top_revenue','efficient',
                              'tested','new','gap','retired'
                            )),
  performance            JSONB,
  ad_name_examples       JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes                  TEXT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mktg_concepts_campaign ON mktg_concepts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_mktg_concepts_status ON mktg_concepts(status);

-- ── Offers ──
CREATE TABLE IF NOT EXISTS mktg_offers (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  mechanic               TEXT,
  applies_to_campaigns   JSONB NOT NULL DEFAULT '[]'::jsonb,
  example_copy           TEXT,
  notes                  TEXT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Production scripts ──
CREATE TABLE IF NOT EXISTS mktg_production_scripts (
  id                TEXT PRIMARY KEY,
  campaign_id       TEXT REFERENCES mktg_campaigns(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  concept_ids       JSONB NOT NULL DEFAULT '[]'::jsonb,
  video_opener_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  length_words      INT,
  status            TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('production-ready','draft')),
  body              TEXT,
  notes             TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mktg_scripts_campaign ON mktg_production_scripts(campaign_id);

-- ── Ads ──
-- ad_id is the Meta ad id where present (e.g. "a:120243080793420193"); we
-- use it as the primary key when set so mktg-perf can upsert by it.
-- Rows without an ad_id (rare) get a synthetic key on insert.
CREATE TABLE IF NOT EXISTS mktg_ads (
  ad_id               TEXT PRIMARY KEY,
  ad_name             TEXT NOT NULL,
  campaign_id         TEXT REFERENCES mktg_campaigns(id) ON DELETE SET NULL,
  concept_id          TEXT REFERENCES mktg_concepts(id) ON DELETE SET NULL,
  creative_type       TEXT,
  format              TEXT CHECK (format IN ('static','video','carousel','reel','unknown')),
  title               TEXT,
  body                TEXT,
  call_to_action      TEXT,
  call_to_action_link TEXT,
  performance         JSONB,
  perf_synced_at      TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mktg_ads_campaign ON mktg_ads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_mktg_ads_concept ON mktg_ads(concept_id);

-- ── Hooks ──
CREATE TABLE IF NOT EXISTS mktg_hooks (
  id            TEXT PRIMARY KEY,
  text          TEXT NOT NULL,
  campaign_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  opener_style  TEXT,
  use           TEXT CHECK (use IN ('opener','reframe','social_proof','cta','tagline','stat')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Weekly batches ──
CREATE TABLE IF NOT EXISTS mktg_weekly_batches (
  week_starting  DATE PRIMARY KEY,
  briefing       JSONB NOT NULL DEFAULT '{}'::jsonb,
  topical_layers JSONB NOT NULL DEFAULT '[]'::jsonb,
  ad_slots       JSONB NOT NULL DEFAULT '[]'::jsonb,
  file_path      TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Uploads (Phase 2 — chat attaches images / pasted text / links to context) ──
-- kind: 'image' (Supabase storage path), 'screenshot', 'link', 'text', 'file'
-- target_*: optional pointer to which entity this upload supports
CREATE TABLE IF NOT EXISTS mktg_uploads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('image','screenshot','link','text','file')),
  storage_path    TEXT,            -- supabase storage path when binary
  mime_type       TEXT,
  url             TEXT,            -- external link when kind='link'
  text_body       TEXT,            -- pasted text when kind='text'
  caption         TEXT,            -- "what's good about this"
  tags            JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_table    TEXT,            -- 'mktg_ads' | 'mktg_concepts' | etc.
  target_id       TEXT,
  conversation_id UUID,            -- ties upload to the chat that ingested it
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mktg_uploads_user ON mktg_uploads(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mktg_uploads_target ON mktg_uploads(target_table, target_id);

-- ── Mktg chat (Phase 2 — separate namespace from CKF diary chat) ──
CREATE TABLE IF NOT EXISTS mktg_conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  title            TEXT,
  -- 'context' = freeform info-feeding chat; 'wizard' = ad creator stepper
  kind             TEXT NOT NULL DEFAULT 'context' CHECK (kind IN ('context','wizard')),
  active_campaign  TEXT REFERENCES mktg_campaigns(id) ON DELETE SET NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mktg_conversations_user_recent ON mktg_conversations(user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS mktg_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES mktg_conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
  content_text    TEXT,
  content_blocks  JSONB DEFAULT '[]'::jsonb,
  tokens_in       INT,
  tokens_out      INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mktg_messages_conv_created ON mktg_messages(conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS mktg_memory_facts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  fact              TEXT NOT NULL,
  topic             TEXT,
  importance        INT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  source_message_id UUID REFERENCES mktg_messages(id) ON DELETE SET NULL,
  archived          BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mktg_memory_user_active ON mktg_memory_facts(user_id, archived, importance DESC, created_at DESC);

-- ── Ad creator drafts (Phase 3 — Meta Ads wizard) ──
-- One row per wizard run. The wizard fills these fields step-by-step; on
-- finish the row holds everything the user needs to copy into Meta.
CREATE TABLE IF NOT EXISTS mktg_drafts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN (
                            'draft','submitted','in_production','needs_approval',
                            'approved','live','shipped','archived'
                          )),
  current_step          TEXT NOT NULL DEFAULT 'objective'
                          CHECK (current_step IN (
                            'objective','campaign','format','concept',
                            'creative','copy','final'
                          )),

  -- Step 1
  objective             TEXT,
  -- Step 2
  campaign_id           TEXT REFERENCES mktg_campaigns(id) ON DELETE SET NULL,
  -- Step 3
  format                TEXT CHECK (format IN ('static','video','carousel','reel')),
  audience_type         TEXT,
  landing_url           TEXT,
  -- Step 4
  selected_concept_id   TEXT REFERENCES mktg_concepts(id) ON DELETE SET NULL,
  recommended_concepts  JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{id, name, why}]
  -- Step 5 — creative output (shape varies by format)
  creative              JSONB,                              -- video: {timeline,vo_script,b_roll_shots,shot_list}; image: {visual_brief,image_prompts[]}
  -- Step 6 — primary text variants + final approved choice
  primary_text_v1       TEXT,
  primary_text_v2       TEXT,
  primary_text_final    TEXT,
  headline              TEXT,
  description           TEXT,
  cta                   TEXT,
  naming                TEXT,
  -- Mini-chat for in-step refinements
  conversation_id       UUID REFERENCES mktg_conversations(id) ON DELETE SET NULL,

  notes                 TEXT,
  -- Production handoff (Phase 4 — assistant produces the asset)
  production_notes      TEXT,
  production_asset_url  TEXT,
  approval_notes        TEXT,
  submitted_at          TIMESTAMPTZ,
  approved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mktg_drafts_user_recent ON mktg_drafts(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mktg_drafts_user_status ON mktg_drafts(user_id, status);

-- ── RLS — service-role only; the Netlify functions run with the service key
-- and gate access via the email check in _lib/ckf-guard.js ──
ALTER TABLE mktg_locked_decisions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_campaigns            ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_products             ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_trust_signals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_symptoms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_copy_archetypes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_visual_archetypes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_video_openers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_concepts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_offers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_production_scripts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_ads                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_hooks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_weekly_batches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_uploads              ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_memory_facts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mktg_drafts               ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'mktg_locked_decisions','mktg_campaigns','mktg_products','mktg_trust_signals',
    'mktg_symptoms','mktg_copy_archetypes','mktg_visual_archetypes','mktg_video_openers',
    'mktg_concepts','mktg_offers','mktg_production_scripts','mktg_ads','mktg_hooks',
    'mktg_weekly_batches','mktg_uploads','mktg_conversations','mktg_messages','mktg_memory_facts',
    'mktg_drafts'
  ] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "service_full_access" ON %I; '
      'CREATE POLICY "service_full_access" ON %I FOR ALL USING (true) WITH CHECK (true);',
      t, t
    );
  END LOOP;
END $$;
