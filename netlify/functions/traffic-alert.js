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

let lastAlertedPair = null;

function getNZTime() {
  const nzStr = new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' });
  return new Date(nzStr);
}

function getNZDateRange(nzNow) {
  const y = nzNow.getFullYear();
  const m = String(nzNow.getMonth() + 1).padStart(2, '0');
  const d = String(nzNow.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;
  // Start/end of day in NZ as UTC timestamps for querying
  const startNZ = new Date(`${dateStr}T00:00:00+13:00`); // NZDT
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

async function getPageviewsByHour(nzNow) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const { dateStr, startNZ } = getNZDateRange(nzNow);

  // Get hourly pageview counts for today (NZ time) using the timeseries RPC
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/analytics_timeseries`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_site: SITE_ID,
      p_from: startNZ.toISOString(),
      p_to: new Date().toISOString(),
      p_interval: 'hour',
    }),
  });

  if (!res.ok) throw new Error(`Supabase RPC error ${res.status}`);
  const data = await res.json();
  return { dateStr, timeseries: data };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const nzNow = getNZTime();
    const currentHour = nzNow.getHours();

    // Silent between 11pm (23) and 6am (6)
    if (currentHour >= 23 || currentHour < 6) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: true, reason: 'Outside alert hours (11pm-6am)' }) };
    }

    // Need at least 2 completed hours to check (earliest check at 8am for 6am+7am)
    if (currentHour < 8) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: true, reason: 'Too early – need 2 completed hours since 6am' }) };
    }

    const { dateStr, timeseries } = await getPageviewsByHour(nzNow);

    // Build hourly counts from timeseries data
    // timeseries returns [{period: "2026-03-22T...", visitors: N, pageviews: N}, ...]
    const hourlyCounts = {};
    for (let h = 6; h <= 22; h++) hourlyCounts[h] = 0;

    timeseries.forEach(row => {
      const rowDate = new Date(row.period);
      // Convert to NZ hour
      const nzHourStr = rowDate.toLocaleString('en-US', { timeZone: 'Pacific/Auckland', hour: 'numeric', hour12: false });
      const h = parseInt(nzHourStr, 10);
      if (h >= 6 && h <= 22) {
        hourlyCounts[h] = (hourlyCounts[h] || 0) + row.pageviews;
      }
    });

    // Check completed hours only (up to currentHour - 1)
    const maxHour = Math.min(currentHour - 1, 22);
    const consecutiveZeros = [];

    for (let h = 7; h <= maxHour; h++) {
      if (hourlyCounts[h] === 0 && hourlyCounts[h - 1] === 0) {
        consecutiveZeros.push([h - 1, h]);
      }
    }

    if (consecutiveZeros.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ alert: false, message: 'No consecutive zero-traffic hours', today: dateStr, hourlyCounts }) };
    }

    // Alert on the most recent consecutive pair
    const [hourA, hourB] = consecutiveZeros[consecutiveZeros.length - 1];
    const pairKey = `${dateStr}-${hourA}-${hourB}`;

    if (lastAlertedPair === pairKey) {
      return { statusCode: 200, headers, body: JSON.stringify({ alert: false, message: 'Already alerted for this pair', pair: [hourA, hourB] }) };
    }

    const formatHour = (h) => {
      if (h === 0) return '12am';
      if (h < 12) return h + 'am';
      if (h === 12) return '12pm';
      return (h - 12) + 'pm';
    };

    const msg = `Primal Pantry Traffic Alert: Zero website traffic between ${formatHour(hourA)}-${formatHour(hourB + 1)} today (${dateStr}). Site may be down — check primalpantry.co.nz`;

    await sendSMS(msg);
    lastAlertedPair = pairKey;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ alert: true, message: msg, pair: [hourA, hourB], today: dateStr }),
    };
  } catch (err) {
    console.error('[traffic-alert] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
