-- Tracks website deploys and their impact on funnel performance
CREATE TABLE IF NOT EXISTS site_changelogs (
  id serial PRIMARY KEY,
  deploy_id text UNIQUE NOT NULL,
  site_key text NOT NULL,
  commit_message text DEFAULT '',
  commit_sha text DEFAULT '',
  files_changed text[] DEFAULT '{}',
  deployed_at timestamptz NOT NULL,
  is_funnel_related boolean DEFAULT false,
  funnel_pages text[] DEFAULT '{}',
  baseline_visitors int DEFAULT 0,
  baseline_atc int DEFAULT 0,
  baseline_conv int DEFAULT 0,
  baseline_rev numeric DEFAULT 0,
  post_visitors int,
  post_atc int,
  post_conv int,
  post_rev numeric,
  cooldown_complete boolean DEFAULT false,
  cooldown_conversions int DEFAULT 0,
  sms_followup_sent boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_changelogs_site_deployed ON site_changelogs (site_key, deployed_at DESC);
CREATE INDEX IF NOT EXISTS idx_changelogs_funnel ON site_changelogs (is_funnel_related, sms_followup_sent);
