-- ============================================
-- /agent — lightweight ad-script agent
-- One conversation thread, an approve-to-save flow, and a
-- learning loop so the agent improves with every approval.
-- Run AFTER supabase-ckf-schema.sql (depends on ckf_users).
-- ============================================

-- ── Conversations ──
-- Plain thread per user. No scopes, modes, or branching.
CREATE TABLE agent_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  title TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  last_message_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_agent_conv_user_recent ON agent_conversations(user_id, last_message_at DESC);

-- ── Messages ──
-- role: user | assistant. No tool role (this agent has no tools yet).
CREATE TABLE agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  tokens_in INT,
  tokens_out INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_agent_msg_conv_created ON agent_messages(conversation_id, created_at ASC);

-- ── Approved scripts ──
-- The "successful submissions". Captured the moment the user clicks Approve
-- on a draft. The brief is the user message that prompted the winning draft
-- (best-effort -- the most recent prior user message in the thread).
CREATE TABLE agent_approved_scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES agent_conversations(id) ON DELETE SET NULL,
  source_message_id UUID REFERENCES agent_messages(id) ON DELETE SET NULL,
  brief TEXT,
  script TEXT NOT NULL,
  approved_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_agent_approved_user_recent ON agent_approved_scripts(user_id, approved_at DESC);

-- ── Learnings ──
-- Short, durable notes about what works for Curtis's ad scripts. Extracted
-- by a follow-up Claude call right after each approval. Re-injected into the
-- system prompt on every future turn so taste compounds.
CREATE TABLE agent_learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  source_script_id UUID REFERENCES agent_approved_scripts(id) ON DELETE SET NULL,
  lesson TEXT NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_agent_learnings_user_active
  ON agent_learnings(user_id, created_at DESC)
  WHERE archived = false;

-- ── RLS ──
ALTER TABLE agent_conversations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_approved_scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_learnings        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_full_access" ON agent_conversations    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON agent_messages         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON agent_approved_scripts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON agent_learnings        FOR ALL USING (true) WITH CHECK (true);
