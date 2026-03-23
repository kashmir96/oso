/**
 * stripe-refunds-list.js
 *
 * Lists Stripe refunds for a date range.
 * Returns refund amount, date, and status for dashboard stats + timeseries.
 *
 * GET ?token=...&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Env vars: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function reply(code, data) {
  return { statusCode: code, headers: HEADERS, body: JSON.stringify(data) };
}

async function validateToken(token) {
  if (!token) return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  const res = await fetch(`${url}/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id,role`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, '');

  const qs = event.queryStringParameters || {};
  const staff = await validateToken(qs.token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_KEY) return reply(500, { error: 'Stripe key not configured' });

  const from = qs.from; // YYYY-MM-DD
  const to = qs.to;     // YYYY-MM-DD

  try {
    // Convert dates to unix timestamps for Stripe API
    const createdGte = from ? Math.floor(new Date(from + 'T00:00:00+13:00').getTime() / 1000) : undefined;
    const createdLte = to ? Math.floor(new Date(to + 'T23:59:59+13:00').getTime() / 1000) : undefined;

    const refunds = [];
    let hasMore = true;
    let startingAfter = null;

    while (hasMore) {
      let url = `https://api.stripe.com/v1/refunds?limit=100`;
      if (createdGte) url += `&created[gte]=${createdGte}`;
      if (createdLte) url += `&created[lte]=${createdLte}`;
      if (startingAfter) url += `&starting_after=${startingAfter}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${STRIPE_KEY}` },
      });
      const data = await res.json();

      if (!res.ok) {
        return reply(res.status, { error: data.error?.message || 'Stripe API error' });
      }

      for (const r of (data.data || [])) {
        // Convert amount from cents to dollars, use NZ timezone for date
        const created = new Date(r.created * 1000);
        const nzDate = created.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
        const nzHour = Number(created.toLocaleString('en-US', { timeZone: 'Pacific/Auckland', hour: 'numeric', hour12: false }));

        refunds.push({
          id: r.id,
          amount: r.amount / 100, // cents to dollars
          currency: r.currency,
          status: r.status,
          date: nzDate,
          hour: nzHour,
          created: r.created,
        });
      }

      hasMore = data.has_more;
      if (hasMore && data.data.length > 0) {
        startingAfter = data.data[data.data.length - 1].id;
      } else {
        hasMore = false;
      }
    }

    // Summary
    const totalRefunded = refunds.reduce((s, r) => s + r.amount, 0);
    const refundCount = refunds.length;

    return reply(200, {
      refunds,
      total: totalRefunded,
      count: refundCount,
    });
  } catch (err) {
    console.error('[stripe-refunds-list] Error:', err);
    return reply(500, { error: err.message });
  }
};
