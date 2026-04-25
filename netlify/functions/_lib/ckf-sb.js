// Supabase REST helpers for CKF. Service-key-only, server-side.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function ensureEnv() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }
}

async function sbFetch(path, opts = {}) {
  ensureEnv();
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: opts.method === 'POST' || opts.method === 'PATCH' ? 'return=representation' : '',
      ...(opts.headers || {}),
    },
  });
  return res;
}

async function sbSelect(table, query = '') {
  const res = await sbFetch(`/rest/v1/${table}${query ? `?${query}` : ''}`);
  if (!res.ok) throw new Error(`Supabase select ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbInsert(table, row) {
  const res = await sbFetch(`/rest/v1/${table}`, {
    method: 'POST',
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase insert ${table} failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

async function sbUpdate(table, query, patch) {
  const res = await sbFetch(`/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Supabase update ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbDelete(table, query) {
  const res = await sbFetch(`/rest/v1/${table}?${query}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Supabase delete ${table} failed: ${res.status} ${await res.text()}`);
  return true;
}

module.exports = { sbFetch, sbSelect, sbInsert, sbUpdate, sbDelete };
