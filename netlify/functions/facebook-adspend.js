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
    if (from && to) {
      // Date range query — straightforward
      const timeRange = JSON.stringify({ since: from, until: to });
      const url = `https://graph.facebook.com/v21.0/act_${accountId}/insights?fields=spend&time_range=${encodeURIComponent(timeRange)}&access_token=${accessToken}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.error) return reply(200, { spend: null, error: json.error.message });
      const spend = json.data && json.data.length > 0 ? json.data[0].spend : '0.00';
      return reply(200, { spend });
    }

    // "Today" query — FB uses ad account timezone (likely US/UTC), not NZ.
    // Fetch yesterday + today with daily breakdown, then calculate NZ "today" spend.
    // NZ is UTC+12/+13. FB account may be in a different TZ.
    // Strategy: fetch last 2 days of spend. Since we also get campaign-level totals
    // from facebook-campaigns (which IS the source of truth for period spend),
    // this endpoint just needs a reasonable "today" estimate.
    // Fetch today + yesterday to cover the NZ day boundary.
    const now = new Date();
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const ydStr = yesterday.toISOString().slice(0, 10);
    const todayStr = now.toISOString().slice(0, 10);
    const timeRange = JSON.stringify({ since: ydStr, until: todayStr });
    const url = `https://graph.facebook.com/v21.0/act_${accountId}/insights?fields=spend&time_range=${encodeURIComponent(timeRange)}&time_increment=1&access_token=${accessToken}`;
    const res = await fetch(url);
    const json = await res.json();

    if (json.error) {
      console.error('Facebook API error:', json.error);
      return reply(200, { spend: null, error: json.error.message });
    }

    // Sum both days — this gives a "NZ today" approximation
    // since NZ today spans parts of both UTC yesterday and UTC today.
    // The campaign-level endpoint (facebook-campaigns) is used for precise period totals.
    let totalSpend = 0;
    if (json.data) {
      for (const row of json.data) {
        totalSpend += Number(row.spend || 0);
      }
    }
    // Halve yesterday's contribution as rough estimate (NZ today covers ~half of UTC yesterday + all of UTC today)
    // More precise: NZ is ~12-13h ahead, so NZ "today" started ~11-12h into UTC yesterday
    let ydSpend = 0, tdSpend = 0;
    if (json.data) {
      for (const row of json.data) {
        if (row.date_start === ydStr) ydSpend = Number(row.spend || 0);
        else tdSpend = Number(row.spend || 0);
      }
    }
    // NZ today ≈ last ~12h of UTC yesterday + all of UTC today so far
    // Approximate: half of yesterday's spend + all of today's
    const nzTodaySpend = (ydSpend * 0.5) + tdSpend;

    return reply(200, { spend: nzTodaySpend.toFixed(2), raw_yesterday: ydSpend, raw_today: tdSpend });
  } catch (err) {
    console.error('Facebook adspend fetch error:', err.message);
    return reply(200, { spend: null, error: err.message });
  }
};
