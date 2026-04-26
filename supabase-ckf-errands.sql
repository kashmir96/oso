-- ============================================
-- CKF Errands — quick to-dos with optional reminders.
-- Run AFTER supabase-ckf-schema.sql.
-- ============================================
--
-- Errand vs. reminder:
--   - Errand: a thing to do. May have a due_date (calendar-style).
--   - Reminder: an exact time to surface the errand. If remind_at is set,
--     the errand fires:
--       (a) as a modal on app open (when remind_at <= now and shown_at is null);
--       (b) as an SMS at remind_at (when sms_remind = true).
--
-- shown_at and sms_sent_at are write-once trackers used to avoid double-firing.
-- ============================================

CREATE TABLE ckf_errands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  -- Calendar-style "due by this day". Independent of remind_at.
  due_date DATE,
  -- Exact moment to fire the reminder (modal + optional SMS).
  remind_at TIMESTAMPTZ,
  sms_remind BOOLEAN NOT NULL DEFAULT false,
  priority INT NOT NULL DEFAULT 3,
  category TEXT NOT NULL DEFAULT 'personal'
    CHECK (category IN ('personal','health','business','social','finance','marketing','other')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','done','cancelled')),
  shown_at TIMESTAMPTZ,        -- when the modal was last shown for this errand
  sms_sent_at TIMESTAMPTZ,     -- when the SMS was sent
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ckf_errands_user_status ON ckf_errands(user_id, status, due_date NULLS LAST);
CREATE INDEX idx_ckf_errands_user_remind ON ckf_errands(user_id, remind_at) WHERE remind_at IS NOT NULL AND status = 'open';
CREATE INDEX idx_ckf_errands_pending_sms ON ckf_errands(remind_at) WHERE sms_remind = true AND sms_sent_at IS NULL AND status = 'open';

ALTER TABLE ckf_errands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_full_access" ON ckf_errands FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER trg_ckf_errands_updated_at BEFORE UPDATE ON ckf_errands
  FOR EACH ROW EXECUTE FUNCTION ckf_set_updated_at();

NOTIFY pgrst, 'reload schema';
