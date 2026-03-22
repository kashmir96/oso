/**
 * google-auth.js
 *
 * OAuth 2.0 authorization code flow for Google (Ads + Merchant Center).
 *
 * Three modes:
 *   GET ?action=authorize&token=X  → returns { url } to redirect user to Google
 *   GET ?code=X&state=Y            → OAuth callback, exchanges code for tokens
 *   GET ?action=status&token=X     → returns connection status
 *
 * After connecting, user must provide their Google Ads customer ID and
 * Merchant Center ID via the dashboard (PATCH stored separately).
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   GOOGLE_ADS_DEVELOPER_TOKEN
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
  return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html };
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

const SCOPES = [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/content',
].join(' ');

function getRedirectUri() {
  return 'https://oso.nz/.netlify/functions/google-auth';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'GET') return reply(405, { error: 'GET only' });

  const qs = event.queryStringParameters || {};

  // ── Status check ──
  if (qs.action === 'status') {
    const staff = await getStaffByToken(qs.token);
    if (!staff) return reply(401, { error: 'Unauthorized' });

    const res = await sbFetch('/rest/v1/google_tokens?id=eq.1&select=access_token,ads_customer_id,merchant_id,connected_at');
    const rows = await res.json();

    if (!rows || rows.length === 0 || !rows[0].access_token) {
      return reply(200, { connected: false });
    }

    return reply(200, {
      connected: true,
      adsCustomerId: rows[0].ads_customer_id || null,
      merchantId: rows[0].merchant_id || null,
      connectedAt: rows[0].connected_at,
    });
  }

  // ── Disconnect ──
  if (qs.action === 'disconnect') {
    const staff = await getStaffByToken(qs.token);
    if (!staff) return reply(401, { error: 'Unauthorized' });
    if (!['owner', 'admin'].includes(staff.role)) return reply(403, { error: 'Admin or owner required' });

    await sbFetch('/rest/v1/google_tokens?id=eq.1', {
      method: 'PATCH',
      body: JSON.stringify({
        access_token: '',
        refresh_token: '',
        expires_at: new Date(0).toISOString(),
        merchant_id: '',
        ads_customer_id: '',
        oauth_state: null,
        state_created: null,
        connected_at: null,
        updated_at: new Date().toISOString(),
      }),
    });

    return reply(200, { success: true });
  }

  // ── Save account IDs ──
  if (qs.action === 'save_ids') {
    const staff = await getStaffByToken(qs.token);
    if (!staff) return reply(401, { error: 'Unauthorized' });
    if (!['owner', 'admin'].includes(staff.role)) return reply(403, { error: 'Admin or owner required' });

    const patch = {};
    if (qs.ads_customer_id) patch.ads_customer_id = qs.ads_customer_id.replace(/-/g, '');
    if (qs.merchant_id) patch.merchant_id = qs.merchant_id;
    patch.updated_at = new Date().toISOString();

    await sbFetch('/rest/v1/google_tokens?id=eq.1', {
      method: 'PATCH',
      body: JSON.stringify(patch),
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

    const upsertRes = await sbFetch('/rest/v1/google_tokens?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        id: 1,
        oauth_state: state,
        state_created: new Date().toISOString(),
        connected_by: staff.id,
        access_token: '',
        refresh_token: '',
        expires_at: new Date(0).toISOString(),
      }),
    });

    if (!upsertRes.ok) {
      const errBody = await upsertRes.text();
      console.error('Failed to save OAuth state:', upsertRes.status, errBody);
      return reply(500, { error: 'Failed to initiate auth — could not save state' });
    }

    const url = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(getRedirectUri())}&scope=${encodeURIComponent(SCOPES)}&state=${state}&access_type=offline&prompt=consent`;

    return reply(200, { url });
  }

  // ── Step 2: OAuth callback ──
  if (qs.code && qs.state) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return reply(500, { error: 'Google credentials not configured' });

    // Validate state
    const stateRes = await sbFetch('/rest/v1/google_tokens?id=eq.1&select=oauth_state,state_created,connected_by');
    const stateRows = await stateRes.json();
    if (!Array.isArray(stateRows) || stateRows.length === 0 || stateRows[0].oauth_state !== qs.state) {
      return htmlReply('<html><body style="background:#141210;color:#e8e2da;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><h2>Invalid state \u2014 please try again.</h2></body></html>');
    }

    // Check state isn't stale (10 min max)
    const stateAge = Date.now() - new Date(stateRows[0].state_created).getTime();
    if (stateAge > 10 * 60 * 1000) {
      return htmlReply('<html><body style="background:#141210;color:#e8e2da;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><h2>Auth session expired \u2014 please try again.</h2></body></html>');
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
      console.error('Google token exchange failed:', tokenData);
      return htmlReply(`<!DOCTYPE html><html><body style="background:#141210;color:#e8e2da;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><div style="text-align:center;"><h2>Token exchange failed</h2><p>${tokenData.error_description || tokenData.error || 'Unknown error'}</p></div></body></html>`);
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    await sbFetch('/rest/v1/google_tokens?id=eq.1', {
      method: 'PATCH',
      body: JSON.stringify({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || '',
        expires_at: expiresAt,
        connected_at: new Date().toISOString(),
        oauth_state: null,
        state_created: null,
        updated_at: new Date().toISOString(),
      }),
    });

    return htmlReply(`<!DOCTYPE html><html><body style="background:#141210;color:#e8e2da;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
      <div style="text-align:center;">
        <h2 style="color:#8CB47A;">Google Connected</h2>
        <p>You can now enter your Google Ads Customer ID and Merchant Center ID in the dashboard.</p>
        <p style="color:#6e6259;">This window will close automatically.</p>
      </div>
      <script>
        if (window.opener) window.opener.postMessage({googleConnected:true},'*');
        setTimeout(()=>window.close(),3000);
      </script>
    </body></html>`);
  }

  return reply(400, { error: 'Missing action or code/state params' });
};
