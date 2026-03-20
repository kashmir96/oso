-- ============================================
-- Manufacturing Batches Schema
-- Run this in the Supabase SQL Editor
-- ============================================

CREATE TABLE manufacturing_batches (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  production_date date        NOT NULL,
  product_sku   text        NOT NULL,
  quantity      int         NOT NULL,
  batch_no      text        NOT NULL,
  expiry_date   date        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mfg_created ON manufacturing_batches (created_at DESC);
CREATE INDEX idx_mfg_batch   ON manufacturing_batches (batch_no);

-- RLS: allow read/write for authenticated anon key (same pattern as other tables)
ALTER TABLE manufacturing_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access" ON manufacturing_batches
  FOR ALL USING (true) WITH CHECK (true);
