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

async function tryPushToXero(record, type, id) {
  try {
    const tokRes = await sbFetch('/rest/v1/xero_tokens?id=eq.1&select=access_token,refresh_token,tenant_id,expires_at');
    const rows = await tokRes.json();
    if (!Array.isArray(rows) || rows.length === 0 || !rows[0].access_token || !rows[0].tenant_id) return;
    let tokens = rows[0];

    // Refresh if expired
    if (Date.now() > new Date(tokens.expires_at).getTime() - 60000) {
      const clientId = process.env.XERO_CLIENT_ID;
      const clientSecret = process.env.XERO_CLIENT_SECRET;
      if (!clientId || !clientSecret) return;
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const refRes = await fetch('https://identity.xero.com/connect/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basicAuth}` },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }).toString(),
      });
      const refData = await refRes.json();
      if (!refRes.ok || !refData.access_token) return;
      tokens.access_token = refData.access_token;
      tokens.refresh_token = refData.refresh_token;
      await sbFetch('/rest/v1/xero_tokens?id=eq.1', {
        method: 'PATCH',
        body: { access_token: refData.access_token, refresh_token: refData.refresh_token, expires_at: new Date(Date.now() + refData.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() },
      });
    }

    const xeroContact = {
      Name: record.name,
      FirstName: (record.contact_name || '').split(' ')[0] || '',
      LastName: (record.contact_name || '').split(' ').slice(1).join(' ') || '',
      EmailAddress: record.email || '',
      IsSupplier: type === 'suppliers',
      IsCustomer: type === 'wholesalers',
    };
    if (record.phone) xeroContact.Phones = [{ PhoneType: 'DEFAULT', PhoneNumber: record.phone }];
    if (record.address) xeroContact.Addresses = [{ AddressType: 'STREET', AddressLine1: record.address }];

    const xRes = await fetch('https://api.xero.com/api.xro/2.0/Contacts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'xero-tenant-id': tokens.tenant_id,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ Contacts: [xeroContact] }),
    });

    const xData = await xRes.json();
    if (xRes.ok && xData.Contacts && xData.Contacts[0] && xData.Contacts[0].ContactID) {
      await sbFetch(`/rest/v1/${type}?id=eq.${id}`, {
        method: 'PATCH',
        body: { xero_contact_id: xData.Contacts[0].ContactID },
      });
    }
  } catch (e) {
    console.error('Xero push failed (non-fatal):', e.message);
  }
}

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
    const createdRecord = created[0] || created;

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

    // Auto-push to Xero (best-effort)
    if (createdRecord.id) {
      await tryPushToXero(record, type, createdRecord.id);
    }

    return reply(201, { created: createdRecord });
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
