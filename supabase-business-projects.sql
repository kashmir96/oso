-- ============================================
-- business_projects — group business tasks under big projects.
-- Run AFTER supabase-ckf-schema.sql.
-- Idempotent: safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS business_projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','paused','done','cancelled')),
  target_date DATE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_projects_user_recent ON business_projects(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_projects_user_status ON business_projects(user_id, status);

-- Tasks can optionally belong to a project. Existing standalone tasks stay
-- standalone (project_id NULL). When a project is deleted, its tasks become
-- standalone rather than being cascaded away.
ALTER TABLE business_tasks
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES business_projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_business_tasks_project ON business_tasks(project_id);

-- Reuse the existing updated_at trigger pattern.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_business_projects_updated_at'
  ) THEN
    CREATE TRIGGER trg_business_projects_updated_at
      BEFORE UPDATE ON business_projects
      FOR EACH ROW EXECUTE FUNCTION ckf_set_updated_at();
  END IF;
END $$;

-- RLS — service-role only, mirroring the rest of CKF.
ALTER TABLE business_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_full_access" ON business_projects;
CREATE POLICY "service_full_access" ON business_projects FOR ALL USING (true) WITH CHECK (true);
