/**
 * xero-api.js
 *
 * Authenticated proxy to Xero API (read-only).
 * Auto-refreshes expired access tokens transparently.
 *
 * GET ?token=X&endpoint=ENDPOINT&...params
 *
 * Allowed endpoints:
 *   Reports/ProfitAndLoss, Reports/BalanceSheet, Reports/BankSummary,
 *   Invoices, BankTransactions, Accounts, Organisation
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   XERO_CLIENT_ID, XERO_CLIENT_SECRET
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const ALLOWED_ENDPOINTS = [
  'Reports/ProfitAndLoss',
  'Reports/BalanceSheet',
  'Reports/BankSummary',
  'Invoices',
  'Bills',
  'BankTransactions',
  'Accounts',
  'Organisation',
  'Contacts',
];

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

async function getXeroTokens() {
  const res = await sbFetch('/rest/v1/xero_tokens?id=eq.1&select=*');
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

async function refreshAccessToken(tokens) {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    }).toString(),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    console.error('Xero token refresh failed:', data);
    return null;
  }

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  // Update stored tokens
  await sbFetch('/rest/v1/xero_tokens?id=eq.1', {
    method: 'PATCH',
    body: JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }),
  });

  return { ...tokens, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: expiresAt };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return reply(405, { error: 'GET or POST only' });

  const qs = event.queryStringParameters || {};
  const { token, endpoint, ...params } = qs;

  // Auth
  const staff = await getStaffByToken(token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  // Validate endpoint
  if (!endpoint || !ALLOWED_ENDPOINTS.includes(endpoint)) {
    return reply(400, { error: 'Invalid or missing endpoint. Allowed: ' + ALLOWED_ENDPOINTS.join(', ') });
  }

  // Get Xero tokens
  let tokens = await getXeroTokens();
  if (!tokens || !tokens.access_token || !tokens.tenant_id) {
    return reply(403, { error: 'Xero not connected' });
  }

  // Refresh if expired or within 60s of expiry
  const expiresAt = new Date(tokens.expires_at).getTime();
  if (Date.now() > expiresAt - 60000) {
    tokens = await refreshAccessToken(tokens);
    if (!tokens) {
      return reply(403, { error: 'Xero token refresh failed — please reconnect' });
    }
  }

  // Build Xero API URL
  const queryString = new URLSearchParams(params).toString();
  const xeroUrl = `https://api.xero.com/api.xro/2.0/${endpoint}${queryString ? '?' + queryString : ''}`;

  try {
    const fetchOpts = {
      method: event.httpMethod,
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'xero-tenant-id': tokens.tenant_id,
        Accept: 'application/json',
      },
    };
    if (event.httpMethod === 'POST' && event.body) {
      fetchOpts.headers['Content-Type'] = 'application/json';
      fetchOpts.body = event.body;
    }
    const xeroRes = await fetch(xeroUrl, fetchOpts);

    // Handle rate limiting
    if (xeroRes.status === 429) {
      const retryAfter = xeroRes.headers.get('Retry-After') || '5';
      return reply(429, { error: 'Xero rate limit — retry after ' + retryAfter + 's' });
    }

    const data = await xeroRes.json();

    if (!xeroRes.ok) {
      console.error('Xero API error:', xeroRes.status, data);
      return reply(xeroRes.status, { error: data.Message || data.Detail || 'Xero API error' });
    }

    return reply(200, data);
  } catch (err) {
    console.error('Xero API fetch error:', err.message);
    return reply(500, { error: err.message });
  }
};
