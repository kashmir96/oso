-- ============================================
-- CKF Goals — sort order column for manual reordering on the Manage page.
-- Run AFTER supabase-ckf-schema.sql.
-- ============================================

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

-- Backfill: assign sort_order so existing goals keep their current order
-- (most-recently-created first).
UPDATE goals g
   SET sort_order = sub.rn
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
      FROM goals
  ) sub
 WHERE g.id = sub.id AND g.sort_order = 0;

CREATE INDEX IF NOT EXISTS idx_goals_user_sort
  ON goals(user_id, sort_order ASC, created_at DESC);

NOTIFY pgrst, 'reload schema';
