/**
 * xero-auth.js
 *
 * OAuth 2.0 authorization code flow for Xero.
 *
 * Two modes:
 *   GET ?action=authorize&token=X  → returns { url } to redirect user to Xero
 *   GET ?code=X&state=Y            → OAuth callback, exchanges code for tokens
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   XERO_CLIENT_ID, XERO_CLIENT_SECRET
 */

const crypto = require('crypto');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function reply(code, data) {
  return { statusCode: code, headers: HEADERS, body: JSON.stringify(data) };
}

function htmlReply(html) {
  return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html };
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

const SCOPES = 'openid profile email accounting.transactions.read accounting.reports.read accounting.contacts.read accounting.settings.read';

function getRedirectUri() {
  return 'https://www.oso.nz/.netlify/functions/xero-auth';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'GET') return reply(405, { error: 'GET only' });

  const qs = event.queryStringParameters || {};

  // ── Step 1: Initiate auth ──
  if (qs.action === 'authorize') {
    const staff = await getStaffByToken(qs.token);
    if (!staff) return reply(401, { error: 'Unauthorized' });
    if (!['owner', 'admin'].includes(staff.role)) return reply(403, { error: 'Admin or owner required' });

    const clientId = process.env.XERO_CLIENT_ID;
    if (!clientId) return reply(500, { error: 'XERO_CLIENT_ID not configured' });

    const state = crypto.randomBytes(32).toString('hex');

    // Store state in xero_tokens (upsert — only one row)
    await sbFetch('/rest/v1/xero_tokens', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        id: 1,
        oauth_state: state,
        state_created: new Date().toISOString(),
        connected_by: staff.id,
        access_token: '',
        refresh_token: '',
        tenant_id: '',
        expires_at: new Date(0).toISOString(),
      }),
    });

    const url = `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(getRedirectUri())}&scope=${encodeURIComponent(SCOPES)}&state=${state}`;

    return reply(200, { url });
  }

  // ── Step 2: OAuth callback ──
  if (qs.code && qs.state) {
    const clientId = process.env.XERO_CLIENT_ID;
    const clientSecret = process.env.XERO_CLIENT_SECRET;
    if (!clientId || !clientSecret) return reply(500, { error: 'Xero credentials not configured' });

    // Validate state
    const stateRes = await sbFetch('/rest/v1/xero_tokens?id=eq.1&select=oauth_state,state_created,connected_by');
    const stateRows = await stateRes.json();
    if (!stateRows || stateRows.length === 0 || stateRows[0].oauth_state !== qs.state) {
      return htmlReply('<html><body><h2>Invalid state — please try again.</h2><script>setTimeout(()=>window.close(),3000)</script></body></html>');
    }

    // Check state isn't stale (10 min max)
    const stateAge = Date.now() - new Date(stateRows[0].state_created).getTime();
    if (stateAge > 10 * 60 * 1000) {
      return htmlReply('<html><body><h2>Auth session expired — please try again.</h2><script>setTimeout(()=>window.close(),3000)</script></body></html>');
    }

    // Exchange code for tokens
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: qs.code,
        redirect_uri: getRedirectUri(),
      }).toString(),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('Xero token exchange failed:', tokenData);
      return htmlReply(`<html><body><h2>Token exchange failed</h2><p>${tokenData.error || 'Unknown error'}</p><script>setTimeout(()=>window.close(),5000)</script></body></html>`);
    }

    // Get tenant ID from connections
    const connRes = await fetch('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
    });
    const connections = await connRes.json();
    if (!connections || connections.length === 0) {
      return htmlReply('<html><body><h2>No Xero organisations found.</h2><script>setTimeout(()=>window.close(),3000)</script></body></html>');
    }

    const tenant = connections[0];
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // Store tokens
    await sbFetch('/rest/v1/xero_tokens?id=eq.1', {
      method: 'PATCH',
      body: JSON.stringify({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        tenant_id: tenant.tenantId,
        org_name: tenant.tenantName || null,
        expires_at: expiresAt,
        connected_at: new Date().toISOString(),
        oauth_state: null,
        state_created: null,
        updated_at: new Date().toISOString(),
      }),
    });

    return htmlReply(`<!DOCTYPE html><html><body style="background:#141210;color:#e8e2da;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
      <div style="text-align:center;">
        <h2 style="color:#8CB47A;">Connected to ${tenant.tenantName || 'Xero'}</h2>
        <p>This window will close automatically.</p>
      </div>
      <script>
        if (window.opener) window.opener.postMessage({xeroConnected:true},'*');
        setTimeout(()=>window.close(),2000);
      </script>
    </body></html>`);
  }

  return reply(400, { error: 'Missing action or code/state params' });
};
