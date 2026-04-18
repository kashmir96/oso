/**
 * abandoned-checkouts.js
 *
 * Returns expired Stripe checkout sessions (abandoned carts) with customer
 * email, cart contents, and recovery status from Supabase.
 *
 * Query params:
 *   days=7  (default 7, how far back to look)
 *
 * Env vars required:
 *   STRIPE_SECRET_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  try {
    const params = event.queryStringParameters || {};
    const days = parseInt(params.days) || 7;
    const createdAfter = Math.floor(Date.now() / 1000) - (days * 86400);

    // Fetch expired checkout sessions from Stripe — cap pages to avoid Netlify timeout
    const sessions = [];
    let hasMore = true;
    let startingAfter = undefined;
    const MAX_PAGES = 5; // 500 sessions max per call (10s Netlify limit)
    let pageCount = 0;

    while (hasMore && pageCount < MAX_PAGES) {
      const listParams = {
        status: 'expired',
        limit: 100,
        created: { gte: createdAfter },
        expand: ['data.line_items'],
      };
      if (startingAfter) listParams.starting_after = startingAfter;

      const batch = await stripe.checkout.sessions.list(listParams);
      sessions.push(...batch.data);
      hasMore = batch.has_more;
      if (batch.data.length) startingAfter = batch.data[batch.data.length - 1].id;
      pageCount++;
    }

    // Get recovery statuses from Supabase
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const sessionIds = sessions.map(s => s.id);
    let statuses = {};
    if (sessionIds.length) {
      const { data } = await sb.from('abandoned_checkout_status').select('*').in('stripe_session_id', sessionIds);
      (data || []).forEach(r => { statuses[r.stripe_session_id] = r; });
    }

    // Get completed order emails to exclude recovered customers
    const { data: ordersData } = await sb.from('orders').select('email').gte('order_date',
      new Date(createdAfter * 1000).toISOString().split('T')[0]
    );
    const completedEmails = new Set((ordersData || []).map(o => (o.email || '').toLowerCase()).filter(Boolean));

    // Build response
    const abandoned = sessions
      .filter(s => s.customer_details?.email) // Only sessions where email was entered
      .map(s => {
        const email = s.customer_details.email.toLowerCase();
        const recoveryStatus = statuses[s.id];
        const laterPurchased = completedEmails.has(email);

        return {
          session_id: s.id,
          email: s.customer_details.email,
          name: s.customer_details.name || null,
          created: s.created,
          amount_total: s.amount_total,
          currency: s.currency,
          line_items: (s.line_items?.data || []).map(li => ({
            description: li.description,
            quantity: li.quantity,
            amount: li.amount_total,
          })),
          status: recoveryStatus?.status || (laterPurchased ? 'recovered' : 'new'),
          contacted_at: recoveryStatus?.contacted_at || null,
          contacted_by: recoveryStatus?.contacted_by || null,
          notes: recoveryStatus?.notes || null,
          later_purchased: laterPurchased,
        };
      })
      .sort((a, b) => b.created - a.created);

    // Summary stats
    const total = abandoned.length;
    const lostRevenue = abandoned.filter(a => a.status === 'new').reduce((s, a) => s + (a.amount_total || 0), 0);
    const recovered = abandoned.filter(a => a.status === 'recovered' || a.later_purchased).length;
    const contacted = abandoned.filter(a => a.status === 'contacted').length;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        abandoned,
        summary: { total, lost_revenue: lostRevenue, recovered, contacted },
      }),
    };
  } catch (err) {
    console.error('Abandoned checkouts error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
