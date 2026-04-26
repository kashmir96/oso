-- ============================================
-- mktg_drafts — feedback capture + trust priority.
-- Adds: feedback_analysis (jsonb) populated by generateFeedback at finalize,
--       chosen_variant / rejected_variant (text) for v1-vs-v2 picks,
--       user_edits_diff (text) free-form summary of what Curtis tweaked,
--       trust_priority (text high|medium|low) auto-inferred at step 3
--       to gate explicit trust levers in generation prompts.
-- Idempotent: safe to re-run.
-- ============================================

ALTER TABLE mktg_drafts ADD COLUMN IF NOT EXISTS feedback_analysis JSONB;
ALTER TABLE mktg_drafts ADD COLUMN IF NOT EXISTS chosen_variant    TEXT;
ALTER TABLE mktg_drafts ADD COLUMN IF NOT EXISTS rejected_variant  TEXT;
ALTER TABLE mktg_drafts ADD COLUMN IF NOT EXISTS user_edits_diff   TEXT;

ALTER TABLE mktg_drafts
  DROP CONSTRAINT IF EXISTS mktg_drafts_trust_priority_check;
ALTER TABLE mktg_drafts ADD COLUMN IF NOT EXISTS trust_priority TEXT;
ALTER TABLE mktg_drafts
  ADD CONSTRAINT mktg_drafts_trust_priority_check
  CHECK (trust_priority IS NULL OR trust_priority IN ('high','medium','low'));
