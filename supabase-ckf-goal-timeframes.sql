-- ============================================
-- CKF Goals — timeframe windows + aggregation + backdating support.
-- Run AFTER supabase-ckf-schema.sql.
-- ============================================
--
-- timeframe — when the running value resets:
--   'lifetime'  (default) — never resets; current_value tracks toward target
--   'daily'               — resets each NZ day
--   'weekly'              — resets each Monday NZ
--   'monthly'             — resets on the 1st NZ
--
-- aggregate — how multiple logs within a window combine:
--   'last'  (default) — most recent log's value
--   'sum'             — sum of values (e.g. calories per day)
--   'count'           — count of logs (e.g. training sessions per week)
--   'avg'             — average of values
--
-- goal_logs.for_date — the day a value is FOR (not when it was logged).
-- Backdating works by passing for_date < today when logging.
-- ============================================

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS timeframe TEXT NOT NULL DEFAULT 'lifetime'
    CHECK (timeframe IN ('lifetime','daily','weekly','monthly'));

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS aggregate TEXT NOT NULL DEFAULT 'last'
    CHECK (aggregate IN ('last','sum','count','avg'));

ALTER TABLE goal_logs
  ADD COLUMN IF NOT EXISTS for_date DATE;

-- Backfill: for_date = created_at::date for existing rows.
UPDATE goal_logs
   SET for_date = created_at::date
 WHERE for_date IS NULL;

-- Useful index for window queries.
CREATE INDEX IF NOT EXISTS idx_goal_logs_goal_for_date
  ON goal_logs(goal_id, for_date DESC);

NOTIFY pgrst, 'reload schema';
