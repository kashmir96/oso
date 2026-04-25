-- ============================================
-- CKF Second Brain — Schema
-- Personal dashboard for Curtis (cfairweather1996@gmail.com)
-- Run this once in the Supabase SQL Editor.
-- ============================================

-- ── 0. Auth: single-user table mirroring the staff-auth pattern ──
CREATE TABLE ckf_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  session_token TEXT,
  session_expires_at TIMESTAMPTZ,
  totp_secret TEXT,
  totp_enabled BOOLEAN DEFAULT false,
  must_change_password BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ckf_users_session ON ckf_users(session_token) WHERE session_token IS NOT NULL;

-- ── 1. Goals ──
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('personal','health','business','social','finance','marketing','other')),
  current_value NUMERIC,
  start_value NUMERIC,
  target_value NUMERIC,
  unit TEXT,
  direction TEXT NOT NULL DEFAULT 'higher_better' CHECK (direction IN ('higher_better','lower_better')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_goals_user_status ON goals(user_id, status);

-- ── 2. Goal logs (history for charts) ──
CREATE TABLE goal_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  value NUMERIC NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_goal_logs_goal_created ON goal_logs(goal_id, created_at DESC);

-- ── 3. Routine tasks ──
CREATE TABLE routine_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'personal' CHECK (category IN ('personal','health','business','social','finance','marketing','other')),
  linked_goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
  recurrence_rule TEXT NOT NULL DEFAULT 'daily',
  priority INT NOT NULL DEFAULT 3,
  estimated_minutes INT,
  assigned_to TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_routine_tasks_user_active ON routine_tasks(user_id, active);

-- ── 4. Daily task logs ──
CREATE TABLE daily_task_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  routine_task_id UUID NOT NULL REFERENCES routine_tasks(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','done','skipped')),
  note TEXT,
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, routine_task_id, date)
);

CREATE INDEX idx_daily_task_logs_user_date ON daily_task_logs(user_id, date DESC);

-- ── 5. Diary entries ──
CREATE TABLE diary_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  -- Personal reflection
  personal_good TEXT,
  personal_bad TEXT,
  wasted_time TEXT,
  time_saving_opportunities TEXT,
  eighty_twenty TEXT,
  simplify_tomorrow TEXT,
  social_reflection TEXT,
  personal_lessons TEXT,
  -- Self-understanding lenses
  physical_reflection TEXT,    -- body, energy, sleep, training
  mental_reflection TEXT,      -- focus, mood, mental load, stress
  spiritual_reflection TEXT,   -- purpose, alignment, presence, values
  growth_opportunities TEXT,   -- where could I grow / what did I avoid
  tomorrow_personal_tasks JSONB DEFAULT '[]'::jsonb,
  -- Business reflection
  business_wins TEXT,
  business_losses TEXT,
  business_activity TEXT,
  business_lessons TEXT,
  tomorrow_business_tasks JSONB DEFAULT '[]'::jsonb,
  marketing_objectives TEXT,
  delegation_notes TEXT,
  bottlenecks TEXT,
  change_tomorrow TEXT,
  -- AI outputs
  ai_summary TEXT,
  ai_actions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX idx_diary_entries_user_date ON diary_entries(user_id, date DESC);

-- ── 6. Routine suggestions (AI proposals awaiting approval) ──
CREATE TABLE routine_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('diary','weekly','ninety_day','manual')),
  source_id UUID,
  suggestion TEXT NOT NULL,
  reason TEXT,
  -- When approved, the system creates a routine_tasks row and stores its id here
  applied_routine_task_id UUID REFERENCES routine_tasks(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE INDEX idx_routine_suggestions_user_status ON routine_suggestions(user_id, status, created_at DESC);

-- ── 7. Weekly summaries ──
CREATE TABLE weekly_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  summary TEXT,
  wins TEXT,
  losses TEXT,
  bottlenecks TEXT,
  routine_suggestions TEXT,
  goal_progress_summary JSONB DEFAULT '{}'::jsonb,
  business_summary TEXT,
  personal_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, week_start)
);

CREATE INDEX idx_weekly_summaries_user_week ON weekly_summaries(user_id, week_start DESC);

-- ── 8. 90-day goals ──
CREATE TABLE ninety_day_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('personal','health','business','social','finance','marketing','other')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  target_outcome TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','abandoned')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ninety_day_goals_user_status ON ninety_day_goals(user_id, status);

-- ── 9. Monthly milestones ──
CREATE TABLE monthly_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ninety_day_goal_id UUID NOT NULL REFERENCES ninety_day_goals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  month_number INT NOT NULL CHECK (month_number BETWEEN 1 AND 3),
  title TEXT NOT NULL,
  target TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','missed')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_monthly_milestones_goal ON monthly_milestones(ninety_day_goal_id, month_number);

-- ── 10. Weekly actions ──
CREATE TABLE weekly_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ninety_day_goal_id UUID NOT NULL REFERENCES ninety_day_goals(id) ON DELETE CASCADE,
  monthly_milestone_id UUID REFERENCES monthly_milestones(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  week_number INT NOT NULL CHECK (week_number BETWEEN 1 AND 13),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','skipped')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_weekly_actions_goal_week ON weekly_actions(ninety_day_goal_id, week_number);

-- ── 11. Business tasks ──
CREATE TABLE business_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  objective TEXT,
  assigned_to TEXT,
  priority INT NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','blocked','cancelled')),
  due_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_business_tasks_user_status ON business_tasks(user_id, status, due_date);

-- ============================================
-- Triggers: keep updated_at fresh
-- ============================================
CREATE OR REPLACE FUNCTION ckf_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ckf_users_updated_at BEFORE UPDATE ON ckf_users
  FOR EACH ROW EXECUTE FUNCTION ckf_set_updated_at();
CREATE TRIGGER trg_goals_updated_at BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION ckf_set_updated_at();
CREATE TRIGGER trg_routine_tasks_updated_at BEFORE UPDATE ON routine_tasks
  FOR EACH ROW EXECUTE FUNCTION ckf_set_updated_at();
CREATE TRIGGER trg_diary_entries_updated_at BEFORE UPDATE ON diary_entries
  FOR EACH ROW EXECUTE FUNCTION ckf_set_updated_at();
CREATE TRIGGER trg_ninety_day_goals_updated_at BEFORE UPDATE ON ninety_day_goals
  FOR EACH ROW EXECUTE FUNCTION ckf_set_updated_at();
CREATE TRIGGER trg_business_tasks_updated_at BEFORE UPDATE ON business_tasks
  FOR EACH ROW EXECUTE FUNCTION ckf_set_updated_at();

-- ============================================
-- RLS — service role bypass; matches existing repo pattern.
-- All access is through Netlify functions using SUPABASE_SERVICE_KEY.
-- ============================================
ALTER TABLE ckf_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE routine_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_task_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE routine_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ninety_day_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_full_access" ON ckf_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON goals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON goal_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON routine_tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON daily_task_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON diary_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON routine_suggestions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON weekly_summaries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON ninety_day_goals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON monthly_milestones FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON weekly_actions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON business_tasks FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- Note: the ckf_users row is auto-seeded on first login by netlify/functions/ckf-auth.js
-- if (a) no user exists, AND (b) the email matches the hard-coded gate.
-- ============================================
