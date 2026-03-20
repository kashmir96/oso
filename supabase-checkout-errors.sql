-- Run this in Supabase SQL editor
-- Stores checkout errors from primebroth for display in oso dashboard

CREATE TABLE checkout_errors (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  error_message   text NOT NULL,
  error_code      text DEFAULT '',
  error_type      text DEFAULT '',
  cart            text DEFAULT '[]',
  browser         text DEFAULT '',
  device          text DEFAULT '',
  os              text DEFAULT '',
  screen_width    int DEFAULT 0,
  country         text DEFAULT '',
  user_agent      text DEFAULT '',
  is_card_decline boolean DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE checkout_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access" ON checkout_errors
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_checkout_errors_created ON checkout_errors (created_at DESC);
