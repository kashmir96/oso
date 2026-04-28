-- ===========================================================================
-- oso/biz — relax ckf_conversations.scope so each biz agent gets its own
-- thread (scope = 'biz_<slug>'). Existing personal/business scopes preserved.
--
-- Idempotent.
-- ===========================================================================

ALTER TABLE ckf_conversations
  DROP CONSTRAINT IF EXISTS ckf_conversations_scope_check;

ALTER TABLE ckf_conversations
  ADD CONSTRAINT ckf_conversations_scope_check
  CHECK (scope IN ('personal','business') OR scope LIKE 'biz\_%' ESCAPE '\');

CREATE INDEX IF NOT EXISTS idx_ckf_conversations_biz_scope
  ON ckf_conversations(user_id, scope, last_message_at DESC)
  WHERE scope LIKE 'biz\_%' ESCAPE '\';
