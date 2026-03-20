/**
 * deploy-alert.js
 *
 * Netlify scheduled function – runs every 15 minutes.
 * Checks deploy status for all 3 sites (oso, primalpantry, reviana).
 * If any site has been in error state for over 1 hour, sends an SMS.
 * Uses Supabase to track when failures were first seen and whether
 * an alert has already been sent, so you only get one text per failure.
 *
 * Env vars required:
 *   NETLIFY_API_TOKEN
 *   NETLIFY_SITE_ID_OSO, NETLIFY_SITE_ID_PRIMALPANTRY, NETLIFY_SITE_ID_REVIANA
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   TWILIO_SID, TWILIO_API, TWILIO_FROM_NUMBER, ALERT_PHONE_NUMBERS
 */

async function sbFetch(url, opts = {}) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${SUPABASE_URL}${url}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      ...opts.headers,
    },
  });
}

async function sendSMS(message) {
  const SID = process.env.TWILIO_SID;
  const TOKEN = process.env.TWILIO_API;
  const FROM = process.env.TWILIO_FROM_NUMBER;
  const numbers = (process.env.ALERT_PHONE_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);

  for (const TO of numbers) {
    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: FROM, To: TO, Body: message }).toString(),
      }
    );
  }
}

async function getLatestDeploy(siteId) {
  const NETLIFY_TOKEN = process.env.NETLIFY_API_TOKEN;
  const res = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=1`, {
    headers: { 'Authorization': `Bearer ${NETLIFY_TOKEN}` },
  });
  if (!res.ok) return null;
  const deploys = await res.json();
  return deploys && deploys.length > 0 ? deploys[0] : null;
}

exports.handler = async () => {
  const NETLIFY_TOKEN = process.env.NETLIFY_API_TOKEN;
  if (!NETLIFY_TOKEN) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'No NETLIFY_API_TOKEN' }) };
  }

  const sites = {
    OSO: process.env.NETLIFY_SITE_ID_OSO,
    'Primal Pantry': process.env.NETLIFY_SITE_ID_PRIMALPANTRY,
    Reviana: process.env.NETLIFY_SITE_ID_REVIANA,
  };

  const results = [];

  for (const [name, siteId] of Object.entries(sites)) {
    if (!siteId) continue;

    const deploy = await getLatestDeploy(siteId);
    if (!deploy) continue;

    const key = name.toLowerCase().replace(/\s+/g, '_');

    if (deploy.state === 'error') {
      // Check if we already have a tracked failure for this deploy
      const trackRes = await sbFetch(
        `/rest/v1/deploy_failures?site_key=eq.${encodeURIComponent(key)}&deploy_id=eq.${encodeURIComponent(deploy.id)}&select=*`
      );
      const rows = await trackRes.json();

      if (!rows || rows.length === 0) {
        // First time seeing this failure — record it
        await sbFetch('/rest/v1/deploy_failures', {
          method: 'POST',
          body: JSON.stringify({
            site_key: key,
            site_name: name,
            deploy_id: deploy.id,
            error_message: deploy.error_message || '',
            failed_at: deploy.created_at,
            alerted: false,
          }),
        });
        results.push({ site: name, action: 'tracked', deploy_id: deploy.id });
      } else if (!rows[0].alerted) {
        // Already tracked — check if it's been over 1 hour
        const failedAt = new Date(rows[0].failed_at);
        const hourAgo = Date.now() - 60 * 60 * 1000;

        if (failedAt.getTime() < hourAgo) {
          // Over 1 hour — send alert
          const msg = `Deploy Alert: ${name} has been failing for over 1 hour.\n\n${deploy.error_message || 'No error message.'}\n\nDeploy ID: ${deploy.id}`;
          await sendSMS(msg);

          // Mark as alerted
          await sbFetch(`/rest/v1/deploy_failures?id=eq.${rows[0].id}`, {
            method: 'PATCH',
            body: JSON.stringify({ alerted: true }),
          });
          results.push({ site: name, action: 'alerted', deploy_id: deploy.id });
        } else {
          results.push({ site: name, action: 'waiting', minutes: Math.round((Date.now() - failedAt.getTime()) / 60000) });
        }
      } else {
        results.push({ site: name, action: 'already_alerted' });
      }
    } else {
      // Deploy is not in error — clean up any tracked failures for this site
      await sbFetch(`/rest/v1/deploy_failures?site_key=eq.${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
      results.push({ site: name, action: 'ok', state: deploy.state });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ results }),
  };
};
