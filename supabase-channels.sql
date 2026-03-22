-- Channels: Add multi-channel support to Comms
-- Run this in Supabase SQL Editor

-- 1. Add channel column to email_messages
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS channel text DEFAULT 'email';
CREATE INDEX IF NOT EXISTS idx_email_channel ON email_messages(channel);

-- 2. Meta sender profiles (Facebook PSID / Instagram IGSID → name)
CREATE TABLE IF NOT EXISTS meta_contacts (
  id serial PRIMARY KEY,
  platform text NOT NULL,
  platform_id text UNIQUE NOT NULL,
  name text DEFAULT '',
  profile_pic text DEFAULT '',
  customer_email text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE meta_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_full_access" ON meta_contacts FOR ALL USING (true) WITH CHECK (true);

-- 3. Reply macros (canned responses)
CREATE TABLE IF NOT EXISTS macros (
  id serial PRIMARY KEY,
  name text NOT NULL,
  content text NOT NULL,
  created_by int REFERENCES staff(id),
  created_at timestamptz DEFAULT now(),
  active boolean DEFAULT true
);
ALTER TABLE macros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_full_access" ON macros FOR ALL USING (true) WITH CHECK (true);

-- 4. Live chat sessions (for future website widget)
CREATE TABLE IF NOT EXISTS live_chat_sessions (
  id serial PRIMARY KEY,
  visitor_id text,
  visitor_name text DEFAULT 'Visitor',
  visitor_email text DEFAULT '',
  status text DEFAULT 'open',
  assigned_staff int REFERENCES staff(id),
  created_at timestamptz DEFAULT now(),
  closed_at timestamptz
);
ALTER TABLE live_chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_full_access" ON live_chat_sessions FOR ALL USING (true) WITH CHECK (true);
