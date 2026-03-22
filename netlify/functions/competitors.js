/**
 * competitors.js
 *
 * CRUD API for managing competitor tracking entries.
 * GET  ?token=X                → list active competitors + recent changes
 * GET  ?token=X&id=N&changes=1 → change log for one competitor
 * POST ?token=X  body {name,url} → add competitor
 * DELETE ?token=X&id=N         → soft-delete (set active=false)
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
      ...opts.headers,
    },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

async function getStaffByToken(token) {
  if (!token) return null;
  const res = await sbFetch(`/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id`);
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');

  const qs = event.queryStringParameters || {};
  const staff = await getStaffByToken(qs.token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  // ── GET: list competitors or get changes ──
  if (event.httpMethod === 'GET') {
    // Single competitor change log
    if (qs.id && qs.changes) {
      const res = await sbFetch(
        `/rest/v1/competitor_changes?competitor_id=eq.${qs.id}&order=detected_at.desc&limit=100`
      );
      const changes = await res.json();
      return reply(200, { changes });
    }

    // List all active competitors with last check time + change count
    const compRes = await sbFetch('/rest/v1/competitors?active=eq.true&order=name.asc');
    const competitors = await compRes.json();

    // Get latest snapshot per competitor for "last checked"
    const snapRes = await sbFetch(
      '/rest/v1/competitor_snapshots?select=competitor_id,checked_at&order=checked_at.desc'
    );
    const snaps = await snapRes.json();
    const lastChecked = {};
    for (const s of snaps) {
      if (!lastChecked[s.competitor_id]) lastChecked[s.competitor_id] = s.checked_at;
    }

    // Get change counts per competitor
    const chRes = await sbFetch(
      '/rest/v1/competitor_changes?select=competitor_id'
    );
    const allChanges = await chRes.json();
    const changeCounts = {};
    for (const c of allChanges) {
      changeCounts[c.competitor_id] = (changeCounts[c.competitor_id] || 0) + 1;
    }

    // Get recent changes across all competitors (last 50)
    const recentRes = await sbFetch(
      '/rest/v1/competitor_changes?order=detected_at.desc&limit=50'
    );
    const recentChanges = await recentRes.json();

    const enriched = competitors.map(c => ({
      ...c,
      last_checked: lastChecked[c.id] || null,
      change_count: changeCounts[c.id] || 0,
    }));

    return reply(200, { competitors: enriched, recent_changes: recentChanges });
  }

  // ── POST: add competitor ──
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body); } catch { return reply(400, { error: 'Invalid JSON' }); }
    const { name, url } = body;
    if (!name || !url) return reply(400, { error: 'name and url required' });

    // Normalize URL
    let cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) cleanUrl = 'https://' + cleanUrl;
    // Remove trailing slash
    cleanUrl = cleanUrl.replace(/\/+$/, '');

    const res = await sbFetch('/rest/v1/competitors', {
      method: 'POST',
      prefer: 'return=representation',
      body: { name: name.trim(), url: cleanUrl },
    });
    const created = await res.json();
    return reply(201, { competitor: created[0] || created });
  }

  // ── DELETE: soft-delete competitor ──
  if (event.httpMethod === 'DELETE') {
    if (!qs.id) return reply(400, { error: 'id required' });
    await sbFetch(`/rest/v1/competitors?id=eq.${qs.id}`, {
      method: 'PATCH',
      body: { active: false },
    });
    return reply(200, { ok: true });
  }

  return reply(405, { error: 'Method not allowed' });
};
