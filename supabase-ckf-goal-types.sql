-- ============================================
-- CKF Goals — add type variants for checkbox / streak / restraint goals.
-- Run AFTER supabase-ckf-schema.sql.
-- ============================================
--
-- goal_type:
--   'numeric'   — existing behaviour: manual value entry, current/target/unit
--   'checkbox'  — tap to tick once per day; current_value is the streak count.
--                 Streak rule: if last_completed_at = yesterday and user ticks
--                 today, streak += 1. If gap > 1 day, streak resets to 1.
--   'restraint' — default ticks up daily. current_value = days since
--                 streak_started_at (derived). On "log fail", streak_started_at
--                 jumps to today and current_value resets to 0.
--
-- For checkbox: last_completed_at tracks the day last marked done.
-- For restraint: streak_started_at tracks when the current run began.
-- ============================================

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS goal_type TEXT NOT NULL DEFAULT 'numeric'
    CHECK (goal_type IN ('numeric','checkbox','restraint'));

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS streak_started_at DATE;

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS last_completed_at DATE;

NOTIFY pgrst, 'reload schema';
