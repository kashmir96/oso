/**
 * analytics-journey.js
 *
 * Returns a visitor's full page journey for an order.
 * Matches by visitor_hash (if available) or time-window + field scoring.
 *
 * GET ?token=X&site=SITE_ID&order_time=ISO&visitor_hash=X&utm_source=X&landing_page=X&browser=X&country=X
 *
 * Env vars required: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function reply(code, data) {
  return { statusCode: code, headers: HEADERS, body: JSON.stringify(data) };
}

function sbFetch(path, opts = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${url}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...opts.headers,
    },
  });
}

async function getStaffByToken(token) {
  if (!token) return null;
  const res = await sbFetch(`/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id`);
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'GET') return reply(405, { error: 'GET only' });

  const qs = event.queryStringParameters || {};
  const { token, site, order_time, visitor_hash, utm_source, landing_page, browser, country } = qs;

  const staff = await getStaffByToken(token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  if (!site || !order_time) {
    return reply(400, { error: 'Missing params: site, order_time' });
  }

  try {
    const res = await sbFetch('/rest/v1/rpc/analytics_visitor_journey', {
      method: 'POST',
      body: JSON.stringify({
        p_site: site,
        p_order_time: order_time,
        p_visitor_hash: visitor_hash || null,
        p_utm_source: utm_source || null,
        p_landing_page: landing_page || null,
        p_browser: browser || null,
        p_country: country || null,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('Journey RPC failed:', data);
      return reply(500, { error: data.message || 'RPC error' });
    }

    return reply(200, data);
  } catch (err) {
    console.error('Journey error:', err.message);
    return reply(500, { error: err.message });
  }
};
