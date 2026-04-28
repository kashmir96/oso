-- ===========================================================================
-- mktg_influencers + mktg_influencer_contracts (v1.0.8)
--
-- Registry of creators / influencers PrimalPantry has worked with or wants
-- to. Curtis seeds it via CSV/JSON; the influencer-brief agent reads from
-- it, adds to it (via add_influencer tool), and generates contract PDFs
-- linked back to a row.
--
-- Idempotent.
-- ===========================================================================

INSERT INTO mktg_schema_versions (schema_version, changelog)
VALUES ('1.0.8', 'Add mktg_influencers + mktg_influencer_contracts (registry + content-use agreements).')
ON CONFLICT (schema_version) DO NOTHING;

CREATE TABLE IF NOT EXISTS mktg_influencers (
  influencer_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES ckf_users(id) ON DELETE CASCADE,
  -- Identity
  name             TEXT NOT NULL,
  handle           TEXT,                                  -- @primaryhandle (no leading @)
  platform         TEXT NOT NULL CHECK (platform IN ('instagram','tiktok','youtube','shorts','threads','facebook','x','twitch','blog','other')),
  alt_handles      JSONB NOT NULL DEFAULT '[]'::jsonb,    -- [{platform, handle}, ...]
  -- Contact
  email            TEXT,
  phone            TEXT,
  agent_contact    TEXT,                                  -- if managed
  -- Audience metadata
  follower_count   INTEGER,
  audience_geo     TEXT,                                  -- 'NZ', 'AU/NZ', etc.
  audience_segment TEXT,                                  -- e.g. 'cold NZ women 28-55, eczema-mums'
  niche_tags       JSONB NOT NULL DEFAULT '[]'::jsonb,    -- ['eczema','mums','natural-skincare']
  -- Relationship state
  status           TEXT NOT NULL DEFAULT 'prospect'
                   CHECK (status IN ('prospect','contacted','sample_sent','active','churned','blocked')),
  rate_card_nzd    JSONB,                                 -- { post: 250, reel: 600, story: 100 } etc.
  notes            TEXT,
  last_contacted_at TIMESTAMPTZ,
  -- Provenance
  source           TEXT,                                  -- 'csv-seed', 'chat', 'manual', 'discovery-tool'
  source_row_hash  TEXT UNIQUE,                           -- idempotent CSV imports
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mktg_influencers_user      ON mktg_influencers(user_id);
CREATE INDEX IF NOT EXISTS idx_mktg_influencers_platform  ON mktg_influencers(platform);
CREATE INDEX IF NOT EXISTS idx_mktg_influencers_status    ON mktg_influencers(status);
CREATE INDEX IF NOT EXISTS idx_mktg_influencers_handle    ON mktg_influencers(handle);

-- Contracts: one per outreach / engagement. Stored as the rendered text
-- (so we have a permanent record even if the agent prompt drifts) plus a
-- structured payload for the variables (deliverables, dates, fee).
CREATE TABLE IF NOT EXISTS mktg_influencer_contracts (
  contract_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES ckf_users(id) ON DELETE CASCADE,
  influencer_id    UUID NOT NULL REFERENCES mktg_influencers(influencer_id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('content_use_agreement','paid_collaboration','ugc_purchase','sample_test','exclusivity_addendum')),
  -- Variables Curtis provided
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,    -- { deliverables, fee_nzd, exclusivity, usage_rights, term_months, ... }
  -- Rendered text (what the influencer signs)
  rendered_text    TEXT NOT NULL,
  rendered_html    TEXT,                                  -- optional HTML version for nicer email send
  -- State
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','sent','signed','declined','superseded','expired')),
  sent_at          TIMESTAMPTZ,
  signed_at        TIMESTAMPTZ,
  signed_by_name   TEXT,
  signature_method TEXT,                                  -- 'typed','docusign','reply-confirm'
  superseded_by_id UUID REFERENCES mktg_influencer_contracts(contract_id) ON DELETE SET NULL,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mktg_inf_contracts_user        ON mktg_influencer_contracts(user_id);
CREATE INDEX IF NOT EXISTS idx_mktg_inf_contracts_influencer  ON mktg_influencer_contracts(influencer_id);
CREATE INDEX IF NOT EXISTS idx_mktg_inf_contracts_status      ON mktg_influencer_contracts(status);
