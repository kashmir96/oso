-- Tests / Experiments tracking table
-- Run this in your Supabase SQL editor

CREATE TABLE tests (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'active',        -- active | paused | completed
  tab             text NOT NULL DEFAULT 'marketing',     -- marketing | website (which tab created it)
  metric          text NOT NULL,                          -- revenue | orders | conversion_rate | aov | cpa | roas | bounce_rate | page_views
  variant_a       text,                                   -- description of control
  variant_b       text,                                   -- description of challenger
  start_date      date NOT NULL,
  end_date        date,                                   -- review / end date
  notify_sms      boolean DEFAULT false,
  notify_phone    text,                                   -- phone number for SMS notification
  baseline_value  numeric(12,4),                          -- metric value at start
  current_value   numeric(12,4),                          -- latest metric value
  result_note     text,                                   -- conclusion / notes
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tests_status ON tests (status);
CREATE INDEX idx_tests_created ON tests (created_at DESC);

-- Allow public access (secured via dashboard-data.js proxy with token auth)
ALTER TABLE tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON tests FOR ALL USING (true) WITH CHECK (true);
