-- ===========================================================================
-- Creative-agent — telemetry + prompt versioning (v1.0.1).
--
-- Block 4 additions:
--   • mktg_agent_calls       — per-call telemetry (stage, envelope hash,
--                              raw output, validation result, latency, tokens,
--                              cost). Read by the self-audit job (§7.3).
--   • mktg_prompt_versions   — system prompt changelog. The agent service
--                              boots an assertion that the in-code prompt
--                              hash matches the latest row here; mismatches
--                              are bugs, not warnings (per Hard Requirement #8).
--
-- Idempotent.
-- ===========================================================================

INSERT INTO mktg_schema_versions (schema_version, changelog)
VALUES ('1.0.1', 'Add mktg_agent_calls (per-call telemetry) and mktg_prompt_versions (changelog).')
ON CONFLICT (schema_version) DO NOTHING;

-- ─── Per-call telemetry ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mktg_agent_calls (
  call_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES ckf_users(id) ON DELETE SET NULL,
  creative_id        UUID REFERENCES mktg_creatives(creative_id) ON DELETE SET NULL,
  stage              TEXT NOT NULL CHECK (stage IN (
                       'strategy','variants_ad','outline','hooks',
                       'draft','critique','feedback','playbook_extract')),
  prompt_version     TEXT NOT NULL,
  model              TEXT NOT NULL,
  envelope_hash      TEXT NOT NULL,            -- sha256 of the stringified envelope (for cache + audit)
  envelope_summary   JSONB,                    -- { exemplars_n, patterns_n, flags, brand_seed_full }
  raw_output         TEXT,                     -- raw model text (post-strip) — null on hard failure
  parsed_output      JSONB,                    -- validated parsed object (null if validation failed)
  validation_status  TEXT NOT NULL CHECK (validation_status IN ('ok','retry_ok','failed')),
  validation_error   TEXT,                     -- last Zod error (null if ok)
  retried            BOOLEAN NOT NULL DEFAULT FALSE,
  latency_ms         INTEGER,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cost_usd           NUMERIC,                  -- computed at log time from model price card
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mktg_agent_calls_creative  ON mktg_agent_calls(creative_id);
CREATE INDEX IF NOT EXISTS idx_mktg_agent_calls_stage     ON mktg_agent_calls(stage);
CREATE INDEX IF NOT EXISTS idx_mktg_agent_calls_created   ON mktg_agent_calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mktg_agent_calls_failed
  ON mktg_agent_calls(created_at DESC) WHERE validation_status = 'failed';

-- ─── System-prompt versioning + changelog ───────────────────────────────────
-- Per Hard Requirement #8: "no silent prompt growth. The system prompt is
-- versioned. Any change requires a version bump and a changelog entry."
-- The agent service asserts the in-code prompt hash matches the latest row;
-- mismatches throw at boot.
CREATE TABLE IF NOT EXISTS mktg_prompt_versions (
  version       TEXT PRIMARY KEY,              -- e.g. 'v1.0.0'
  prompt_hash   TEXT NOT NULL,                 -- sha256 of the full system prompt
  prompt_text   TEXT NOT NULL,                 -- exact prompt for forensic comparison
  changelog     TEXT NOT NULL,                 -- what changed vs prior version + why
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mktg_prompt_versions_created
  ON mktg_prompt_versions(created_at DESC);
