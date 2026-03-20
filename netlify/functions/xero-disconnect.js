/**
 * xero-disconnect.js
 *
 * Remove Xero connection (admin/owner only).
 *
 * POST { token }
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
  const res = await sbFetch(`/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id,role`);
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const staff = await getStaffByToken(body.token);
  if (!staff) return reply(401, { error: 'Unauthorized' });
  if (!['owner', 'admin'].includes(staff.role)) return reply(403, { error: 'Admin or owner required' });

  // Delete the token row
  await sbFetch('/rest/v1/xero_tokens?id=eq.1', { method: 'DELETE' });

  return reply(200, { success: true });
};
