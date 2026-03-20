/**
 * xero-status.js
 *
 * Check if Xero is connected and return org info.
 *
 * GET ?token=X → { connected, orgName, connectedAt }
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

  const { token } = event.queryStringParameters || {};

  const staff = await getStaffByToken(token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  const res = await sbFetch('/rest/v1/xero_tokens?id=eq.1&select=tenant_id,org_name,connected_at,access_token');
  const rows = await res.json();

  if (!rows || rows.length === 0 || !rows[0].access_token || !rows[0].tenant_id) {
    return reply(200, { connected: false });
  }

  return reply(200, {
    connected: true,
    orgName: rows[0].org_name,
    connectedAt: rows[0].connected_at,
  });
};
