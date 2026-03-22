/**
 * gmail-auth.js
 *
 * OAuth 2.0 flow for connecting Gmail accounts (multi-account).
 * Separate from google-auth.js which handles Ads + Merchant Center.
 *
 * Actions:
 *   GET ?action=authorize&token=X       → returns { url } for Google OAuth
 *   GET ?code=X&state=Y                 → OAuth callback, exchanges code for tokens
 *   GET ?action=status&token=X          → list connected Gmail accounts
 *   GET ?action=disconnect&token=X&id=N → deactivate a Gmail account
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
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
      ...(opts.prefer ? { Prefer: opts.prefer } : {}),
      ...opts.headers,
    },
    method: opts.method || 'GET',
    body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
}

async function getStaffByToken(token) {
  if (!token) return null;
  const res = await sbFetch(`/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id,role,display_name`);
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

function getRedirectUri() {
  return 'https://oso.nz/.netlify/functions/gmail-auth';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'GET') return reply(405, { error: 'GET only' });

  const qs = event.queryStringParameters || {};

  // ── Status: list connected accounts ──
  if (qs.action === 'status') {
    const staff = await getStaffByToken(qs.token);
    if (!staff) return reply(401, { error: 'Unauthorized' });

    const res = await sbFetch('/rest/v1/gmail_accounts?active=eq.true&select=id,email_address,display_name,connected_at&order=connected_at.asc');
    const accounts = await res.json();
    return reply(200, { accounts: accounts || [] });
  }

  // ── Disconnect ──
  if (qs.action === 'disconnect') {
    const staff = await getStaffByToken(qs.token);
    if (!staff) return reply(401, { error: 'Unauthorized' });
    if (!['owner', 'admin'].includes(staff.role)) return reply(403, { error: 'Admin or owner required' });
    if (!qs.id) return reply(400, { error: 'id required' });

    await sbFetch(`/rest/v1/gmail_accounts?id=eq.${qs.id}`, {
      method: 'PATCH',
      body: { active: false, access_token: '', refresh_token: '' },
    });
    return reply(200, { success: true });
  }

  // ── Step 1: Initiate auth ──
  if (qs.action === 'authorize') {
    const staff = await getStaffByToken(qs.token);
    if (!staff) return reply(401, { error: 'Unauthorized' });
    if (!['owner', 'admin'].includes(staff.role)) return reply(403, { error: 'Admin or owner required' });

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return reply(500, { error: 'GOOGLE_CLIENT_ID not configured' });

    const state = crypto.randomBytes(32).toString('hex');

    // Clean up any old pending rows
    await sbFetch('/rest/v1/gmail_accounts?email_address=like.pending_*@temp', { method: 'DELETE' });

    // Store state temporarily in a placeholder row
    await sbFetch('/rest/v1/gmail_accounts', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        email_address: `pending_${state.slice(0, 8)}@temp`,
        oauth_state: state,
        state_created: new Date().toISOString(),
        connected_by: staff.id,
        active: false,
      },
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(getRedirectUri())}&scope=${encodeURIComponent(SCOPES)}&state=${state}&access_type=offline&prompt=consent`;

    return reply(200, { url });
  }

  // ── Step 2: OAuth callback ──
  if (qs.code && qs.state) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return reply(500, { error: 'Google credentials not configured' });

    // Validate state
    const stateRes = await sbFetch(`/rest/v1/gmail_accounts?oauth_state=eq.${encodeURIComponent(qs.state)}&select=id,state_created,connected_by`);
    const stateRows = await stateRes.json();
    if (!stateRows || stateRows.length === 0) {
      return htmlReply('<html><body style="background:#141210;color:#e8e2da;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><h2>Invalid state — please try again.</h2></body></html>');
    }

    const pendingRow = stateRows[0];

    // Check state isn't stale (10 min max)
    const stateAge = Date.now() - new Date(pendingRow.state_created).getTime();
    if (stateAge > 10 * 60 * 1000) {
      // Clean up temp row
      await sbFetch(`/rest/v1/gmail_accounts?id=eq.${pendingRow.id}`, { method: 'DELETE' });
      return htmlReply('<html><body style="background:#141210;color:#e8e2da;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><h2>Auth session expired — please try again.</h2></body></html>');
    }

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: qs.code,
        redirect_uri: getRedirectUri(),
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      await sbFetch(`/rest/v1/gmail_accounts?id=eq.${pendingRow.id}`, { method: 'DELETE' });
      return htmlReply(`<!DOCTYPE html><html><body style="background:#141210;color:#e8e2da;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><div style="text-align:center;"><h2>Token exchange failed</h2><p>${tokenData.error_description || tokenData.error || 'Unknown error'}</p></div></body></html>`);
    }

    // Get user's email address from Google
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();
    const emailAddress = profile.email || 'unknown@gmail.com';

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // Delete the temp pending row
    await sbFetch(`/rest/v1/gmail_accounts?id=eq.${pendingRow.id}`, { method: 'DELETE' });

    // Delete any existing row with this email (clean re-connect)
    await sbFetch(`/rest/v1/gmail_accounts?email_address=eq.${encodeURIComponent(emailAddress)}`, { method: 'DELETE' });

    // Insert fresh row with tokens
    const insertRes = await sbFetch('/rest/v1/gmail_accounts', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        email_address: emailAddress,
        display_name: profile.name || emailAddress,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || '',
        expires_at: expiresAt,
        connected_at: new Date().toISOString(),
        connected_by: pendingRow.connected_by,
        active: true,
      },
    });
    const insertData = await insertRes.json();
    console.log('Gmail account insert result:', JSON.stringify(insertData));

    return htmlReply(`<!DOCTYPE html><html><body style="background:#141210;color:#e8e2da;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
      <div style="text-align:center;">
        <h2 style="color:#8CB47A;">Gmail Connected</h2>
        <p>${emailAddress} is now linked to your dashboard.</p>
        <p style="color:#6e6259;">This window will close automatically.</p>
      </div>
      <script>
        if (window.opener) window.opener.postMessage({gmailConnected:true},'*');
        setTimeout(()=>window.close(),3000);
      </script>
    </body></html>`);
  }

  return reply(400, { error: 'Missing action or code/state params' });
};
