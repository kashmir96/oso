/**
 * abandoned-cart-auto.js
 *
 * Scheduled function — runs daily at 6pm NZT.
 * Auto-sends recovery emails to all abandoned checkouts that:
 *   1. Have status 'new' (not already contacted)
 *   2. Haven't later purchased
 *   3. Were created today (same day — don't spam old ones)
 *
 * Uses the same branded email template as send-recovery-email.js
 * Sends via Resend API.
 *
 * Env vars required:
 *   STRIPE_SECRET_KEY
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   RESEND_API_KEY, RESEND_FROM_EMAIL
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

function buildRecoveryEmail(firstName, lineItems, amountTotal, currency, sessionId) {
  const currencySymbol = '$';
  const total = amountTotal ? currencySymbol + (amountTotal / 100).toFixed(2) : '';

  const itemsHtml = (lineItems || []).map(li =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0ebe5;font-size:14px;color:#2d2a26;">${li.description || 'Product'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0ebe5;font-size:14px;color:#6e6259;text-align:center;">${li.quantity || 1}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0ebe5;font-size:14px;color:#2d2a26;text-align:right;">${currencySymbol}${((li.amount || 0) / 100).toFixed(2)}</td>
    </tr>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8f5f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="font-size:22px;color:#2d2a26;margin:0;">Primal Pantry</h1>
    </div>
    <div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e8e2da;">
      <h2 style="font-size:18px;color:#2d2a26;margin:0 0 16px;">Hey ${firstName},</h2>
      <p style="font-size:14px;color:#6e6259;line-height:1.6;margin:0 0 20px;">
        We noticed you left some items in your cart. No worries — they're still waiting for you!
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <thead>
          <tr style="background:#f8f5f0;">
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#9c9287;text-transform:uppercase;">Item</th>
            <th style="padding:8px 12px;text-align:center;font-size:12px;color:#9c9287;text-transform:uppercase;">Qty</th>
            <th style="padding:8px 12px;text-align:right;font-size:12px;color:#9c9287;text-transform:uppercase;">Price</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
        ${total ? `<tfoot><tr><td colspan="2" style="padding:10px 12px;font-size:14px;font-weight:600;color:#2d2a26;">Total</td><td style="padding:10px 12px;font-size:14px;font-weight:600;color:#2d2a26;text-align:right;">${total}</td></tr></tfoot>` : ''}
      </table>
      <div style="text-align:center;margin:24px 0;">
        <a href="https://www.primalpantry.co.nz/cart/?utm_source=email&utm_medium=recovery&utm_campaign=abandoned_cart_auto&utm_content=${sessionId}" style="display:inline-block;background:#8CB47A;color:#141210;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Complete Your Order</a>
      </div>
      <p style="font-size:13px;color:#9c9287;line-height:1.5;margin:16px 0 0;text-align:center;">
        Need help? Just reply to this email — we're happy to assist.
      </p>
    </div>
    <p style="text-align:center;font-size:12px;color:#9c9287;margin-top:20px;">
      Primal Pantry — Natural skincare, made in New Zealand
    </p>
  </div>
</body>
</html>`;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  try {
    console.log('Abandoned cart auto-send starting...');

    // Look at checkouts from the last 24 hours only
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;

    // Fetch expired checkout sessions from Stripe (last 24h)
    const sessions = [];
    let hasMore = true;
    let startingAfter = undefined;

    while (hasMore) {
      const listParams = {
        status: 'expired',
        limit: 100,
        created: { gte: oneDayAgo },
        expand: ['data.line_items'],
      };
      if (startingAfter) listParams.starting_after = startingAfter;
      const batch = await stripe.checkout.sessions.list(listParams);
      sessions.push(...batch.data);
      hasMore = batch.has_more;
      if (batch.data.length) startingAfter = batch.data[batch.data.length - 1].id;
    }

    if (!sessions.length) {
      console.log('No expired checkout sessions in last 24h');
      return { statusCode: 200, headers, body: JSON.stringify({ sent: 0, message: 'No abandoned carts' }) };
    }

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Get existing recovery statuses
    const sessionIds = sessions.map(s => s.id);
    const { data: statusData } = await sb.from('abandoned_checkout_status').select('stripe_session_id,status').in('stripe_session_id', sessionIds);
    const contacted = new Set((statusData || []).filter(r => r.status === 'contacted' || r.status === 'recovered').map(r => r.stripe_session_id));

    // Get emails of customers who completed a purchase (to exclude)
    const { data: ordersData } = await sb.from('orders').select('email').gte('order_date',
      new Date(oneDayAgo * 1000).toISOString().split('T')[0]
    );
    const purchasedEmails = new Set((ordersData || []).map(o => (o.email || '').toLowerCase()).filter(Boolean));

    // Filter to sendable: has email, not contacted, not purchased
    const toSend = sessions.filter(s => {
      if (!s.customer_details?.email) return false;
      if (contacted.has(s.id)) return false;
      if (purchasedEmails.has(s.customer_details.email.toLowerCase())) return false;
      return true;
    });

    // Dedupe by email (only send to each email once, use the most recent session)
    const byEmail = {};
    toSend.forEach(s => {
      const email = s.customer_details.email.toLowerCase();
      if (!byEmail[email] || s.created > byEmail[email].created) {
        byEmail[email] = s;
      }
    });
    const deduped = Object.values(byEmail);

    console.log(`Found ${sessions.length} expired sessions, ${toSend.length} eligible, ${deduped.length} unique emails to send`);

    let sent = 0;
    let errors = 0;

    for (const s of deduped) {
      const email = s.customer_details.email;
      const firstName = (s.customer_details.name || '').split(' ')[0] || 'there';
      const lineItems = (s.line_items?.data || []).map(li => ({
        description: li.description,
        quantity: li.quantity,
        amount: li.amount_total,
      }));

      const html = buildRecoveryEmail(firstName, lineItems, s.amount_total, s.currency, s.id);

      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL || 'Primal Pantry <hello@primalpantry.co.nz>',
            to: [email],
            subject: `${firstName}, you left something behind!`,
            html,
          }),
        });

        if (resendRes.ok) {
          // Mark as contacted
          await sb.from('abandoned_checkout_status').upsert({
            stripe_session_id: s.id,
            status: 'contacted',
            contacted_at: new Date().toISOString(),
            contacted_by: 'Auto (6pm)',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'stripe_session_id' });
          sent++;
          console.log(`  Sent to ${email}`);
        } else {
          const err = await resendRes.json();
          console.error(`  Failed ${email}:`, err);
          errors++;
        }
      } catch (e) {
        console.error(`  Error sending to ${email}:`, e.message);
        errors++;
      }

      // Small delay between sends to avoid rate limits
      if (deduped.indexOf(s) < deduped.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log(`Abandoned cart auto-send complete: ${sent} sent, ${errors} errors`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ sent, errors, total_eligible: deduped.length }),
    };
  } catch (err) {
    console.error('Abandoned cart auto-send error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
