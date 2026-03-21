-- Visitor journey lookup for order modal
-- Run this in Supabase SQL Editor

-- Add visitor_hash column to orders table (for future direct matching)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS visitor_hash text;
CREATE INDEX IF NOT EXISTS idx_orders_visitor_hash ON orders (visitor_hash) WHERE visitor_hash IS NOT NULL;

-- RPC: Find a visitor's full journey by matching to an order's timestamp + attributes
-- Uses time-window matching with field scoring for disambiguation
CREATE OR REPLACE FUNCTION analytics_visitor_journey(
  p_site text,
  p_order_time timestamptz,
  p_visitor_hash text DEFAULT NULL,
  p_utm_source text DEFAULT NULL,
  p_landing_page text DEFAULT NULL,
  p_browser text DEFAULT NULL,
  p_country text DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  best_hash text;
  result json;
BEGIN
  -- If we have a direct visitor_hash, use it
  IF p_visitor_hash IS NOT NULL AND p_visitor_hash != '' THEN
    best_hash := p_visitor_hash;
  ELSE
    -- Find visitor_hashes that hit thank-you page within ±5 min of order time
    SELECT sub.visitor_hash INTO best_hash
    FROM (
      SELECT
        pv.visitor_hash,
        -- Score by how many fields match
        (CASE WHEN p_utm_source IS NOT NULL AND p_utm_source != ''
              AND EXISTS (
                SELECT 1 FROM analytics_pageviews p2
                WHERE p2.visitor_hash = pv.visitor_hash
                  AND p2.site_id = p_site
                  AND p2.utm_source = p_utm_source
                  AND p2.created_at >= p_order_time - interval '30 minutes'
                  AND p2.created_at <= p_order_time + interval '5 minutes'
              ) THEN 1 ELSE 0 END
        + CASE WHEN p_landing_page IS NOT NULL AND p_landing_page != ''
              AND EXISTS (
                SELECT 1 FROM analytics_pageviews p2
                WHERE p2.visitor_hash = pv.visitor_hash
                  AND p2.site_id = p_site
                  AND p2.pathname = p_landing_page
                  AND p2.entry_page = true
                  AND p2.created_at >= p_order_time - interval '30 minutes'
                  AND p2.created_at <= p_order_time + interval '5 minutes'
              ) THEN 1 ELSE 0 END
        + CASE WHEN p_browser IS NOT NULL AND p_browser != ''
              AND EXISTS (
                SELECT 1 FROM analytics_pageviews p2
                WHERE p2.visitor_hash = pv.visitor_hash
                  AND p2.site_id = p_site
                  AND p2.browser = p_browser
                  AND p2.created_at >= p_order_time - interval '30 minutes'
                  AND p2.created_at <= p_order_time + interval '5 minutes'
              ) THEN 1 ELSE 0 END
        + CASE WHEN p_country IS NOT NULL AND p_country != ''
              AND EXISTS (
                SELECT 1 FROM analytics_pageviews p2
                WHERE p2.visitor_hash = pv.visitor_hash
                  AND p2.site_id = p_site
                  AND p2.country = p_country
                  AND p2.created_at >= p_order_time - interval '30 minutes'
                  AND p2.created_at <= p_order_time + interval '5 minutes'
              ) THEN 1 ELSE 0 END
        ) AS score,
        -- Prefer the one closest to the order time
        ABS(EXTRACT(EPOCH FROM (pv.created_at - p_order_time))) AS time_diff
      FROM analytics_pageviews pv
      WHERE pv.site_id = p_site
        AND pv.pathname IN ('/pages/thank-you/', '/pages/thank-you')
        AND pv.created_at >= p_order_time - interval '5 minutes'
        AND pv.created_at <= p_order_time + interval '5 minutes'
      ORDER BY score DESC, time_diff ASC
      LIMIT 1
    ) sub;
  END IF;

  IF best_hash IS NULL THEN
    RETURN '[]'::json;
  END IF;

  -- Return ALL pageviews + events for this visitor on the same day
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.event_time ASC), '[]'::json) INTO result
  FROM (
    -- Pageviews
    SELECT
      'pageview' AS event_type,
      pathname,
      referrer_domain,
      utm_source,
      browser,
      device_type,
      country,
      duration,
      entry_page,
      created_at AS event_time,
      NULL AS event_name
    FROM analytics_pageviews
    WHERE visitor_hash = best_hash
      AND site_id = p_site
      AND created_at >= p_order_time - interval '24 hours'
      AND created_at <= p_order_time + interval '10 minutes'

    UNION ALL

    -- Events
    SELECT
      'event' AS event_type,
      pathname,
      NULL AS referrer_domain,
      NULL AS utm_source,
      NULL AS browser,
      NULL AS device_type,
      NULL AS country,
      NULL AS duration,
      false AS entry_page,
      created_at AS event_time,
      event_name
    FROM analytics_events
    WHERE visitor_hash = best_hash
      AND site_id = p_site
      AND created_at >= p_order_time - interval '24 hours'
      AND created_at <= p_order_time + interval '10 minutes'
  ) t;

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;
