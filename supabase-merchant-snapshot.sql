-- Table to store the last known merchant product statuses for change detection
CREATE TABLE IF NOT EXISTS merchant_status_snapshot (
  id integer PRIMARY KEY DEFAULT 1,
  statuses jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now()
);

-- Ensure only one row exists
INSERT INTO merchant_status_snapshot (id, statuses) VALUES (1, '{}')
ON CONFLICT (id) DO NOTHING;
