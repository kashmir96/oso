/**
 * sales-alert.js
 *
 * Netlify scheduled function – runs every hour.
 * If two consecutive hours between 6am–11pm NZT have 0 sales, sends an SMS via Twilio.
 * Silent between 11pm–5am.
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   TWILIO_SID
 *   TWILIO_API
 *   TWILIO_FROM_NUMBER   (e.g. +1234567890)
 *   ALERT_PHONE_NUMBERS  (comma-separated, e.g. +64272415215,+64212784022)
 */

// In-memory tracking of last alerted pair to avoid duplicate alerts within the same deploy instance.
// Netlify scheduled functions are stateless across invocations, so each run rechecks from scratch –
// but that's fine since we only alert on consecutive zero-hours that have fully elapsed.
let lastAlertedPair = null;

function getNZTime() {
  const nzStr = new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' });
  return new Date(nzStr);
}

function getNZDate() {
  const nz = getNZTime();
  const y = nz.getFullYear();
  const m = String(nz.getMonth() + 1).padStart(2, '0');
  const d = String(nz.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

async function getOrdersByHour(date) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  // Fetch all non-refunded orders for today, just the order_hour field
  const url = `${SUPABASE_URL}/rest/v1/orders?select=order_hour&order_date=eq.${date}&status=neq.Refunded`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) throw new Error(`Supabase error ${res.status}`);
  return res.json();
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const nzNow = getNZTime();
    const currentHour = nzNow.getHours();

    // Silent between 11pm (23) and 5am (5)
    if (currentHour >= 23 || currentHour < 5) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: true, reason: 'Outside alert hours (11pm-5am)' }) };
    }

    // Need at least 2 completed business hours to check (earliest check at 8am for 6am+7am)
    if (currentHour < 8) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: true, reason: 'Too early – need 2 completed hours since 6am' }) };
    }

    const today = getNZDate();
    const orders = await getOrdersByHour(today);

    // Count orders per hour
    const hourlyCounts = {};
    for (let h = 6; h <= 22; h++) hourlyCounts[h] = 0;
    orders.forEach(o => {
      if (o.order_hour >= 6 && o.order_hour <= 22) {
        hourlyCounts[o.order_hour]++;
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
      return { statusCode: 200, headers, body: JSON.stringify({ alert: false, message: 'No consecutive zero-sale hours', today, hourlyCounts }) };
    }

    // Alert on the most recent consecutive pair
    const [hourA, hourB] = consecutiveZeros[consecutiveZeros.length - 1];
    const pairKey = `${today}-${hourA}-${hourB}`;

    // Avoid duplicate alert for same pair (only works within same deploy instance)
    if (lastAlertedPair === pairKey) {
      return { statusCode: 200, headers, body: JSON.stringify({ alert: false, message: 'Already alerted for this pair', pair: [hourA, hourB] }) };
    }

    const formatHour = (h) => {
      if (h === 0) return '12am';
      if (h < 12) return h + 'am';
      if (h === 12) return '12pm';
      return (h - 12) + 'pm';
    };

    const msg = `Primal Pantry Sales Alert: No orders between ${formatHour(hourA)}-${formatHour(hourB + 1)} today (${today}). Check the dashboard.`;

    await sendSMS(msg);
    lastAlertedPair = pairKey;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ alert: true, message: msg, pair: [hourA, hourB], today }),
    };
  } catch (err) {
    console.error('[sales-alert] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
