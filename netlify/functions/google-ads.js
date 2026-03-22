/**
 * google-ads.js
 *
 * Returns campaign performance data from Google Ads API v23.
 *
 * GET ?token=X&from=YYYY-MM-DD&to=YYYY-MM-DD
 *     Optional: &daily=1 for per-day breakdown
 *
 * Returns: { campaigns: [{ name, id, impressions, clicks, spend, conversions, conversions_value }] }
 *          or with daily=1: { daily: [{ date, spend, conversions_value }] }
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   GOOGLE_ADS_DEVELOPER_TOKEN
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

async function getGoogleTokens() {
  const res = await sbFetch('/rest/v1/google_tokens?id=eq.1&select=access_token,refresh_token,expires_at,ads_customer_id');
  const rows = await res.json();
  if (!rows || rows.length === 0 || !rows[0].access_token) return null;

  const row = rows[0];

  // Check if token needs refresh
  if (new Date(row.expires_at) < new Date(Date.now() + 60000)) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!row.refresh_token || !clientId || !clientSecret) return null;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: row.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('Google token refresh failed:', tokenData);
      return null;
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    await sbFetch('/rest/v1/google_tokens?id=eq.1', {
      method: 'PATCH',
      body: JSON.stringify({
        access_token: tokenData.access_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }),
    });

    row.access_token = tokenData.access_token;
  }

  return row;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'GET') return reply(405, { error: 'GET only' });

  const qs = event.queryStringParameters || {};
  const { token, from, to, daily } = qs;

  const staff = await getStaffByToken(token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  const gTokens = await getGoogleTokens();
  if (!gTokens) return reply(200, { campaigns: [], error: 'Google not connected' });
  if (!gTokens.ads_customer_id) return reply(200, { campaigns: [], error: 'Google Ads Customer ID not configured' });

  if (!from || !to) return reply(400, { error: 'Missing from/to date params' });

  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!devToken) return reply(200, { campaigns: [], error: 'GOOGLE_ADS_DEVELOPER_TOKEN not configured' });

  try {
    let query;
    if (daily) {
      query = `SELECT segments.date, metrics.cost_micros, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status = 'ENABLED' ORDER BY segments.date ASC`;
    } else {
      query = `SELECT campaign.name, campaign.id, campaign.primary_status, campaign.primary_status_reasons, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status = 'ENABLED' ORDER BY metrics.cost_micros DESC`;
    }

    const apiRes = await fetch(
      `https://googleads.googleapis.com/v23/customers/${gTokens.ads_customer_id}/googleAds:searchStream`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${gTokens.access_token}`,
          'developer-token': devToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      }
    );

    const apiData = await apiRes.json();

    if (!apiRes.ok) {
      console.error('Google Ads API error:', JSON.stringify(apiData));
      const errMsg = apiData.error?.message || `Google Ads API error ${apiRes.status}`;
      return reply(200, { campaigns: [], error: errMsg });
    }

    // searchStream returns array of result batches
    const results = Array.isArray(apiData) ? apiData : [apiData];

    if (daily) {
      const dailyMap = {};
      for (const batch of results) {
        for (const row of (batch.results || [])) {
          const date = row.segments?.date || '';
          if (!dailyMap[date]) dailyMap[date] = { date, spend: 0, conversions_value: 0 };
          dailyMap[date].spend += (row.metrics?.costMicros || 0) / 1000000;
          dailyMap[date].conversions_value += Number(row.metrics?.conversionsValue || 0);
        }
      }
      return reply(200, { daily: Object.values(dailyMap) });
    }

    const campaignMap = {};
    for (const batch of results) {
      for (const row of (batch.results || [])) {
        const id = row.campaign?.id || '';
        if (!campaignMap[id]) {
          campaignMap[id] = {
            name: row.campaign?.name || '',
            id,
            primary_status: row.campaign?.primaryStatus || '',
            primary_status_reasons: row.campaign?.primaryStatusReasons || [],
            impressions: 0,
            clicks: 0,
            spend: 0,
            conversions: 0,
            conversions_value: 0,
          };
        }
        const c = campaignMap[id];
        c.impressions += Number(row.metrics?.impressions || 0);
        c.clicks += Number(row.metrics?.clicks || 0);
        c.spend += (row.metrics?.costMicros || 0) / 1000000;
        c.conversions += Number(row.metrics?.conversions || 0);
        c.conversions_value += Number(row.metrics?.conversionsValue || 0);
      }
    }

    return reply(200, { campaigns: Object.values(campaignMap) });
  } catch (err) {
    console.error('Google Ads fetch error:', err.message);
    return reply(200, { campaigns: [], error: err.message });
  }
};
