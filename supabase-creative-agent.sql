-- ===========================================================================
-- PrimalPantry Creative Agent — canonical schema (v1.0.0).
--
-- Implements §3 of primalpantry_creative_agent_schema.md as a set of new
-- mktg_* tables. Additive — does NOT touch the existing mktg_drafts /
-- mktg_concepts / mktg_ads / etc. tables. The cutover happens later, after
-- the Block 5 vertical slice is validated against real briefs.
--
-- Idempotent: safe to re-run.
--
-- Conventions:
--   • Singletons enforced via id='singleton' + CHECK constraint.
--   • State-machine validity is enforced in app code (_lib/mktg-lifecycle.js)
--     because Postgres CHECK constraints can't see prior state. The DB only
--     enforces the enum domain + required-by-status invariants for fields
--     that must be present at insert time (e.g. brief on drafted).
--   • pgvector dimension: 1536 (OpenAI text-embedding-3-small). Swap by
--     re-creating the column with a different vector(N) if you change models.
-- ===========================================================================

-- pgvector for semantic retrieval.
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Schema versioning ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mktg_schema_versions (
  schema_version TEXT PRIMARY KEY,
  applied_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  changelog      TEXT NOT NULL
);

INSERT INTO mktg_schema_versions (schema_version, changelog)
VALUES ('1.0.0', 'Initial creative-agent canonical schema (creatives, reviews, pain_points, social_proof, playbook_patterns, brand_seed, current_brand_facts, pgvector)')
ON CONFLICT (schema_version) DO NOTHING;

-- ─── 3.7 brand_seed (singleton + versioning) ────────────────────────────────
CREATE TABLE IF NOT EXISTS mktg_brand_seed (
  id          TEXT PRIMARY KEY DEFAULT 'singleton'
              CHECK (id = 'singleton'),
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT,
  content_md  TEXT NOT NULL DEFAULT '',
  changelog   JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- ─── current_brand_facts (singleton; price, location, team, customers, etc.) ─
-- Patch #1 from the pipeline_run worked example. Stats are split out from
-- social_proof so they can be referenced by any stage without traversing
-- proof records. social_proof carries quotable proofs (press, reviews,
-- endorsements); current_brand_facts carries the bare facts (numbers).
CREATE TABLE IF NOT EXISTS mktg_current_brand_facts (
  id              TEXT PRIMARY KEY DEFAULT 'singleton'
                  CHECK (id = 'singleton'),
  facts           JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT
);

-- Seed an empty singleton so retrieval never returns null. Real data filled
-- by ETL (Block 2) and operator edits.
INSERT INTO mktg_brand_seed (id, version, content_md, changelog)
VALUES ('singleton', 1, '', '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mktg_current_brand_facts (id, facts)
VALUES ('singleton', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ─── 3.1 creatives (unified ad + video_script) ──────────────────────────────
CREATE TABLE IF NOT EXISTS mktg_creatives (
  creative_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- user_id NULL = global brand asset (matches existing mktg_ads / mktg_concepts pattern).
  -- A non-null value scopes the row to a specific operator if multi-tenant ever lands.
  user_id                  UUID REFERENCES ckf_users(id) ON DELETE CASCADE,
  creative_type            TEXT NOT NULL CHECK (creative_type IN ('ad','video_script')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- brief: §3.1 brief object stored as JSONB. NOT NULL once status reaches
  -- drafted; we permit NULL only during pre-drafted intake (rare).
  brief                    JSONB,

  exemplars_used           JSONB NOT NULL DEFAULT '[]'::jsonb,
  playbook_patterns_used   JSONB NOT NULL DEFAULT '[]'::jsonb,

  components               JSONB,             -- §3.1 components object
  pattern_tags             JSONB NOT NULL DEFAULT '[]'::jsonb,

  status                   TEXT NOT NULL DEFAULT 'drafted'
                           CHECK (status IN ('drafted','user_approved','user_rejected','shipped','performed')),
  approval_reason          TEXT,
  user_edits_diff          TEXT,
  feedback_analysis        JSONB,             -- §3.6

  performance              JSONB,             -- §3.1 performance object
  shipped_at               TIMESTAMPTZ,
  performed_at             TIMESTAMPTZ,

  generalizable            BOOLEAN NOT NULL DEFAULT TRUE,
  generalization_caveat    TEXT,

  -- semantic retrieval
  embedding                vector(1536),
  embedding_model          TEXT,              -- 'text-embedding-3-small' etc — for cache busting on model change

  -- legacy ETL provenance — what historical row this came from.
  -- Populated by Block 2; stays null for in-app generations.
  source_csv               TEXT,
  source_row_hash          TEXT UNIQUE,       -- enforces idempotent ETL

  -- Required-by-status invariants. The state-machine enforces full transitions
  -- in app code, but these in-DB checks are belt-and-braces for fields that
  -- MUST exist by the time a status is set.
  CONSTRAINT mktg_creatives_drafted_has_brief
    CHECK (status <> 'drafted' OR brief IS NOT NULL),
  CONSTRAINT mktg_creatives_drafted_has_components
    CHECK (status <> 'drafted' OR components IS NOT NULL),
  CONSTRAINT mktg_creatives_approved_has_reason
    CHECK (status <> 'user_approved' OR (approval_reason IS NOT NULL OR feedback_analysis IS NOT NULL)),
  CONSTRAINT mktg_creatives_rejected_has_feedback
    CHECK (status <> 'user_rejected' OR feedback_analysis IS NOT NULL),
  CONSTRAINT mktg_creatives_shipped_has_timestamp
    CHECK (status <> 'shipped' OR shipped_at IS NOT NULL),
  CONSTRAINT mktg_creatives_performed_has_metrics
    CHECK (status <> 'performed' OR performance IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_mktg_creatives_user      ON mktg_creatives(user_id);
CREATE INDEX IF NOT EXISTS idx_mktg_creatives_type      ON mktg_creatives(creative_type);
CREATE INDEX IF NOT EXISTS idx_mktg_creatives_status    ON mktg_creatives(status);
CREATE INDEX IF NOT EXISTS idx_mktg_creatives_general   ON mktg_creatives(generalizable);
CREATE INDEX IF NOT EXISTS idx_mktg_creatives_perf_pct  ON mktg_creatives(((performance->>'percentile_within_account')::numeric))
  WHERE status = 'performed';
-- IVFFlat on embedding for fast cosine search. Lists tuned conservatively;
-- bump to ~sqrt(rows) once corpus stabilises.
CREATE INDEX IF NOT EXISTS idx_mktg_creatives_embedding
  ON mktg_creatives USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- ─── 3.2 reviews ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mktg_reviews (
  review_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  source                 TEXT NOT NULL CHECK (source IN ('trustpilot','shopify','email','dm','other')),
  captured_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  rating                 NUMERIC,
  raw_text               TEXT NOT NULL,
  verbatim_phrases       JSONB NOT NULL DEFAULT '[]'::jsonb,
  pain_points_referenced JSONB NOT NULL DEFAULT '[]'::jsonb,
  products_referenced    JSONB NOT NULL DEFAULT '[]'::jsonb,
  audience_segment       TEXT,
  usable_for_social_proof BOOLEAN NOT NULL DEFAULT TRUE,
  consent_to_quote       BOOLEAN NOT NULL DEFAULT FALSE,
  embedding              vector(1536),
  embedding_model        TEXT,
  source_csv             TEXT,
  source_row_hash        TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_mktg_reviews_user   ON mktg_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_mktg_reviews_source ON mktg_reviews(source);
CREATE INDEX IF NOT EXISTS idx_mktg_reviews_embed
  ON mktg_reviews USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- ─── 3.3 pain_points ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mktg_pain_points (
  pain_point_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  description        TEXT NOT NULL,
  audience_segment   TEXT,
  frequency          INTEGER NOT NULL DEFAULT 0,
  example_phrasings  JSONB NOT NULL DEFAULT '[]'::jsonb,
  products_relevant  JSONB NOT NULL DEFAULT '[]'::jsonb,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  embedding          vector(1536),
  embedding_model    TEXT,
  source_csv         TEXT,
  source_row_hash    TEXT UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mktg_pain_user   ON mktg_pain_points(user_id);
CREATE INDEX IF NOT EXISTS idx_mktg_pain_active ON mktg_pain_points(active);
CREATE INDEX IF NOT EXISTS idx_mktg_pain_embed
  ON mktg_pain_points USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- ─── 3.4 social_proof ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mktg_social_proof (
  proof_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('review_quote','press_mention','stat','endorsement','award')),
  content      TEXT NOT NULL,
  source       TEXT,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  current      BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at   TIMESTAMPTZ,
  consent      BOOLEAN NOT NULL DEFAULT FALSE,
  source_csv   TEXT,
  source_row_hash TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_mktg_proof_user    ON mktg_social_proof(user_id);
CREATE INDEX IF NOT EXISTS idx_mktg_proof_type    ON mktg_social_proof(type);
CREATE INDEX IF NOT EXISTS idx_mktg_proof_current ON mktg_social_proof(current);

-- ─── 3.5 playbook_patterns ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mktg_playbook_patterns (
  pattern_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  pattern_type         TEXT NOT NULL CHECK (pattern_type IN (
                         'hook_archetype','composition','structure_template',
                         'palette_cluster','pacing_pattern',
                         'retention_drop_signature','anti_pattern')),
  name                 TEXT NOT NULL,
  description          TEXT NOT NULL,
  definition           JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_creative_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  performance_summary  JSONB NOT NULL DEFAULT '{}'::jsonb,
  audience_segments    JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_observed       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated         TIMESTAMPTZ NOT NULL DEFAULT now(),
  active               BOOLEAN NOT NULL DEFAULT FALSE,  -- gated by 6.4
  approved_by          TEXT,
  approved_at          TIMESTAMPTZ,
  deprecation_reason   TEXT,
  source_csv           TEXT,
  source_row_hash      TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_mktg_patterns_user   ON mktg_playbook_patterns(user_id);
CREATE INDEX IF NOT EXISTS idx_mktg_patterns_type   ON mktg_playbook_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_mktg_patterns_active ON mktg_playbook_patterns(active);

-- ─── primary_text bank (retrieval-time copy lookup) ─────────────────────────
-- Not its own first-class entity per the spec; minimal table so retrieval
-- can grep approved historical primary text without joining mktg_creatives.
CREATE TABLE IF NOT EXISTS mktg_primary_text_bank (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  text            TEXT NOT NULL,
  campaign_id     TEXT,
  notes           TEXT,
  embedding       vector(1536),
  embedding_model TEXT,
  source_csv      TEXT,
  source_row_hash TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mktg_ptb_user ON mktg_primary_text_bank(user_id);
CREATE INDEX IF NOT EXISTS idx_mktg_ptb_embed
  ON mktg_primary_text_bank USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
