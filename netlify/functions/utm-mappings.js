/**
 * utm-mappings.js
 *
 * CRUD for UTM ID-to-friendly-name mappings.
 * Maps cryptic ad platform IDs (campaign, adgroup, content) to readable names.
 *
 * Actions: list, upsert, delete, bulk-upsert
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function reply(statusCode, data) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(data) };
}

async function sbFetch(url, opts = {}) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
  };
  return fetch(`${SUPABASE_URL}${url}`, {
    ...opts,
    headers: { ...defaultHeaders, ...opts.headers },
  });
}

async function verifyToken(token) {
  if (!token) return null;
  const res = await sbFetch(`/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id,username`);
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, '');

  const params = event.queryStringParameters || {};
  const action = params.action || 'list';
  const token = params.token;

  const staff = await verifyToken(token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  try {
    // ── LIST ──
    if (action === 'list') {
      const res = await sbFetch('/rest/v1/utm_mappings?select=*&order=utm_field,utm_value');
      const rows = await res.json();
      return reply(200, rows || []);
    }

    // ── UPSERT (single) ──
    if (action === 'upsert') {
      const body = JSON.parse(event.body || '{}');
      const { utm_field, utm_value, friendly_name, platform } = body;
      if (!utm_field || !utm_value || !friendly_name) {
        return reply(400, { error: 'utm_field, utm_value, and friendly_name are required' });
      }
      const res = await sbFetch('/rest/v1/utm_mappings', {
        method: 'POST',
        headers: {
          'Prefer': 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify({
          utm_field,
          utm_value: utm_value.trim(),
          friendly_name: friendly_name.trim(),
          platform: platform || null,
        }),
      });
      const result = await res.json();
      return reply(200, result);
    }

    // ── BULK UPSERT ──
    if (action === 'bulk-upsert') {
      const body = JSON.parse(event.body || '[]');
      if (!Array.isArray(body) || body.length === 0) {
        return reply(400, { error: 'Expected array of mappings' });
      }
      const rows = body.map(r => ({
        utm_field: r.utm_field,
        utm_value: (r.utm_value || '').trim(),
        friendly_name: (r.friendly_name || '').trim(),
        platform: r.platform || null,
      })).filter(r => r.utm_field && r.utm_value && r.friendly_name);

      const res = await sbFetch('/rest/v1/utm_mappings', {
        method: 'POST',
        headers: {
          'Prefer': 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify(rows),
      });
      const result = await res.json();
      return reply(200, result);
    }

    // ── DELETE ──
    if (action === 'delete') {
      const body = JSON.parse(event.body || '{}');
      const { id } = body;
      if (!id) return reply(400, { error: 'id required' });
      await sbFetch(`/rest/v1/utm_mappings?id=eq.${id}`, { method: 'DELETE' });
      return reply(200, { ok: true });
    }

    return reply(400, { error: 'Unknown action: ' + action });
  } catch (err) {
    console.error('[utm-mappings]', err);
    return reply(500, { error: err.message });
  }
};
