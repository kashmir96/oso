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
  persistent_id text        DEFAULT '',
  ft_source     text        DEFAULT '',
  ft_campaign   text        DEFAULT '',
  ft_medium     text        DEFAULT '',
  lt_source     text        DEFAULT '',
  lt_campaign   text        DEFAULT '',
  lt_medium     text        DEFAULT '',
  gclid         text        DEFAULT '',
  fbclid        text        DEFAULT '',
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

-- Helper: build dynamic filter WHERE clause from JSON array
-- Filters is a JSON array like [{"col":"referrer_domain","val":"google.com"},...]
-- Returns SQL fragment like: AND referrer_domain = 'google.com' AND browser = 'Chrome'
-- Special case: event_name filter does a cross-table subquery on analytics_events
CREATE OR REPLACE FUNCTION _analytics_filter_clause(p_filters json DEFAULT NULL, p_site text DEFAULT NULL, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL)
RETURNS text AS $$
DECLARE
  f json;
  clause text := '';
  col_name text;
  col_val text;
  allowed text[] := ARRAY['pathname','referrer_domain','browser','device_type','country','os','utm_campaign','utm_source','utm_medium','utm_content','utm_term'];
BEGIN
  IF p_filters IS NULL THEN RETURN ''; END IF;
  FOR f IN SELECT json_array_elements(p_filters)
  LOOP
    col_name := f->>'col';
    col_val := f->>'val';
    IF col_name = 'event_name' THEN
      -- Cross-table filter: find visitor_hashes from events table
      clause := clause || format(
        ' AND visitor_hash IN (SELECT DISTINCT visitor_hash FROM analytics_events WHERE event_name = %L AND site_id = %L AND created_at >= %L AND created_at < %L)',
        col_val,
        COALESCE(p_site, ''),
        COALESCE(p_from, now() - interval '30 days'),
        COALESCE(p_to, now())
      );
    ELSIF col_name = ANY(allowed) THEN
      clause := clause || format(' AND %I = %L', col_name, col_val);
    END IF;
  END LOOP;
  RETURN clause;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Summary stats (with optional filters)
DROP FUNCTION IF EXISTS analytics_summary(text, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION analytics_summary(p_site text, p_from timestamptz, p_to timestamptz, p_filters json DEFAULT NULL)
RETURNS json AS $$
DECLARE
  result json;
  fc text;
BEGIN
  fc := _analytics_filter_clause(p_filters, p_site, p_from, p_to);
  EXECUTE format(
    'WITH pv AS (
      SELECT visitor_hash, COUNT(*) AS cnt
      FROM analytics_pageviews
      WHERE site_id = $1 AND created_at >= $2 AND created_at < $3 %s
      GROUP BY visitor_hash
    ),
    ev AS (
      SELECT COUNT(*) AS total
      FROM analytics_events
      WHERE site_id = $1 AND created_at >= $2 AND created_at < $3
    )
    SELECT json_build_object(
      ''unique_visitors'', (SELECT COUNT(*) FROM pv),
      ''total_pageviews'', (SELECT COALESCE(SUM(cnt), 0) FROM pv),
      ''avg_duration'', (
        SELECT COALESCE(AVG(duration), 0)::int
        FROM analytics_pageviews
        WHERE site_id = $1 AND created_at >= $2 AND created_at < $3 AND duration > 0 %s
      ),
      ''bounce_rate'', CASE
        WHEN (SELECT COUNT(*) FROM pv) = 0 THEN 0
        ELSE ROUND(
          (SELECT COUNT(*) FROM pv WHERE cnt = 1)::numeric
          / NULLIF((SELECT COUNT(*) FROM pv), 0) * 100
        )
      END,
      ''event_completions'', (SELECT total FROM ev)
    )', fc, fc)
  USING p_site, p_from, p_to
  INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- Time series (with optional filters)
DROP FUNCTION IF EXISTS analytics_timeseries(text, timestamptz, timestamptz, text);
CREATE OR REPLACE FUNCTION analytics_timeseries(p_site text, p_from timestamptz, p_to timestamptz, p_interval text, p_filters json DEFAULT NULL)
RETURNS json AS $$
DECLARE
  result json;
BEGIN
  EXECUTE format(
    'SELECT COALESCE(json_agg(row_to_json(t)), ''[]''::json) FROM (
      SELECT
        date_trunc($4, created_at) AS period,
        COUNT(DISTINCT visitor_hash) AS visitors,
        COUNT(*) AS pageviews
      FROM analytics_pageviews
      WHERE site_id = $1 AND created_at >= $2 AND created_at < $3 %s
      GROUP BY period
      ORDER BY period
    ) t', _analytics_filter_clause(p_filters, p_site, p_from, p_to))
  USING p_site, p_from, p_to, p_interval
  INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- Generic grouped metric (with optional filters)
DROP FUNCTION IF EXISTS analytics_grouped(text, timestamptz, timestamptz, text);
CREATE OR REPLACE FUNCTION analytics_grouped(p_site text, p_from timestamptz, p_to timestamptz, p_column text, p_filters json DEFAULT NULL)
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
        AND %I IS NOT NULL AND %I != '''' %s
      GROUP BY %I
      ORDER BY visitors DESC
      LIMIT 50
    ) t', p_column, p_column, p_column, _analytics_filter_clause(p_filters, p_site, p_from, p_to), p_column)
  USING p_site, p_from, p_to
  INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- Entry pages (with optional filters)
DROP FUNCTION IF EXISTS analytics_entry_pages(text, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION analytics_entry_pages(p_site text, p_from timestamptz, p_to timestamptz, p_filters json DEFAULT NULL)
RETURNS json AS $$
DECLARE
  result json;
BEGIN
  EXECUTE format(
    'SELECT COALESCE(json_agg(row_to_json(t)), ''[]''::json) FROM (
      SELECT pathname AS name,
             COUNT(DISTINCT visitor_hash) AS visitors,
             COUNT(*) AS views
      FROM analytics_pageviews
      WHERE site_id = $1 AND created_at >= $2 AND created_at < $3 AND entry_page = true %s
      GROUP BY pathname
      ORDER BY visitors DESC
      LIMIT 50
    ) t', _analytics_filter_clause(p_filters, p_site, p_from, p_to))
  USING p_site, p_from, p_to
  INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- Exit pages (with optional filters)
DROP FUNCTION IF EXISTS analytics_exit_pages(text, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION analytics_exit_pages(p_site text, p_from timestamptz, p_to timestamptz, p_filters json DEFAULT NULL)
RETURNS json AS $$
DECLARE
  result json;
BEGIN
  EXECUTE format(
    'SELECT COALESCE(json_agg(row_to_json(t)), ''[]''::json) FROM (
      SELECT pathname AS name,
             COUNT(*) AS visitors,
             COUNT(*) AS views
      FROM (
        SELECT DISTINCT ON (visitor_hash) visitor_hash, pathname
        FROM analytics_pageviews
        WHERE site_id = $1 AND created_at >= $2 AND created_at < $3 %s
        ORDER BY visitor_hash, created_at DESC
      ) last_pages
      GROUP BY pathname
      ORDER BY visitors DESC
      LIMIT 50
    ) t', _analytics_filter_clause(p_filters, p_site, p_from, p_to))
  USING p_site, p_from, p_to
  INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- Events summary (with optional filters)
DROP FUNCTION IF EXISTS analytics_events_summary(text, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION analytics_events_summary(p_site text, p_from timestamptz, p_to timestamptz, p_filters json DEFAULT NULL)
RETURNS json AS $$
DECLARE
  result json;
  fc text;
BEGIN
  fc := _analytics_filter_clause(p_filters, p_site, p_from, p_to);
  EXECUTE format(
    'WITH ev AS (
      SELECT event_name,
             COUNT(DISTINCT visitor_hash) AS uniques,
             COUNT(*) AS completions
      FROM analytics_events
      WHERE site_id = $1 AND created_at >= $2 AND created_at < $3
      GROUP BY event_name
      ORDER BY completions DESC
      LIMIT 50
    ),
    pv AS (
      SELECT COUNT(DISTINCT visitor_hash) AS total_visitors
      FROM analytics_pageviews
      WHERE site_id = $1 AND created_at >= $2 AND created_at < $3 %s
    )
    SELECT COALESCE(json_agg(json_build_object(
      ''event_name'', ev.event_name,
      ''uniques'', ev.uniques,
      ''completions'', ev.completions,
      ''conv_rate'', CASE WHEN pv.total_visitors = 0 THEN 0
        ELSE ROUND(ev.uniques::numeric / pv.total_visitors * 100, 1) END
    )), ''[]''::json)
    FROM ev, pv', fc)
  USING p_site, p_from, p_to
  INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- Funnel: count unique sessions progressing through stages
-- Each stage only counts visitors who completed ALL prior stages
DROP FUNCTION IF EXISTS analytics_funnel_stages(text, timestamptz, timestamptz, json);
CREATE OR REPLACE FUNCTION analytics_funnel_stages(p_site text, p_from timestamptz, p_to timestamptz, p_filters json DEFAULT NULL)
RETURNS json AS $$
DECLARE
  result json;
  fc text;
BEGIN
  fc := _analytics_filter_clause(p_filters, p_site, p_from, p_to);
  EXECUTE format(
    'WITH visitors AS (
      SELECT DISTINCT visitor_hash
      FROM analytics_pageviews
      WHERE site_id = $1 AND created_at >= $2 AND created_at < $3 %s
    ),
    atc AS (
      SELECT DISTINCT e.visitor_hash
      FROM analytics_events e
      JOIN visitors v ON v.visitor_hash = e.visitor_hash
      WHERE e.site_id = $1 AND e.created_at >= $2 AND e.created_at < $3
        AND e.event_name = ''add to cart''
    ),
    checkout AS (
      SELECT DISTINCT e.visitor_hash
      FROM analytics_events e
      JOIN atc a ON a.visitor_hash = e.visitor_hash
      WHERE e.site_id = $1 AND e.created_at >= $2 AND e.created_at < $3
        AND e.event_name = ''proceed to checkout''
    ),
    purchased AS (
      SELECT DISTINCT e.visitor_hash
      FROM analytics_events e
      JOIN checkout c ON c.visitor_hash = e.visitor_hash
      WHERE e.site_id = $1 AND e.created_at >= $2 AND e.created_at < $3
        AND e.event_name = ''checkout completed''
    )
    SELECT json_build_object(
      ''visitors'', (SELECT COUNT(*) FROM visitors),
      ''atc'', (SELECT COUNT(*) FROM atc),
      ''checkout'', (SELECT COUNT(*) FROM checkout),
      ''purchased'', (SELECT COUNT(*) FROM purchased)
    )', fc)
  USING p_site, p_from, p_to
  INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

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

-- Realtime visitor journeys (per-visitor page sequence for active visitors)
CREATE OR REPLACE FUNCTION analytics_realtime_visitors(p_site text)
RETURNS json AS $$
  WITH active AS (
    SELECT DISTINCT visitor_hash
    FROM analytics_pageviews
    WHERE site_id = p_site AND created_at >= now() - interval '5 minutes'
  ),
  journeys AS (
    SELECT
      pv.visitor_hash,
      pv.pathname,
      pv.duration,
      pv.created_at,
      pv.referrer_domain,
      pv.browser,
      pv.device_type,
      pv.country,
      pv.entry_page
    FROM analytics_pageviews pv
    JOIN active a ON a.visitor_hash = pv.visitor_hash
    WHERE pv.site_id = p_site
      AND pv.created_at >= now() - interval '30 minutes'
    ORDER BY pv.visitor_hash, pv.created_at ASC
  )
  SELECT COALESCE(json_agg(row_to_json(v)), '[]'::json) FROM (
    SELECT
      visitor_hash,
      json_agg(json_build_object(
        'page', pathname,
        'duration', duration,
        'time', created_at
      ) ORDER BY created_at ASC) AS pages,
      MIN(CASE WHEN entry_page THEN referrer_domain END) AS referrer,
      MIN(browser) AS browser,
      MIN(device_type) AS device,
      MIN(country) AS country,
      MAX(created_at) AS last_seen
    FROM journeys
    GROUP BY visitor_hash
    ORDER BY last_seen DESC
    LIMIT 30
  ) v;
$$ LANGUAGE sql STABLE;

-- Page funnel: per-page-group stats (visitors, views, avg duration, bounce rate, entry count)
-- Accepts a JSON array of {label, patterns} where patterns is an array of pathname LIKE patterns
-- e.g. [{"label":"Homepage","patterns":["/"]}]
DROP FUNCTION IF EXISTS analytics_page_funnel(text, timestamptz, timestamptz, json, json);
CREATE OR REPLACE FUNCTION analytics_page_funnel(p_site text, p_from timestamptz, p_to timestamptz, p_groups json, p_filters json DEFAULT NULL)
RETURNS json AS $$
DECLARE
  result json;
  fc text;
BEGIN
  fc := _analytics_filter_clause(p_filters, p_site, p_from, p_to);
  EXECUTE format(
    'WITH groups AS (
      SELECT g->>''label'' AS label, g->''patterns'' AS patterns
      FROM json_array_elements($4) g
    ),
    base AS (
      SELECT pv.visitor_hash, pv.pathname, pv.duration, pv.entry_page,
        (SELECT COUNT(*) FROM analytics_pageviews pv2
         WHERE pv2.visitor_hash = pv.visitor_hash
           AND pv2.site_id = $1 AND pv2.created_at >= $2 AND pv2.created_at < $3) AS session_pages
      FROM analytics_pageviews pv
      WHERE pv.site_id = $1 AND pv.created_at >= $2 AND pv.created_at < $3 %s
    ),
    matched AS (
      SELECT g.label, b.*
      FROM base b
      JOIN groups g ON EXISTS (
        SELECT 1 FROM json_array_elements_text(g.patterns) p
        WHERE b.pathname LIKE p
      )
    )
    SELECT COALESCE(json_agg(row_to_json(t)), ''[]''::json) FROM (
      SELECT
        label,
        COUNT(DISTINCT visitor_hash) AS visitors,
        COUNT(*) AS views,
        COALESCE(ROUND(AVG(NULLIF(duration, 0))), 0) AS avg_duration,
        CASE WHEN COUNT(DISTINCT visitor_hash) = 0 THEN 0
          ELSE ROUND(
            COUNT(DISTINCT CASE WHEN session_pages = 1 THEN visitor_hash END)::numeric
            / COUNT(DISTINCT visitor_hash) * 100, 1
          )
        END AS bounce_rate,
        COUNT(DISTINCT CASE WHEN entry_page THEN visitor_hash END) AS entry_visitors
      FROM matched
      GROUP BY label
    ) t', fc)
  USING p_site, p_from, p_to, p_groups
  INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- Conversion funnels: for visitors who triggered 'checkout completed' event,
-- show entry page → last product page before conversion
CREATE OR REPLACE FUNCTION analytics_conversions(p_site text, p_from timestamptz, p_to timestamptz, p_thank_you text DEFAULT '/pages/thank-you/')
RETURNS json AS $$
  WITH converted AS (
    -- Visitors who fired 'checkout completed' event OR hit thank-you page
    SELECT visitor_hash, MIN(created_at) AS converted_at
    FROM (
      SELECT visitor_hash, created_at FROM analytics_events
      WHERE site_id = p_site AND created_at >= p_from AND created_at < p_to
        AND event_name = 'checkout completed'
      UNION ALL
      SELECT visitor_hash, created_at FROM analytics_pageviews
      WHERE site_id = p_site AND created_at >= p_from AND created_at < p_to
        AND pathname = p_thank_you
    ) x
    GROUP BY visitor_hash
  ),
  journeys AS (
    -- All pages for converted visitors in the date range
    SELECT pv.visitor_hash, pv.pathname, pv.created_at, pv.entry_page,
           pv.referrer_domain, pv.browser, pv.device_type, pv.country
    FROM analytics_pageviews pv
    JOIN converted c ON c.visitor_hash = pv.visitor_hash
    WHERE pv.site_id = p_site AND pv.created_at >= p_from AND pv.created_at < p_to
  ),
  funnels AS (
    SELECT
      j.visitor_hash,
      -- Entry page: first page with entry_page=true, or first page
      (SELECT pathname FROM journeys j2
       WHERE j2.visitor_hash = j.visitor_hash
       ORDER BY j2.entry_page DESC, j2.created_at ASC LIMIT 1) AS landing_page,
      -- Last product/non-thankyou page before conversion
      (SELECT pathname FROM journeys j2
       WHERE j2.visitor_hash = j.visitor_hash AND j2.pathname != p_thank_you
       ORDER BY j2.created_at DESC LIMIT 1) AS sale_page,
      c.converted_at,
      MIN(CASE WHEN j.entry_page THEN j.referrer_domain END) AS referrer,
      MIN(j.browser) AS browser,
      MIN(j.device_type) AS device,
      MIN(j.country) AS country
    FROM journeys j
    JOIN converted c ON c.visitor_hash = j.visitor_hash
    GROUP BY j.visitor_hash, c.converted_at
  )
  SELECT COALESCE(json_agg(row_to_json(f) ORDER BY f.converted_at DESC), '[]'::json)
  FROM funnels f;
$$ LANGUAGE sql STABLE;

-- Funnel metrics grouped by any dimension
-- Returns visitors, add-to-cart uniques, sale uniques per dimension value
CREATE OR REPLACE FUNCTION analytics_funnel_grouped(p_site text, p_from timestamptz, p_to timestamptz, p_column text)
RETURNS json AS $$
DECLARE
  result json;
BEGIN
  EXECUTE format(
    'SELECT COALESCE(json_agg(row_to_json(t)), ''[]''::json) FROM (
      SELECT
        %I AS name,
        COUNT(DISTINCT pv.visitor_hash) AS visitors,
        COUNT(DISTINCT ev_atc.visitor_hash) AS atc,
        COUNT(DISTINCT ev_sale.visitor_hash) AS sales
      FROM analytics_pageviews pv
      LEFT JOIN (
        SELECT DISTINCT visitor_hash FROM analytics_events
        WHERE site_id = $1 AND created_at >= $2 AND created_at < $3 AND event_name = ''add to cart''
      ) ev_atc ON ev_atc.visitor_hash = pv.visitor_hash
      LEFT JOIN (
        SELECT DISTINCT visitor_hash FROM analytics_events
        WHERE site_id = $1 AND created_at >= $2 AND created_at < $3 AND event_name = ''checkout completed''
      ) ev_sale ON ev_sale.visitor_hash = pv.visitor_hash
      WHERE pv.site_id = $1 AND pv.created_at >= $2 AND pv.created_at < $3
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

-- List distinct site IDs
CREATE OR REPLACE FUNCTION analytics_sites()
RETURNS json AS $$
  SELECT COALESCE(json_agg(site_id), '[]'::json) FROM (
    SELECT DISTINCT site_id FROM analytics_pageviews ORDER BY site_id
  ) t;
$$ LANGUAGE sql STABLE;
