/**
 * google-merchant.js
 *
 * Returns product statuses from Google Merchant Center.
 * Shows approved, disapproved, and pending products with issues.
 *
 * GET ?token=X
 *
 * Returns: { products: [{ title, id, status, issues: [{ description, severity }], lastUpdated }] }
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
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
  const res = await sbFetch('/rest/v1/google_tokens?id=eq.1&select=access_token,refresh_token,expires_at,merchant_id');
  const rows = await res.json();
  if (!rows || rows.length === 0 || !rows[0].access_token) return null;

  const row = rows[0];

  // Refresh if expired
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

  const { token } = event.queryStringParameters || {};

  const staff = await getStaffByToken(token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  const gTokens = await getGoogleTokens();
  if (!gTokens) return reply(200, { products: [], error: 'Google not connected' });
  if (!gTokens.merchant_id) return reply(200, { products: [], error: 'Merchant Center ID not configured' });

  try {
    // Use Content API v2.1 (still supported until Aug 2026)
    const apiRes = await fetch(
      `https://shoppingcontent.googleapis.com/content/v2.1/${gTokens.merchant_id}/productstatuses?maxResults=250`,
      {
        headers: {
          'Authorization': `Bearer ${gTokens.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const apiData = await apiRes.json();

    if (!apiRes.ok) {
      console.error('Merchant Center API error:', JSON.stringify(apiData));
      const errMsg = apiData.error?.message || `Merchant API error ${apiRes.status}`;
      return reply(200, { products: [], error: errMsg });
    }

    const resources = apiData.resources || [];
    const products = resources.map(p => {
      // Determine overall status from destination statuses
      const destStatuses = p.destinationStatuses || [];
      let status = 'approved';
      for (const ds of destStatuses) {
        if (ds.approvalStatus === 'disapproved') { status = 'disapproved'; break; }
        if (ds.approvalStatus === 'pending') status = 'pending';
      }

      // Collect item-level issues
      const issues = (p.itemLevelIssues || [])
        .filter(i => i.servability === 'disapproved' || i.severity === 'error' || i.severity === 'critical')
        .map(i => ({
          description: i.description || i.detail || '',
          severity: i.severity || '',
          code: i.code || '',
        }));

      return {
        title: p.title || '',
        id: p.productId || '',
        status,
        issues,
        lastUpdated: p.lastUpdateDate || '',
      };
    });

    // Sort: disapproved first, then pending, then approved
    const order = { disapproved: 0, pending: 1, approved: 2 };
    products.sort((a, b) => (order[a.status] || 2) - (order[b.status] || 2));

    return reply(200, { products });
  } catch (err) {
    console.error('Merchant Center fetch error:', err.message);
    return reply(200, { products: [], error: err.message });
  }
};
