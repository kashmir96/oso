-- Create table for anti-retail store interest submissions
CREATE TABLE anti_retail_interests (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL,
  website TEXT,
  category TEXT,
  socials TEXT,
  monthly_customers TEXT,
  ad_platforms TEXT,
  marketing_team TEXT,
  channels TEXT,
  flagship TEXT,
  crosssells TEXT,
  product_size TEXT,
  anything_else TEXT,
  status TEXT DEFAULT 'new'
);

-- Enable RLS
ALTER TABLE anti_retail_interests ENABLE ROW LEVEL SECURITY;

-- Allow inserts from service key (Netlify functions)
CREATE POLICY "Service role can do everything" ON anti_retail_interests
  FOR ALL USING (true) WITH CHECK (true);

-- Index on email for lookups
CREATE INDEX idx_anti_retail_interests_email ON anti_retail_interests(email);
CREATE INDEX idx_anti_retail_interests_created ON anti_retail_interests(created_at DESC);
