-- ============================================
-- CKF Chat — additional schema for the AI chat interface.
-- Run AFTER supabase-ckf-schema.sql.
-- ============================================

-- ── Conversations ──
CREATE TABLE ckf_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  title TEXT,
  -- "primary mode" hint inferred from chat. Optional UI override; AI also picks
  -- mid-conversation as needed. Values: therapist, business, pt, spiritual, mixed.
  primary_mode TEXT DEFAULT 'therapist' CHECK (primary_mode IN ('therapist','business','pt','spiritual','mixed')),
  -- Tracks the NZ date when the chat was started — lets us find/open "today's chat" cheaply.
  nz_date DATE NOT NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  last_message_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ckf_conversations_user_recent ON ckf_conversations(user_id, last_message_at DESC);
CREATE INDEX idx_ckf_conversations_user_date ON ckf_conversations(user_id, nz_date DESC);

-- ── Messages ──
-- role = 'user' | 'assistant' | 'tool'
-- content_text is the plain user-readable text. content_blocks stores the full
-- Anthropic content array (text + tool_use + tool_result blocks) so the
-- conversation can be replayed back to the model on the next turn.
CREATE TABLE ckf_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ckf_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
  content_text TEXT,
  content_blocks JSONB DEFAULT '[]'::jsonb,
  tokens_in INT,
  tokens_out INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ckf_messages_conv_created ON ckf_messages(conversation_id, created_at ASC);

-- ── Long-term memory ──
-- Claude calls remember() when it learns something durable about Curtis. These
-- facts are re-injected into the system prompt on every turn so context builds
-- across sessions without bloating each request.
CREATE TABLE ckf_memory_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ckf_users(id) ON DELETE CASCADE,
  fact TEXT NOT NULL,
  topic TEXT,                  -- optional cluster: 'training', 'business', 'family', 'sleep', etc.
  importance INT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  source_message_id UUID REFERENCES ckf_messages(id) ON DELETE SET NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ckf_memory_user_active ON ckf_memory_facts(user_id, archived, importance DESC, created_at DESC);
CREATE INDEX idx_ckf_memory_topic ON ckf_memory_facts(user_id, topic) WHERE archived = false;

-- ── RLS ──
ALTER TABLE ckf_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ckf_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ckf_memory_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_full_access" ON ckf_conversations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON ckf_messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON ckf_memory_facts FOR ALL USING (true) WITH CHECK (true);
