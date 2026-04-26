-- ============================================
-- website_tasks — queue for Claude Code to pick up when Curtis is back at PC.
-- He dictates these via the diary chat ("website: fix the dashboard layout"),
-- they land here as 'queued', Claude Code marks 'in_progress' / 'done'.
-- Idempotent: safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS website_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','in_progress','done','wont_do')),
  priority     INT  NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  notes        TEXT,                  -- Claude Code annotations during work
  pr_url       TEXT,                  -- link to resulting PR
  -- 'primebroth' = the PrimalPantry e-commerce site (website mode in chat).
  -- 'oso-ckf'    = this app (system update mode in chat).
  repo         TEXT NOT NULL DEFAULT 'oso-ckf'
                 CHECK (repo IN ('primebroth','oso-ckf')),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing-DB migration (safe re-run). For deployments that already have
-- website_tasks without the repo column.
ALTER TABLE website_tasks
  ADD COLUMN IF NOT EXISTS repo TEXT NOT NULL DEFAULT 'oso-ckf';
ALTER TABLE website_tasks
  DROP CONSTRAINT IF EXISTS website_tasks_repo_check;
ALTER TABLE website_tasks
  ADD CONSTRAINT website_tasks_repo_check CHECK (repo IN ('primebroth','oso-ckf'));

CREATE INDEX IF NOT EXISTS idx_website_tasks_user_status
  ON website_tasks(user_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_website_tasks_user_recent
  ON website_tasks(user_id, updated_at DESC);

-- Reuse the existing updated_at trigger.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_website_tasks_updated_at'
  ) THEN
    CREATE TRIGGER trg_website_tasks_updated_at
      BEFORE UPDATE ON website_tasks
      FOR EACH ROW EXECUTE FUNCTION ckf_set_updated_at();
  END IF;
END $$;

ALTER TABLE website_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_full_access" ON website_tasks;
CREATE POLICY "service_full_access" ON website_tasks FOR ALL USING (true) WITH CHECK (true);
