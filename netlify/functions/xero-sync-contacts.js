/**
 * xero-sync-contacts.js
 *
 * Two-way sync between Xero contacts and suppliers/wholesalers tables.
 *
 * GET ?token=X&action=import
 *   Pull Xero contacts → upsert into suppliers (IsSupplier) / wholesalers (IsCustomer).
 *   Skips contacts already linked by xero_contact_id.
 *
 * GET ?token=X&action=push&type=suppliers|wholesalers&id=N
 *   Push a single supplier/wholesaler to Xero as a contact.
 *   Stores returned ContactID back on the record.
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, XERO_CLIENT_ID, XERO_CLIENT_SECRET
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
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: opts.prefer || '',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

async function getStaffByToken(token) {
  if (!token) return null;
  const res = await sbFetch(`/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id,role`);
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
  if (!res.ok || !data.access_token) return null;

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await sbFetch('/rest/v1/xero_tokens?id=eq.1', {
    method: 'PATCH',
    body: {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
  });

  return { ...tokens, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: expiresAt };
}

async function getValidTokens() {
  let tokens = await getXeroTokens();
  if (!tokens || !tokens.access_token || !tokens.tenant_id) return null;

  const expiresAt = new Date(tokens.expires_at).getTime();
  if (Date.now() > expiresAt - 60000) {
    tokens = await refreshAccessToken(tokens);
  }
  return tokens;
}

function xeroFetch(tokens, path, opts = {}) {
  return fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'xero-tenant-id': tokens.tenant_id,
      Accept: 'application/json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

// ── Import: Xero → Supabase ──
async function importContacts(tokens) {
  // Fetch all contacts from Xero (paginated, up to 100 per page)
  let page = 1;
  let allContacts = [];
  while (true) {
    const res = await xeroFetch(tokens, `Contacts?page=${page}&includeArchived=false`);
    if (!res.ok) {
      const err = await res.json();
      return { error: err.Message || 'Failed to fetch Xero contacts', status: res.status };
    }
    const data = await res.json();
    const contacts = data.Contacts || [];
    allContacts = allContacts.concat(contacts);
    if (contacts.length < 100) break;
    page++;
  }

  // Get existing linked IDs to avoid duplicates
  const [supRes, wsRes] = await Promise.all([
    sbFetch('/rest/v1/suppliers?select=xero_contact_id&active=eq.true&xero_contact_id=not.is.null'),
    sbFetch('/rest/v1/wholesalers?select=xero_contact_id&active=eq.true&xero_contact_id=not.is.null'),
  ]);
  const existingSup = (await supRes.json()) || [];
  const existingWs = (await wsRes.json()) || [];
  const linkedSupIds = new Set(existingSup.map(r => r.xero_contact_id));
  const linkedWsIds = new Set(existingWs.map(r => r.xero_contact_id));

  let imported = { suppliers: 0, wholesalers: 0, skipped: 0 };

  for (const c of allContacts) {
    const contactId = c.ContactID;
    const record = {
      name: c.Name || '',
      contact_name: (c.FirstName || '') + (c.LastName ? ' ' + c.LastName : ''),
      email: (c.EmailAddress || '').toLowerCase(),
      phone: '',
      address: '',
      xero_contact_id: contactId,
    };

    // Extract phone
    if (c.Phones && c.Phones.length > 0) {
      const ph = c.Phones.find(p => p.PhoneType === 'DEFAULT') || c.Phones[0];
      if (ph.PhoneNumber) record.phone = ph.PhoneNumber;
    }

    // Extract address
    if (c.Addresses && c.Addresses.length > 0) {
      const addr = c.Addresses.find(a => a.AddressType === 'STREET') || c.Addresses[0];
      const parts = [addr.AddressLine1, addr.AddressLine2, addr.City, addr.Region, addr.PostalCode, addr.Country].filter(Boolean);
      record.address = parts.join(', ');
    }

    // Clean up empty contact_name
    if (!record.contact_name.trim()) record.contact_name = '';

    // Import as supplier if IsSupplier
    if (c.IsSupplier && !linkedSupIds.has(contactId)) {
      await sbFetch('/rest/v1/suppliers', {
        method: 'POST',
        prefer: 'return=representation',
        body: record,
      });
      linkedSupIds.add(contactId);
      imported.suppliers++;

      // Register in contacts table
      if (record.email) {
        await sbFetch('/rest/v1/contacts', {
          method: 'POST',
          prefer: 'resolution=merge-duplicates',
          body: { email: record.email, name: record.contact_name || record.name, company: record.name, type: 'supplier' },
        });
      }
    }

    // Import as wholesaler if IsCustomer
    if (c.IsCustomer && !linkedWsIds.has(contactId)) {
      await sbFetch('/rest/v1/wholesalers', {
        method: 'POST',
        prefer: 'return=representation',
        body: record,
      });
      linkedWsIds.add(contactId);
      imported.wholesalers++;

      if (record.email) {
        await sbFetch('/rest/v1/contacts', {
          method: 'POST',
          prefer: 'resolution=merge-duplicates',
          body: { email: record.email, name: record.contact_name || record.name, company: record.name, type: 'wholesaler' },
        });
      }
    }

    if (!c.IsSupplier && !c.IsCustomer) imported.skipped++;
  }

  return { success: true, total: allContacts.length, imported };
}

// ── Push: Supabase → Xero ──
async function pushContact(tokens, type, id) {
  const table = type === 'suppliers' ? 'suppliers' : 'wholesalers';
  const res = await sbFetch(`/rest/v1/${table}?id=eq.${id}&select=*`);
  const rows = await res.json();
  if (!rows || rows.length === 0) return { error: 'Record not found' };

  const record = rows[0];
  if (record.xero_contact_id) return { error: 'Already linked to Xero', xero_contact_id: record.xero_contact_id };

  const xeroContact = {
    Name: record.name,
    FirstName: (record.contact_name || '').split(' ')[0] || '',
    LastName: (record.contact_name || '').split(' ').slice(1).join(' ') || '',
    EmailAddress: record.email || '',
    IsSupplier: type === 'suppliers',
    IsCustomer: type === 'wholesalers',
  };

  if (record.phone) {
    xeroContact.Phones = [{ PhoneType: 'DEFAULT', PhoneNumber: record.phone }];
  }

  if (record.address) {
    xeroContact.Addresses = [{ AddressType: 'STREET', AddressLine1: record.address }];
  }

  const xeroRes = await xeroFetch(tokens, 'Contacts', {
    method: 'POST',
    body: { Contacts: [xeroContact] },
  });

  const data = await xeroRes.json();
  if (!xeroRes.ok) {
    return { error: data.Message || data.Detail || 'Xero API error', status: xeroRes.status };
  }

  const created = data.Contacts && data.Contacts[0];
  if (created && created.ContactID) {
    await sbFetch(`/rest/v1/${table}?id=eq.${id}`, {
      method: 'PATCH',
      body: { xero_contact_id: created.ContactID },
    });
    return { success: true, xero_contact_id: created.ContactID };
  }

  return { error: 'No ContactID returned from Xero' };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'GET') return reply(405, { error: 'GET only' });

  const qs = event.queryStringParameters || {};
  const staff = await getStaffByToken(qs.token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  const tokens = await getValidTokens();
  if (!tokens) return reply(403, { error: 'Xero not connected' });

  if (qs.action === 'import') {
    const result = await importContacts(tokens);
    if (result.error) return reply(result.status || 500, { error: result.error });
    return reply(200, result);
  }

  if (qs.action === 'push') {
    const type = qs.type;
    const id = qs.id;
    if (!type || !['suppliers', 'wholesalers'].includes(type)) return reply(400, { error: 'Invalid type' });
    if (!id) return reply(400, { error: 'id required' });
    const result = await pushContact(tokens, type, id);
    if (result.error) return reply(result.status || 400, result);
    return reply(200, result);
  }

  return reply(400, { error: 'action required: import or push' });
};
