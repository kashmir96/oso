-- ============================================
-- Analytics Schema for oso.nz (Fathom clone)
-- Run this in the Supabase SQL Editor
-- ============================================

-- 1. Pageviews table
CREATE TABLE analytics_pageviews (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  visitor_hash  text        NOT NULL,
  site_id       text        NOT NULL DEFAULT 'default',
  pathname      text        NOT NULL,
  referrer      text,
  referrer_domain text,
  utm_campaign  text,
  utm_source    text,
  utm_medium    text,
  utm_content   text,
  utm_term      text,
  browser       text,
  os            text,
  device_type   text,
  country       text,
  screen_width  int,
  duration      int         DEFAULT 0,
  is_unique     boolean     NOT NULL DEFAULT false,
  entry_page    boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pv_site_created   ON analytics_pageviews (site_id, created_at DESC);
CREATE INDEX idx_pv_hash_created   ON analytics_pageviews (visitor_hash, created_at DESC);
CREATE INDEX idx_pv_site_path      ON analytics_pageviews (site_id, pathname, created_at DESC);
CREATE INDEX idx_pv_site_referrer  ON analytics_pageviews (site_id, referrer_domain, created_at DESC);
CREATE INDEX idx_pv_site_country   ON analytics_pageviews (site_id, country, created_at DESC);
CREATE INDEX idx_pv_site_browser   ON analytics_pageviews (site_id, browser, created_at DESC);
CREATE INDEX idx_pv_site_device    ON analytics_pageviews (site_id, device_type, created_at DESC);
CREATE INDEX idx_pv_site_unique    ON analytics_pageviews (site_id, created_at DESC) WHERE is_unique = true;

-- 2. Events table
CREATE TABLE analytics_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  visitor_hash  text        NOT NULL,
  site_id       text        NOT NULL DEFAULT 'default',
  event_name    text        NOT NULL,
  pathname      text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ev_site_created ON analytics_events (site_id, created_at DESC);
CREATE INDEX idx_ev_site_name    ON analytics_events (site_id, event_name, created_at DESC);

-- 3. Daily salt table (single row)
CREATE TABLE analytics_salt (
  id        int  PRIMARY KEY DEFAULT 1,
  salt      text NOT NULL,
  date_str  text NOT NULL
);

INSERT INTO analytics_salt (salt, date_str)
VALUES (encode(gen_random_bytes(32), 'hex'), to_char(now(), 'YYYY-MM-DD'));

-- 4. Row-Level Security
ALTER TABLE analytics_pageviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_salt ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_full_access" ON analytics_pageviews FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON analytics_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_full_access" ON analytics_salt FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- RPC Functions (needed because PostgREST can't GROUP BY)
-- ============================================

-- Summary stats
CREATE OR REPLACE FUNCTION analytics_summary(p_site text, p_from timestamptz, p_to timestamptz)
RETURNS json AS $$
  WITH pv AS (
    SELECT visitor_hash, COUNT(*) AS cnt
    FROM analytics_pageviews
    WHERE site_id = p_site AND created_at >= p_from AND created_at < p_to
    GROUP BY visitor_hash
  ),
  ev AS (
    SELECT COUNT(*) AS total
    FROM analytics_events
    WHERE site_id = p_site AND created_at >= p_from AND created_at < p_to
  )
  SELECT json_build_object(
    'unique_visitors', (SELECT COUNT(*) FROM pv),
    'total_pageviews', (SELECT COALESCE(SUM(cnt), 0) FROM pv),
    'avg_duration', (
      SELECT COALESCE(AVG(duration), 0)::int
      FROM analytics_pageviews
      WHERE site_id = p_site AND created_at >= p_from AND created_at < p_to AND duration > 0
    ),
    'bounce_rate', CASE
      WHEN (SELECT COUNT(*) FROM pv) = 0 THEN 0
      ELSE ROUND(
        (SELECT COUNT(*) FROM pv WHERE cnt = 1)::numeric
        / NULLIF((SELECT COUNT(*) FROM pv), 0) * 100
      )
    END,
    'event_completions', (SELECT total FROM ev)
  );
$$ LANGUAGE sql STABLE;

-- Time series
CREATE OR REPLACE FUNCTION analytics_timeseries(p_site text, p_from timestamptz, p_to timestamptz, p_interval text)
RETURNS json AS $$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
    SELECT
      date_trunc(p_interval, created_at) AS period,
      COUNT(DISTINCT visitor_hash) AS visitors,
      COUNT(*) AS pageviews
    FROM analytics_pageviews
    WHERE site_id = p_site AND created_at >= p_from AND created_at < p_to
    GROUP BY period
    ORDER BY period
  ) t;
$$ LANGUAGE sql STABLE;

-- Generic grouped metric
CREATE OR REPLACE FUNCTION analytics_grouped(p_site text, p_from timestamptz, p_to timestamptz, p_column text)
RETURNS json AS $$
DECLARE
  result json;
BEGIN
  EXECUTE format(
    'SELECT COALESCE(json_agg(row_to_json(t)), ''[]''::json) FROM (
      SELECT %I AS name,
             COUNT(DISTINCT visitor_hash) AS visitors,
             COUNT(*) AS views
      FROM analytics_pageviews
      WHERE site_id = $1 AND created_at >= $2 AND created_at < $3
        AND %I IS NOT NULL AND %I != ''''
      GROUP BY %I
      ORDER BY visitors DESC
      LIMIT 50
    ) t', p_column, p_column, p_column, p_column)
  USING p_site, p_from, p_to
  INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- Entry pages
CREATE OR REPLACE FUNCTION analytics_entry_pages(p_site text, p_from timestamptz, p_to timestamptz)
RETURNS json AS $$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
    SELECT pathname AS name,
           COUNT(DISTINCT visitor_hash) AS visitors,
           COUNT(*) AS views
    FROM analytics_pageviews
    WHERE site_id = p_site AND created_at >= p_from AND created_at < p_to AND entry_page = true
    GROUP BY pathname
    ORDER BY visitors DESC
    LIMIT 50
  ) t;
$$ LANGUAGE sql STABLE;

-- Exit pages (last page per visitor session)
CREATE OR REPLACE FUNCTION analytics_exit_pages(p_site text, p_from timestamptz, p_to timestamptz)
RETURNS json AS $$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
    SELECT pathname AS name,
           COUNT(*) AS visitors,
           COUNT(*) AS views
    FROM (
      SELECT DISTINCT ON (visitor_hash) visitor_hash, pathname
      FROM analytics_pageviews
      WHERE site_id = p_site AND created_at >= p_from AND created_at < p_to
      ORDER BY visitor_hash, created_at DESC
    ) last_pages
    GROUP BY pathname
    ORDER BY visitors DESC
    LIMIT 50
  ) t;
$$ LANGUAGE sql STABLE;

-- Events summary
CREATE OR REPLACE FUNCTION analytics_events_summary(p_site text, p_from timestamptz, p_to timestamptz)
RETURNS json AS $$
  WITH ev AS (
    SELECT event_name,
           COUNT(DISTINCT visitor_hash) AS uniques,
           COUNT(*) AS completions
    FROM analytics_events
    WHERE site_id = p_site AND created_at >= p_from AND created_at < p_to
    GROUP BY event_name
    ORDER BY completions DESC
    LIMIT 50
  ),
  pv AS (
    SELECT COUNT(DISTINCT visitor_hash) AS total_visitors
    FROM analytics_pageviews
    WHERE site_id = p_site AND created_at >= p_from AND created_at < p_to
  )
  SELECT COALESCE(json_agg(json_build_object(
    'event_name', ev.event_name,
    'uniques', ev.uniques,
    'completions', ev.completions,
    'conv_rate', CASE WHEN pv.total_visitors = 0 THEN 0
      ELSE ROUND(ev.uniques::numeric / pv.total_visitors * 100, 1) END
  )), '[]'::json)
  FROM ev, pv;
$$ LANGUAGE sql STABLE;

-- Realtime (active visitors in last 5 minutes)
CREATE OR REPLACE FUNCTION analytics_realtime(p_site text)
RETURNS json AS $$
  SELECT json_build_object(
    'active_visitors', COUNT(DISTINCT visitor_hash)
  )
  FROM analytics_pageviews
  WHERE site_id = p_site AND created_at >= now() - interval '5 minutes';
$$ LANGUAGE sql STABLE;

-- Realtime page breakdown (what pages are active visitors on)
CREATE OR REPLACE FUNCTION analytics_realtime_pages(p_site text)
RETURNS json AS $$
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
    SELECT pathname, COUNT(DISTINCT visitor_hash) AS visitors
    FROM analytics_pageviews
    WHERE site_id = p_site AND created_at >= now() - interval '5 minutes'
    GROUP BY pathname
    ORDER BY visitors DESC
    LIMIT 20
  ) t;
$$ LANGUAGE sql STABLE;

-- List distinct site IDs
CREATE OR REPLACE FUNCTION analytics_sites()
RETURNS json AS $$
  SELECT COALESCE(json_agg(site_id), '[]'::json) FROM (
    SELECT DISTINCT site_id FROM analytics_pageviews ORDER BY site_id
  ) t;
$$ LANGUAGE sql STABLE;
