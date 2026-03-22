/**
 * suppliers.js
 *
 * CRUD API for suppliers and wholesalers.
 * GET    ?token=X&type=suppliers|wholesalers  → list
 * POST   ?token=X  body {type, name, ...}     → create
 * PATCH  ?token=X&id=N  body {type, fields}   → update
 * DELETE ?token=X&id=N&type=suppliers|wholesalers → soft-delete
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
  return fetch(`${process.env.SUPABASE_URL}${path}`, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': opts.prefer || '',
    },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

async function getStaffByToken(token) {
  if (!token) return null;
  const res = await sbFetch(`/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id,role`);
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

const VALID_TYPES = ['suppliers', 'wholesalers'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');

  const qs = event.queryStringParameters || {};
  const staff = await getStaffByToken(qs.token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  // ── GET: list ──
  if (event.httpMethod === 'GET') {
    const type = qs.type || 'suppliers';
    if (!VALID_TYPES.includes(type)) return reply(400, { error: 'Invalid type' });

    const res = await sbFetch(`/rest/v1/${type}?active=eq.true&order=name.asc`);
    const rows = await res.json();
    return reply(200, { [type]: rows || [] });
  }

  // ── POST: create ──
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body); } catch { return reply(400, { error: 'Invalid JSON' }); }

    const type = body.type || 'suppliers';
    if (!VALID_TYPES.includes(type)) return reply(400, { error: 'Invalid type' });
    if (!body.name) return reply(400, { error: 'name required' });

    const record = {
      name: body.name.trim(),
      contact_name: (body.contact_name || '').trim(),
      email: (body.email || '').trim().toLowerCase(),
      phone: (body.phone || '').trim(),
      website: (body.website || '').trim(),
      address: (body.address || '').trim(),
      payment_terms: (body.payment_terms || '').trim(),
      notes: (body.notes || '').trim(),
    };

    const res = await sbFetch(`/rest/v1/${type}`, {
      method: 'POST',
      prefer: 'return=representation',
      body: record,
    });
    const created = await res.json();

    // Auto-register in contacts table if email provided
    if (record.email) {
      const contactType = type === 'suppliers' ? 'supplier' : 'wholesaler';
      await sbFetch('/rest/v1/contacts', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates',
        body: {
          email: record.email,
          name: record.contact_name || record.name,
          company: record.name,
          type: contactType,
        },
      });
    }

    return reply(201, { created: created[0] || created });
  }

  // ── PATCH: update ──
  if (event.httpMethod === 'PATCH') {
    if (!qs.id) return reply(400, { error: 'id required' });

    let body;
    try { body = JSON.parse(event.body); } catch { return reply(400, { error: 'Invalid JSON' }); }

    const type = body.type || qs.type || 'suppliers';
    if (!VALID_TYPES.includes(type)) return reply(400, { error: 'Invalid type' });

    const fields = {};
    const allowed = ['name', 'contact_name', 'email', 'phone', 'website', 'address', 'payment_terms', 'notes'];
    for (const k of allowed) {
      if (body[k] !== undefined) fields[k] = typeof body[k] === 'string' ? body[k].trim() : body[k];
    }
    if (fields.email) fields.email = fields.email.toLowerCase();

    await sbFetch(`/rest/v1/${type}?id=eq.${qs.id}`, {
      method: 'PATCH',
      body: fields,
    });

    // Update contacts if email changed
    if (fields.email) {
      const contactType = type === 'suppliers' ? 'supplier' : 'wholesaler';
      await sbFetch('/rest/v1/contacts', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates',
        body: {
          email: fields.email,
          name: fields.contact_name || fields.name || '',
          company: fields.name || '',
          type: contactType,
        },
      });
    }

    return reply(200, { ok: true });
  }

  // ── DELETE: soft-delete ──
  if (event.httpMethod === 'DELETE') {
    if (!qs.id) return reply(400, { error: 'id required' });
    const type = qs.type || 'suppliers';
    if (!VALID_TYPES.includes(type)) return reply(400, { error: 'Invalid type' });

    await sbFetch(`/rest/v1/${type}?id=eq.${qs.id}`, {
      method: 'PATCH',
      body: { active: false },
    });

    return reply(200, { ok: true });
  }

  return reply(405, { error: 'Method not allowed' });
};
