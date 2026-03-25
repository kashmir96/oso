/**
 * test-followup.js
 *
 * Scheduled function – runs every hour.
 * For tests where review_date has passed:
 *   1. Fetches post-change analytics metrics
 *   2. Compares against baseline
 *   3. Updates test status to completed
 *   4. Sends SMS with before/after comparison
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

async function sendSMS(message, phone) {
  const SID = process.env.TWILIO_SID;
  const TOKEN = process.env.TWILIO_API;
  const FROM = process.env.TWILIO_FROM_NUMBER;

  // Use test-specific phone or fall back to global alert numbers
  const numbers = phone
    ? [phone]
    : (process.env.ALERT_PHONE_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);

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

async function getAnalyticsMetrics(from, to) {
  try {
    const res = await sbFetch('/rest/v1/rpc/analytics_funnel_stages', {
      method: 'POST',
      body: JSON.stringify({
        p_site: 'PrimalPantry.co.nz',
        p_from: from,
        p_to: to,
      }),
    });
    const data = await res.json();
    if (!data || res.status !== 200) return null;
    return {
      visitors: data.visitors || 0,
      atc: data.atc || 0,
      conversions: data.purchased || data.checkout || 0,
      bounce_rate: data.bounce_rate || 0,
    };
  } catch (e) {
    console.error('[test-followup] Analytics error:', e.message);
    return null;
  }
}

function getMetricFromAnalytics(metric, analytics, orderData) {
  if (!analytics && !orderData) return 0;
  switch (metric) {
    case 'visitors': return analytics ? analytics.visitors : 0;
    case 'conversions': return analytics ? analytics.conversions : 0;
    case 'atc_rate': return analytics && analytics.visitors > 0 ? (analytics.atc / analytics.visitors * 100) : 0;
    case 'bounce_rate': return analytics ? analytics.bounce_rate : 0;
    case 'revenue': return orderData ? orderData.revenue : 0;
    case 'orders': return orderData ? orderData.orders : 0;
    case 'aov': return orderData && orderData.orders > 0 ? orderData.revenue / orderData.orders : 0;
    case 'page_views': return analytics ? (analytics.pageviews || 0) : 0;
    default: return 0;
  }
}

async function getOrderMetrics(from, to) {
  try {
    const res = await sbFetch(
      `/rest/v1/orders?order_date=gte.${from}&order_date=lte.${to}&select=total_value`
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) return { revenue: 0, orders: 0 };
    const revenue = rows.reduce((s, o) => s + Number(o.total_value || 0), 0);
    return { revenue, orders: rows.length };
  } catch (e) {
    console.error('[test-followup] Order metrics error:', e.message);
    return { revenue: 0, orders: 0 };
  }
}

function fmtPct(before, after) {
  if (before === 0) return after > 0 ? '+∞%' : '0%';
  const pct = ((after - before) / before * 100).toFixed(1);
  return (pct > 0 ? '+' : '') + pct + '%';
}

function fmtVal(metric, val) {
  switch (metric) {
    case 'revenue': case 'aov': case 'cpa': return '$' + Number(val || 0).toFixed(2);
    case 'atc_rate': case 'bounce_rate': return Number(val || 0).toFixed(1) + '%';
    case 'roas': return Number(val || 0).toFixed(2) + 'x';
    default: return String(Math.round(val || 0));
  }
}

const METRIC_LABELS = {
  visitors: 'Visitors', conversions: 'Conversions', atc_rate: 'ATC Rate',
  bounce_rate: 'Bounce Rate', revenue: 'Revenue', orders: 'Orders',
  aov: 'AOV', cpa: 'CPA', roas: 'ROAS', page_views: 'Page Views',
};

exports.handler = async () => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Find tests where review date has passed, still running, SMS not sent
    const res = await sbFetch(
      `/rest/v1/tests?status=eq.active&end_date=lte.${today}&sms_sent=neq.true&select=*&order=created_at.asc&limit=10`
    );
    const tests = await res.json();
    if (!Array.isArray(tests) || tests.length === 0) {
      console.log('[test-followup] No pending test followups');
      return { statusCode: 200, body: 'none' };
    }

    for (const test of tests) {
      // Fetch post-change metrics (from change date to review date)
      const analytics = await getAnalyticsMetrics(test.start_date, test.end_date);
      const orderData = await getOrderMetrics(test.start_date, test.end_date);
      const postValue = getMetricFromAnalytics(test.metric, analytics, orderData);
      const baseValue = Number(test.baseline_value || 0);
      const change = baseValue > 0 ? ((postValue - baseValue) / baseValue * 100) : 0;

      // Update the test
      await sbFetch(`/rest/v1/tests?id=eq.${test.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          current_value: postValue,
          status: 'completed',
          sms_sent: true,
          updated_at: new Date().toISOString(),
        }),
      });

      // Send SMS if enabled
      if (test.notify_sms) {
        const label = METRIC_LABELS[test.metric] || test.metric;
        const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '→';
        const msg = [
          `📊 Test Result: ${test.name}`,
          `${test.description || ''}`,
          ``,
          `${label}: ${fmtVal(test.metric, baseValue)} → ${fmtVal(test.metric, postValue)}`,
          `Change: ${arrow} ${fmtPct(baseValue, postValue)}`,
          ``,
          `Period: ${test.start_date} → ${test.end_date}`,
          test.pages && test.pages.length ? `Pages: ${test.pages.join(', ')}` : '',
        ].filter(Boolean).join('\n');

        await sendSMS(msg, test.notify_phone);
        console.log(`[test-followup] Sent SMS for test "${test.name}"`);
      }
    }

    return { statusCode: 200, body: `processed ${tests.length}` };
  } catch (err) {
    console.error('[test-followup] Error:', err.message);
    return { statusCode: 200, body: 'error' };
  }
};
