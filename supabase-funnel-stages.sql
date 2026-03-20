-- Run this in Supabase SQL editor to add the funnel stages function
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
