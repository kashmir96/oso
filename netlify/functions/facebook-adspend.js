/**
 * facebook-adspend.js
 *
 * Returns today's total Facebook ad spend from the Marketing API.
 * Authenticated via staff session token (same pattern as analytics-dashboard).
 *
 * GET ?token=X[&from=YYYY-MM-DD&to=YYYY-MM-DD]
 *
 * If from/to are provided, returns spend for that date range.
 * Otherwise defaults to today.
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   FB_AD_ACCOUNT_ID   (e.g. "123456789" — without the "act_" prefix)
 *   FB_ACCESS_TOKEN     (System User long-lived token with ads_read permission)
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function reply(statusCode, data) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(data) };
}

async function getStaffByToken(token) {
  if (!token) return null;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id`, {
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'GET') return reply(405, { error: 'GET only' });

  const { token, from, to } = event.queryStringParameters || {};

  const staff = await getStaffByToken(token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  const accountId = process.env.FB_AD_ACCOUNT_ID;
  const accessToken = process.env.FB_ACCESS_TOKEN;

  if (!accountId || !accessToken) {
    return reply(200, { spend: null, error: 'Facebook credentials not configured' });
  }

  try {
    let url;
    if (from && to) {
      const timeRange = JSON.stringify({ since: from, until: to });
      url = `https://graph.facebook.com/v21.0/act_${accountId}/insights?fields=spend&time_range=${encodeURIComponent(timeRange)}&access_token=${accessToken}`;
    } else {
      url = `https://graph.facebook.com/v21.0/act_${accountId}/insights?fields=spend&date_preset=today&access_token=${accessToken}`;
    }
    const res = await fetch(url);
    const json = await res.json();

    if (json.error) {
      console.error('Facebook API error:', json.error);
      return reply(200, { spend: null, error: json.error.message });
    }

    const spend = json.data && json.data.length > 0 ? json.data[0].spend : '0.00';
    return reply(200, { spend });
  } catch (err) {
    console.error('Facebook adspend fetch error:', err.message);
    return reply(200, { spend: null, error: err.message });
  }
};
