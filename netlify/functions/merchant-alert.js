/**
 * merchant-alert.js
 *
 * Netlify scheduled function – runs every hour.
 * Compares current Google Merchant Center product statuses against
 * the last known snapshot stored in Supabase (merchant_status_snapshot).
 * Sends an SMS via Twilio when any product loses its "approved" status.
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   TWILIO_SID, TWILIO_API, TWILIO_FROM_NUMBER
 *   ALERT_PHONE_NUMBERS  (comma-separated)
 */

function sbFetch(path, opts = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${url}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: opts.prefer || '',
      ...opts.headers,
    },
  });
}

async function getGoogleTokens() {
  const res = await sbFetch('/rest/v1/google_tokens?id=eq.1&select=access_token,refresh_token,expires_at,merchant_id');
  const rows = await res.json();
  if (!rows || rows.length === 0 || !rows[0].access_token) return null;

  const row = rows[0];
  if (new Date(row.expires_at) < new Date(Date.now() + 60000)) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!row.refresh_token || !clientId || !clientSecret) return null;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: row.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) return null;

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    await sbFetch('/rest/v1/google_tokens?id=eq.1', {
      method: 'PATCH',
      body: JSON.stringify({ access_token: tokenData.access_token, expires_at: expiresAt, updated_at: new Date().toISOString() }),
    });
    row.access_token = tokenData.access_token;
  }
  return row;
}

async function sendSMS(message) {
  const SID = process.env.TWILIO_SID;
  const TOKEN = process.env.TWILIO_API;
  const FROM = process.env.TWILIO_FROM_NUMBER;
  const numbers = (process.env.ALERT_PHONE_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);

  for (const TO of numbers) {
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: FROM, To: TO, Body: message }).toString(),
    });
  }
}

exports.handler = async () => {
  try {
    const gTokens = await getGoogleTokens();
    if (!gTokens || !gTokens.merchant_id) {
      console.log('[merchant-alert] Google Merchant not configured, skipping');
      return { statusCode: 200, body: 'skipped' };
    }

    // Fetch current product statuses from Merchant Center
    const apiRes = await fetch(
      `https://shoppingcontent.googleapis.com/content/v2.1/${gTokens.merchant_id}/productstatuses?maxResults=250`,
      { headers: { 'Authorization': `Bearer ${gTokens.access_token}`, 'Content-Type': 'application/json' } }
    );
    const apiData = await apiRes.json();
    if (!apiRes.ok) {
      console.error('[merchant-alert] Merchant API error:', apiData.error?.message);
      return { statusCode: 200, body: 'api error' };
    }

    const resources = apiData.resources || [];
    const current = {};
    for (const p of resources) {
      const destStatuses = p.destinationStatuses || [];
      let status = 'approved';
      for (const ds of destStatuses) {
        if (ds.approvalStatus === 'disapproved') { status = 'disapproved'; break; }
        if (ds.approvalStatus === 'pending') status = 'pending';
      }
      current[p.productId || p.title] = { title: p.title || '', status };
    }

    // Load previous snapshot from Supabase
    const snapRes = await sbFetch('/rest/v1/merchant_status_snapshot?id=eq.1&select=statuses');
    const snapRows = await snapRes.json();
    const previous = (snapRows && snapRows.length > 0 && snapRows[0].statuses) ? snapRows[0].statuses : {};

    // Find products that were approved but are no longer
    const lostApproval = [];
    for (const [id, prev] of Object.entries(previous)) {
      if (prev.status === 'approved' && current[id] && current[id].status !== 'approved') {
        lostApproval.push({ title: current[id].title || prev.title, newStatus: current[id].status });
      }
    }

    // Save current snapshot
    const payload = { id: 1, statuses: current, updated_at: new Date().toISOString() };
    if (snapRows && snapRows.length > 0) {
      await sbFetch('/rest/v1/merchant_status_snapshot?id=eq.1', { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      await sbFetch('/rest/v1/merchant_status_snapshot', { method: 'POST', body: JSON.stringify(payload) });
    }

    // Send SMS if any products lost approved status
    if (lostApproval.length > 0) {
      const lines = lostApproval.map(p => `• ${p.title} → ${p.newStatus}`);
      const msg = `⚠️ Primal Pantry Merchant Alert\n${lostApproval.length} product(s) lost approved status:\n${lines.join('\n')}`;
      await sendSMS(msg);
      console.log(`[merchant-alert] Sent SMS for ${lostApproval.length} product(s)`);
    } else {
      console.log('[merchant-alert] All products stable');
    }

    return { statusCode: 200, body: `checked ${Object.keys(current).length} products` };
  } catch (err) {
    console.error('[merchant-alert] Error:', err.message);
    return { statusCode: 200, body: 'error' };
  }
};
