-- ===========================================================================
-- mktg_customer_conversations (v1.0.9)
--
-- Central hub of every customer interaction we have on record: Intercom
-- threads, customer-service emails, Trustpilot / Shopify reviews, DMs.
-- Powers the new Customer Representative agent which lets Curtis ask:
--   - What are customers asking us to improve lately?
--   - What product ideas have customers given us?
--   - How do I answer this question from a customer?
--
-- Phase 1: ingest by CSV/JSON export (mktg-etl-style upload). Embeddings
-- generated lazily at import time. Phase 2 (later): real-time Intercom
-- webhook + auto-draft replies.
--
-- Idempotent.
-- ===========================================================================

INSERT INTO mktg_schema_versions (schema_version, changelog)
VALUES ('1.0.9', 'Add mktg_customer_conversations (intercom + email + review hub for the Customer Rep agent).')
ON CONFLICT (schema_version) DO NOTHING;

CREATE TABLE IF NOT EXISTS mktg_customer_conversations (
  conversation_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES ckf_users(id) ON DELETE CASCADE,
  -- Source
  source            TEXT NOT NULL CHECK (source IN ('intercom','email','trustpilot','shopify_review','google_review','dm','phone','contact_form','other')),
  external_id       TEXT,                          -- Intercom convo id, email Message-ID, review id, etc.
  external_url      TEXT,                          -- direct link back to source (Intercom UI, etc.)
  -- Customer identity
  customer_name     TEXT,
  customer_email    TEXT,
  customer_handle   TEXT,
  customer_country  TEXT,
  -- Timing
  started_at        TIMESTAMPTZ NOT NULL,
  last_message_at   TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  -- Classification
  topic_tags        JSONB NOT NULL DEFAULT '[]'::jsonb,
                    -- ['shipping','complaint','product_idea','question','praise','refund','allergy','eczema','dryness','price','restock']
  product_refs      JSONB NOT NULL DEFAULT '[]'::jsonb,
                    -- ['tallow-balm','shampoo-bar','reviana-day','reviana-eye-cream']
  sentiment         TEXT CHECK (sentiment IN ('positive','negative','neutral','mixed')),
  outcome           TEXT,
                    -- 'resolved','escalated','no_response','closed','refunded','replaced'
  message_count     INTEGER NOT NULL DEFAULT 1,
  -- Content
  raw_thread        TEXT NOT NULL,                  -- full conversation as a formatted transcript
  summary           TEXT,                           -- AI-generated 1-2 sentence summary
  question_asked    TEXT,                           -- canonical form of the question (if applicable)
  resolution        TEXT,                           -- what answered/resolved it (if applicable)
  -- Semantic retrieval
  embedding         vector(1536),
  embedding_model   TEXT,
  -- Provenance
  source_csv        TEXT,
  source_row_hash   TEXT UNIQUE,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mktg_cc_user      ON mktg_customer_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_mktg_cc_source    ON mktg_customer_conversations(source);
CREATE INDEX IF NOT EXISTS idx_mktg_cc_started   ON mktg_customer_conversations(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_mktg_cc_sentiment ON mktg_customer_conversations(sentiment);
-- GIN index for tag filters
CREATE INDEX IF NOT EXISTS idx_mktg_cc_topic_tags ON mktg_customer_conversations USING GIN(topic_tags);
CREATE INDEX IF NOT EXISTS idx_mktg_cc_product_refs ON mktg_customer_conversations USING GIN(product_refs);
-- Vector index (when corpus is large)
CREATE INDEX IF NOT EXISTS idx_mktg_cc_embedding
  ON mktg_customer_conversations USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
