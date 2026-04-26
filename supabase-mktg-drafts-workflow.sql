-- ============================================
-- mktg_drafts — Phase 4 workflow expansion.
-- Adds: submitted/in_production/needs_approval/live to status enum,
--       production_notes / production_asset_url / approval_notes,
--       submitted_at / approved_at timestamps.
-- Idempotent: safe to re-run.
-- ============================================

ALTER TABLE mktg_drafts
  DROP CONSTRAINT IF EXISTS mktg_drafts_status_check;
ALTER TABLE mktg_drafts
  ADD CONSTRAINT mktg_drafts_status_check
  CHECK (status IN (
    'draft','submitted','in_production','needs_approval',
    'approved','live','shipped','archived'
  ));

ALTER TABLE mktg_drafts ADD COLUMN IF NOT EXISTS production_notes     TEXT;
ALTER TABLE mktg_drafts ADD COLUMN IF NOT EXISTS production_asset_url TEXT;
ALTER TABLE mktg_drafts ADD COLUMN IF NOT EXISTS approval_notes       TEXT;
ALTER TABLE mktg_drafts ADD COLUMN IF NOT EXISTS submitted_at         TIMESTAMPTZ;
ALTER TABLE mktg_drafts ADD COLUMN IF NOT EXISTS approved_at          TIMESTAMPTZ;
