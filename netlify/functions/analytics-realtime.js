/**
 * analytics-realtime.js
 *
 * Returns count of active visitors in the last 5 minutes.
 * GET ?token=X&site=SITE_ID
 *
 * Env vars required: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function reply(statusCode, data) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(data) };
}

async function sbFetch(url, opts = {}) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${SUPABASE_URL}${url}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
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
  const { token, site } = qs;

  const staff = await getStaffByToken(token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  if (!site) return reply(400, { error: 'Missing site param' });

  const res = await sbFetch('/rest/v1/rpc/analytics_realtime', {
    method: 'POST',
    body: JSON.stringify({ p_site: site }),
  });
  const data = await res.json();
  return reply(200, data);
};
