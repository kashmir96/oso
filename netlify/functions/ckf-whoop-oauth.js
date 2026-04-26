/**
 * ckf-whoop-oauth.js — public callback for Whoop OAuth.
 *
 * Whoop redirects here with ?code=...&state=... after consent.
 * Validates state, exchanges code for tokens, stores them.
 *
 * NOT auth-gated. State token is single-use, 15-min TTL, bound to user_id.
 *
 * Env: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
const { sbSelect, sbUpdate } = require('./_lib/ckf-sb.js');

const APP_URL = (process.env.APP_URL || 'https://oso.nz').replace(/\/$/, '');
const REDIRECT_URI = `${APP_URL}/.netlify/functions/ckf-whoop-oauth`;
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

function htmlReply(html, status = 200) {
  return { statusCode: status, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html };
}
function redirect(to) {
  return { statusCode: 302, headers: { Location: to }, body: '' };
}
function errorPage(msg) {
  return htmlReply(
    `<!doctype html><meta charset="utf-8"><title>CKF — connection failed</title>
     <style>body{font-family:system-ui;background:#0e0f12;color:#e8eaed;padding:40px;max-width:560px;margin:0 auto}
     a{color:#7ec8a4}h1{font-size:18px}p{color:#9aa0a6}</style>
     <h1>Couldn't connect Whoop</h1><p>${msg}</p>
     <p><a href="${APP_URL}/ckf/settings">Back to Settings</a></p>`,
    400
  );
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  if (qs.error) return errorPage(`Whoop returned error: ${qs.error_description || qs.error}`);
  if (!qs.code || !qs.state) return errorPage('Missing code or state.');
  if (!process.env.WHOOP_CLIENT_ID || !process.env.WHOOP_CLIENT_SECRET) {
    return errorPage('Server is missing WHOOP_CLIENT_ID or WHOOP_CLIENT_SECRET.');
  }

  const rows = await sbSelect(
    'ckf_integrations',
    `oauth_state=eq.${encodeURIComponent(qs.state)}&provider=eq.whoop&select=*&limit=1`
  );
  const pending = rows?.[0];
  if (!pending) return errorPage('State token not recognised. Please reconnect from Settings.');
  const stateAge = pending.state_created_at ? Date.now() - new Date(pending.state_created_at).getTime() : Infinity;
  if (stateAge > 15 * 60 * 1000) return errorPage('Connection link expired. Please reconnect from Settings.');

  let tokenJson;
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: qs.code,
        client_id: process.env.WHOOP_CLIENT_ID,
        client_secret: process.env.WHOOP_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    });
    tokenJson = await res.json();
    if (!res.ok) return errorPage(`Whoop token exchange failed: ${tokenJson?.error_description || tokenJson?.error || res.status}`);
  } catch (e) {
    return errorPage(`Token exchange threw: ${e.message}`);
  }

  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
    : null;

  await sbUpdate(
    'ckf_integrations',
    `id=eq.${pending.id}`,
    {
      access_token: tokenJson.access_token,
      refresh_token: tokenJson.refresh_token || pending.refresh_token || null,
      expires_at: expiresAt,
      scope: tokenJson.scope || null,
      external_user_id: null,
      oauth_state: null,
      state_created_at: null,
      connected_at: new Date().toISOString(),
    }
  );

  return redirect(`${APP_URL}/ckf/settings?connected=whoop`);
};
