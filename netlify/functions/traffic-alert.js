/**
 * traffic-alert.js
 *
 * Netlify scheduled function – runs every hour.
 * If two consecutive hours between 6am–11pm NZT have 0 pageviews
 * for the PrimalPantry.co.nz site, sends an SMS via Twilio.
 * Silent between 11pm–6am.
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   TWILIO_SID
 *   TWILIO_API
 *   TWILIO_FROM_NUMBER   (e.g. +1234567890)
 *   ALERT_PHONE_NUMBERS  (comma-separated, e.g. +64272415215,+64212784022)
 */

const SITE_ID = 'PrimalPantry.co.nz';

function getNZTime() {
  const nzStr = new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' });
  return new Date(nzStr);
}

function getNZOffset() {
  const now = new Date();
  const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
  const nzStr = now.toLocaleString('en-US', { timeZone: 'Pacific/Auckland' });
  const diffMs = new Date(nzStr) - new Date(utcStr);
  const h = Math.round(diffMs / 3600000);
  return `${h >= 0 ? '+' : '-'}${String(Math.abs(h)).padStart(2, '0')}:00`;
}

function getNZDateRange(nzNow) {
  const y = nzNow.getFullYear();
  const m = String(nzNow.getMonth() + 1).padStart(2, '0');
  const d = String(nzNow.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;
  const offset = getNZOffset();
  const startNZ = new Date(`${dateStr}T00:00:00${offset}`);
  return { dateStr, startNZ };
}

async function sendSMS(message) {
  const SID = process.env.TWILIO_SID;
  const TOKEN = process.env.TWILIO_API;
  const FROM = process.env.TWILIO_FROM_NUMBER;
  const numbers = (process.env.ALERT_PHONE_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);

  const results = [];
  for (const TO of numbers) {
    const res = await fetch(
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
    const data = await res.json();
    if (!res.ok) results.push({ to: TO, error: data.message || `Twilio error ${res.status}` });
    else results.push({ to: TO, success: true });
  }
  return results;
}

async function getRecentPageviewCount() {
  // Query analytics_pageviews directly via REST (no RPC dependency)
  // Check if there are ANY pageviews in the last 2 hours
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const url = `${process.env.SUPABASE_URL}/rest/v1/analytics_pageviews?site_id=eq.${encodeURIComponent(SITE_ID)}&created_at=gte.${twoHoursAgo}&select=id&limit=1`;
  const res = await fetch(url, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase query error ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows.length;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const nzNow = getNZTime();
    const currentHour = nzNow.getHours();

    // Silent between 11pm (23) and 6am (6) NZ time
    if (currentHour >= 23 || currentHour < 6) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: true, reason: 'Outside alert hours (11pm-6am NZT)' }) };
    }

    // Need at least 2 hours since 6am
    if (currentHour < 8) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: true, reason: 'Too early – need 2 completed hours since 6am' }) };
    }

    // Simple check: any pageviews in last 2 hours?
    const recentCount = await getRecentPageviewCount();

    if (recentCount > 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ alert: false, message: 'Traffic detected in last 2 hours', recentCount }) };
    }

    // Zero pageviews in last 2 hours — check dedup before alerting
    const { dateStr } = getNZDateRange(nzNow);
    const alertKey = `traffic-alert-${dateStr}`;
    const dedupRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/analytics_salt?id=eq.2&select=date_str`, {
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    });
    const dedupRows = await dedupRes.json();
    if (dedupRows && dedupRows.length > 0 && dedupRows[0].date_str === alertKey) {
      return { statusCode: 200, headers, body: JSON.stringify({ alert: false, message: 'Already alerted today' }) };
    }

    const formatHour = (h) => {
      if (h === 0) return '12am';
      if (h < 12) return h + 'am';
      if (h === 12) return '12pm';
      return (h - 12) + 'pm';
    };

    const msg = `Primal Pantry Traffic Alert: Zero pageviews recorded in the last 2 hours (as of ${formatHour(currentHour)} NZT, ${dateStr}). Tracking may be broken — check primalpantry.co.nz`;

    const smsResults = await sendSMS(msg);
    console.log('[traffic-alert] SMS sent:', JSON.stringify(smsResults));

    // Store dedup key
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/analytics_salt`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ id: 2, salt: 'alert-dedup', date_str: alertKey }),
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ alert: true, message: msg, smsResults, today: dateStr }),
    };
  } catch (err) {
    console.error('[traffic-alert] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
