-- ============================================
-- CKF Diary — add the "off your chest" catch-all column.
-- Run AFTER supabase-ckf-schema.sql.
-- ============================================

ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS unfiltered TEXT;

NOTIFY pgrst, 'reload schema';
