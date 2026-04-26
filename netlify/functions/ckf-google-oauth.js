/**
 * ckf-google-oauth.js — public callback for Google Calendar OAuth.
 *
 * Google redirects here with ?code=...&state=... after the user consents.
 * We validate state against ckf_integrations.oauth_state (15-min TTL),
 * exchange the code for tokens, store them, then redirect the user back
 * into the app at /ckf/settings?connected=google_calendar.
 *
 * NOT auth-gated — Google can't carry a session cookie. Security: the state
 * token is single-use (we clear it on success) and bound to a specific user.
 *
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
const { sbSelect, sbUpdate } = require('./_lib/ckf-sb.js');

const APP_URL = (process.env.APP_URL || 'https://oso.nz').replace(/\/$/, '');
const REDIRECT_URI = `${APP_URL}/.netlify/functions/ckf-google-oauth`;

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
     <h1>Couldn't connect Google Calendar</h1><p>${msg}</p>
     <p><a href="${APP_URL}/ckf/settings">Back to Settings</a></p>`,
    400
  );
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};

  if (qs.error) return errorPage(`Google returned error: ${qs.error_description || qs.error}`);
  if (!qs.code || !qs.state) return errorPage('Missing code or state. The link may be expired.');
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return errorPage('Server is missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.');
  }

  // ── Validate state ──
  const rows = await sbSelect(
    'ckf_integrations',
    `oauth_state=eq.${encodeURIComponent(qs.state)}&provider=eq.google_calendar&select=*&limit=1`
  );
  const pending = rows?.[0];
  if (!pending) return errorPage('State token not recognised. Please reconnect from Settings.');

  const stateAge = pending.state_created_at ? Date.now() - new Date(pending.state_created_at).getTime() : Infinity;
  if (stateAge > 15 * 60 * 1000) return errorPage('Connection link expired. Please reconnect from Settings.');

  // ── Exchange code for tokens ──
  let tokenJson;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: qs.code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    });
    tokenJson = await res.json();
    if (!res.ok) return errorPage(`Google token exchange failed: ${tokenJson?.error_description || tokenJson?.error || res.status}`);
  } catch (e) {
    return errorPage(`Token exchange threw: ${e.message}`);
  }

  // tokenJson: { access_token, expires_in, refresh_token?, scope, token_type, id_token? }
  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
    : null;

  // Pull the email from id_token if present (so we know which Google account is connected).
  let externalUserId = null;
  if (tokenJson.id_token) {
    try {
      const payload = JSON.parse(Buffer.from(tokenJson.id_token.split('.')[1], 'base64').toString('utf8'));
      externalUserId = payload.email || payload.sub || null;
    } catch {}
  }

  // ── Persist tokens ──
  await sbUpdate(
    'ckf_integrations',
    `id=eq.${pending.id}`,
    {
      access_token: tokenJson.access_token,
      // Google only returns refresh_token on first consent. Preserve any prior one.
      refresh_token: tokenJson.refresh_token || pending.refresh_token || null,
      expires_at: expiresAt,
      scope: tokenJson.scope || null,
      external_user_id: externalUserId,
      oauth_state: null,
      state_created_at: null,
      connected_at: new Date().toISOString(),
    }
  );

  return redirect(`${APP_URL}/ckf/settings?connected=google_calendar`);
};
