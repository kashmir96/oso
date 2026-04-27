-- ===========================================================================
-- Creative-agent — assistant queue states + production fields (v1.0.5).
--
-- Curtis pivoted the UX: the Creative pipeline runs as a conversation in the
-- business chat (not a stage-walker page). After he approves the AI output,
-- chat asks "Proceed to Assistant?" -- yes routes the creative into the
-- existing production queue (Assistant page). For that to work, mktg_creatives
-- needs the same production states + fields the legacy mktg_drafts table has.
--
-- Status enum extended: drafted -> user_approved -> submitted -> in_production
--                       -> needs_approval -> (back to user_approved or
--                       in_production) -> shipped -> performed.
-- user_rejected stays as the dead-end branch from drafted.
--
-- Idempotent.
-- ===========================================================================

INSERT INTO mktg_schema_versions (schema_version, changelog)
VALUES ('1.0.5', 'Extend mktg_creatives status enum (submitted/in_production/needs_approval) and add production-handoff columns.')
ON CONFLICT (schema_version) DO NOTHING;

ALTER TABLE mktg_creatives
  DROP CONSTRAINT IF EXISTS mktg_creatives_status_check;
ALTER TABLE mktg_creatives
  ADD CONSTRAINT mktg_creatives_status_check
  CHECK (status IN (
    'drafted', 'user_approved', 'user_rejected',
    'submitted', 'in_production', 'needs_approval',
    'shipped', 'performed'
  ));

ALTER TABLE mktg_creatives ADD COLUMN IF NOT EXISTS submitted_at         TIMESTAMPTZ;
ALTER TABLE mktg_creatives ADD COLUMN IF NOT EXISTS approved_at          TIMESTAMPTZ;
ALTER TABLE mktg_creatives ADD COLUMN IF NOT EXISTS production_notes     TEXT;
ALTER TABLE mktg_creatives ADD COLUMN IF NOT EXISTS production_asset_url TEXT;
ALTER TABLE mktg_creatives ADD COLUMN IF NOT EXISTS approval_notes       TEXT;

CREATE INDEX IF NOT EXISTS idx_mktg_creatives_submitted_at
  ON mktg_creatives(submitted_at DESC) WHERE status IN ('submitted','in_production','needs_approval');
