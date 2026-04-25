-- ============================================
-- CKF Goals — link a goal to an external data source.
-- Run AFTER supabase-ckf-schema.sql AND supabase-ckf-integrations.sql.
-- ============================================
--
-- data_source:
--   'manual'  (default) — current_value is set by the user / chat / UI
--   'whoop'              — current_value is overwritten daily by the Whoop sync,
--                          using the metric named in data_source_field
--
-- data_source_field (only when data_source != 'manual'):
--   For Whoop: one of recovery_score | hrv_rmssd_ms | resting_heart_rate
--              | strain | sleep_performance | sleep_hours | sleep_efficiency
-- ============================================

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS data_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (data_source IN ('manual','whoop'));

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS data_source_field TEXT;

NOTIFY pgrst, 'reload schema';
