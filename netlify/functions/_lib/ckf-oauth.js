// Token-refresh helpers for stored OAuth integrations.
// Both Google and Whoop expose access tokens with short TTLs and refresh tokens
// for renewing them. This module hides that bookkeeping.
const { sbSelect, sbUpdate } = require('./ckf-sb.js');

async function getIntegration(userId, provider) {
  const rows = await sbSelect(
    'ckf_integrations',
    `user_id=eq.${userId}&provider=eq.${encodeURIComponent(provider)}&select=*&limit=1`
  );
  return rows?.[0] || null;
}

async function refreshGoogle(integration) {
  if (!integration?.refresh_token) throw new Error('Google: no refresh_token stored');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: integration.refresh_token,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Google refresh failed: ${j?.error_description || j?.error || res.status}`);
  const expiresAt = j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null;
  await sbUpdate('ckf_integrations', `id=eq.${integration.id}`, {
    access_token: j.access_token,
    expires_at: expiresAt,
  });
  return { ...integration, access_token: j.access_token, expires_at: expiresAt };
}

async function refreshWhoop(integration) {
  if (!integration?.refresh_token) throw new Error('Whoop: no refresh_token stored');
  const res = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: integration.refresh_token,
      client_id: process.env.WHOOP_CLIENT_ID,
      client_secret: process.env.WHOOP_CLIENT_SECRET,
      scope: 'offline',
    }).toString(),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Whoop refresh failed: ${j?.error_description || j?.error || res.status}`);
  const expiresAt = j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null;
  await sbUpdate('ckf_integrations', `id=eq.${integration.id}`, {
    access_token: j.access_token,
    refresh_token: j.refresh_token || integration.refresh_token,
    expires_at: expiresAt,
  });
  return { ...integration, access_token: j.access_token, refresh_token: j.refresh_token || integration.refresh_token, expires_at: expiresAt };
}

const REFRESHERS = {
  google_calendar: refreshGoogle,
  whoop: refreshWhoop,
};

// Get a valid (refreshed if needed) integration. Refreshes ~60s before expiry.
async function getValidIntegration(userId, provider) {
  let row = await getIntegration(userId, provider);
  if (!row) return null;
  if (!row.access_token || row.access_token === '__pending__') return null;
  if (row.expires_at) {
    const expiresInMs = new Date(row.expires_at).getTime() - Date.now();
    if (expiresInMs < 60_000) {
      const refresher = REFRESHERS[provider];
      if (refresher) row = await refresher(row);
    }
  }
  return row;
}

module.exports = { getIntegration, getValidIntegration, refreshGoogle, refreshWhoop };
