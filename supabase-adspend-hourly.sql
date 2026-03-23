-- Hourly adspend snapshots for pace chart
-- Stores incremental spend per hour from FB + Google APIs
-- Auto-cleanup: rows older than 14 days

CREATE TABLE IF NOT EXISTS adspend_hourly (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  hour INTEGER NOT NULL CHECK (hour >= 0 AND hour <= 23),
  source TEXT NOT NULL CHECK (source IN ('facebook', 'google')),
  cumulative_spend NUMERIC(10,2) NOT NULL DEFAULT 0,
  hourly_spend NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, hour, source)
);

CREATE INDEX idx_adspend_hourly_date ON adspend_hourly(date);

-- Auto-cleanup: delete rows older than 14 days
-- Run this as a pg_cron job or call periodically
-- DELETE FROM adspend_hourly WHERE date < CURRENT_DATE - INTERVAL '14 days';
