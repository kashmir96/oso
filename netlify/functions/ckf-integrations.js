/**
 * ckf-integrations.js — gated router for OAuth integration management.
 *
 * Actions:
 *   status              -> { status: { whoop: {connected, ...}, google_calendar: {connected, ...} } }
 *   connect (provider)  -> { authorize_url } — frontend redirects to it
 *   disconnect (provider) -> { success } — deletes the stored row
 *
 * Token exchange happens in the public callback functions:
 *   ckf-google-oauth.js, ckf-whoop-oauth.js
 *
 * Env required per provider:
 *   google_calendar:  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (already set for Gmail/Ads)
 *   whoop:            WHOOP_CLIENT_ID,  WHOOP_CLIENT_SECRET
 */
const crypto = require('crypto');
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

const APP_URL = (process.env.APP_URL || 'https://oso.nz').replace(/\/$/, '');

const PROVIDERS = {
  google_calendar: {
    label: 'Google Calendar',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scopes: 'https://www.googleapis.com/auth/calendar.readonly openid email',
    redirect: `${APP_URL}/.netlify/functions/ckf-google-oauth`,
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    extraAuthorizeParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  },
  whoop: {
    label: 'Whoop',
    authorizeUrl: 'https://api.prod.whoop.com/oauth/oauth2/auth',
    scopes: 'read:recovery read:cycles read:workout read:sleep read:profile offline',
    redirect: `${APP_URL}/.netlify/functions/ckf-whoop-oauth`,
    clientIdEnv: 'WHOOP_CLIENT_ID',
    extraAuthorizeParams: {},
  },
};

async function getIntegration(userId, provider) {
  const rows = await sbSelect(
    'ckf_integrations',
    `user_id=eq.${userId}&provider=eq.${encodeURIComponent(provider)}&select=*&limit=1`
  );
  return rows?.[0] || null;
}

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action, provider } = body;

  // ── Status ──
  if (action === 'status') {
    const rows = await sbSelect(
      'ckf_integrations',
      `user_id=eq.${user.id}&select=provider,connected_at,scope,external_user_id,expires_at`
    );
    const status = {};
    for (const p of Object.keys(PROVIDERS)) {
      const row = rows.find((r) => r.provider === p);
      status[p] = row
        ? { connected: true, connected_at: row.connected_at, scope: row.scope, expires_at: row.expires_at }
        : { connected: false };
    }
    return reply(200, { status });
  }

  // ── Connect (return authorize URL) ──
  if (action === 'connect') {
    const cfg = PROVIDERS[provider];
    if (!cfg) return reply(400, { error: 'unknown provider' });
    const clientId = process.env[cfg.clientIdEnv];
    if (!clientId) {
      return reply(500, {
        error: `${cfg.clientIdEnv} not configured`,
        message: `Set ${cfg.clientIdEnv} in Netlify env to enable ${cfg.label}.`,
      });
    }

    // Generate a state token: random 24 hex bytes. Store with the user_id so
    // the public callback can validate. State expires in 15 min via the
    // state_created_at field (callback enforces).
    const state = crypto.randomBytes(24).toString('hex');
    const existing = await getIntegration(user.id, provider);
    const stateRow = {
      user_id: user.id,
      provider,
      access_token: existing?.access_token || '__pending__',
      refresh_token: existing?.refresh_token || null,
      expires_at: existing?.expires_at || null,
      scope: existing?.scope || null,
      external_user_id: existing?.external_user_id || null,
      oauth_state: state,
      state_created_at: new Date().toISOString(),
    };
    if (existing) {
      await sbUpdate('ckf_integrations', `id=eq.${existing.id}`, {
        oauth_state: state,
        state_created_at: stateRow.state_created_at,
      });
    } else {
      await sbInsert('ckf_integrations', stateRow);
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: cfg.redirect,
      scope: cfg.scopes,
      state,
      ...cfg.extraAuthorizeParams,
    });
    return reply(200, { authorize_url: `${cfg.authorizeUrl}?${params.toString()}` });
  }

  // ── Disconnect ──
  if (action === 'disconnect') {
    if (!PROVIDERS[provider]) return reply(400, { error: 'unknown provider' });
    await sbDelete('ckf_integrations', `user_id=eq.${user.id}&provider=eq.${encodeURIComponent(provider)}`);
    return reply(200, { success: true });
  }

  return reply(400, { error: 'Unknown action' });
});
