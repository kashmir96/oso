/**
 * changelog-followup.js
 *
 * Scheduled function – runs every hour.
 * For funnel-related deploys that are 7+ days old:
 *   1. Fetches post-change funnel metrics (7 days after deploy)
 *   2. Updates cooldown status (complete if 50+ conversions or 7+ days)
 *   3. Sends SMS with before/after comparison
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   TWILIO_SID, TWILIO_API, TWILIO_FROM_NUMBER, ALERT_PHONE_NUMBERS
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

async function getPostMetrics(deployedAt) {
  // Get 7-day funnel metrics starting from deploy time
  const from = new Date(deployedAt);
  const to = new Date(from);
  to.setDate(to.getDate() + 7);

  try {
    const res = await sbFetch('/rest/v1/rpc/analytics_funnel_stages', {
      method: 'POST',
      body: JSON.stringify({
        p_site: 'PrimalPantry.co.nz',
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      }),
    });
    const data = await res.json();
    if (!data || res.status !== 200) return null;
    return {
      visitors: data.visitors || 0,
      atc: data.atc || 0,
      conv: data.purchased || data.checkout || 0,
      rev: 0,
    };
  } catch (e) {
    console.error('[changelog-followup] Post metrics error:', e.message);
    return null;
  }
}

function fmtPct(before, after) {
  if (before === 0) return after > 0 ? '+∞%' : '0%';
  const pct = ((after - before) / before * 100).toFixed(1);
  return (pct > 0 ? '+' : '') + pct + '%';
}

function fmtRate(num, denom) {
  if (!denom || denom === 0) return '0%';
  return (num / denom * 100).toFixed(1) + '%';
}

exports.handler = async () => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Find funnel-related changelogs that are 7+ days old and haven't had followup
    const res = await sbFetch(
      `/rest/v1/site_changelogs?is_funnel_related=eq.true&sms_followup_sent=eq.false&deployed_at=lt.${sevenDaysAgo}&select=*&order=deployed_at.asc&limit=5`
    );
    const rows = await res.json();
    if (!rows || rows.length === 0) {
      console.log('[changelog-followup] No pending followups');
      return { statusCode: 200, body: 'none' };
    }

    for (const row of rows) {
      const post = await getPostMetrics(row.deployed_at);
      if (!post) continue;

      const bVis = row.baseline_visitors || 0;
      const bAtc = row.baseline_atc || 0;
      const bConv = row.baseline_conv || 0;
      const pVis = post.visitors;
      const pAtc = post.atc;
      const pConv = post.conv;

      // Normalize baselines to 7-day equivalent (baseline is 30 days)
      const bVis7 = Math.round(bVis / 30 * 7);
      const bAtc7 = Math.round(bAtc / 30 * 7);
      const bConv7 = Math.round(bConv / 30 * 7);

      const cooldownComplete = pConv >= 50 || true; // 7+ days means cooldown is complete

      // Update the row
      await sbFetch(`/rest/v1/site_changelogs?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          post_visitors: pVis,
          post_atc: pAtc,
          post_conv: pConv,
          post_rev: post.rev,
          cooldown_complete: cooldownComplete,
          cooldown_conversions: pConv,
          sms_followup_sent: true,
        }),
      });

      // Send SMS
      const deployDate = new Date(row.deployed_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
      const msg = [
        `📊 Funnel Change Report (7-day follow-up)`,
        `Change: ${row.commit_message || 'Deploy ' + row.deploy_id}`,
        `Deployed: ${deployDate}`,
        ``,
        `Before (7d avg) → After (7d):`,
        `Visitors: ${bVis7} → ${pVis} (${fmtPct(bVis7, pVis)})`,
        `ATC: ${bAtc7} → ${pAtc} (${fmtPct(bAtc7, pAtc)})`,
        `ATC%: ${fmtRate(bAtc7, bVis7)} → ${fmtRate(pAtc, pVis)}`,
        `Conv: ${bConv7} → ${pConv} (${fmtPct(bConv7, pConv)})`,
        `Conv%: ${fmtRate(bConv7, bVis7)} → ${fmtRate(pConv, pVis)}`,
      ].join('\n');

      await sendSMS(msg);
      console.log(`[changelog-followup] Sent followup for deploy ${row.deploy_id}`);
    }

    return { statusCode: 200, body: `processed ${rows.length}` };
  } catch (err) {
    console.error('[changelog-followup] Error:', err.message);
    return { statusCode: 200, body: 'error' };
  }
};
