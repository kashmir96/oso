/**
 * send-recovery-email.js
 *
 * Sends a branded cart recovery email via Resend API.
 * Staff triggers this manually from the dashboard after previewing the email.
 *
 * POST body:
 *   { session_id, email, name, line_items, amount_total, currency, staff_name }
 *
 * Env vars required:
 *   RESEND_API_KEY
 *   RESEND_FROM_EMAIL  (e.g. hello@primalpantry.co.nz)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  try {
    const { session_id, email, name, line_items, amount_total, currency, staff_name } = JSON.parse(event.body);

    if (!email || !session_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'email and session_id required' }) };
    }

    const firstName = (name || '').split(' ')[0] || 'there';
    const currencySymbol = (currency || 'nzd').toUpperCase() === 'NZD' ? '$' : '$';
    const total = amount_total ? currencySymbol + (amount_total / 100).toFixed(2) : '';

    // Build cart items HTML
    const itemsHtml = (line_items || []).map(li =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0ebe5;font-size:14px;color:#2d2a26;">${li.description || 'Product'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0ebe5;font-size:14px;color:#6e6259;text-align:center;">${li.quantity || 1}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0ebe5;font-size:14px;color:#2d2a26;text-align:right;">${currencySymbol}${((li.amount || 0) / 100).toFixed(2)}</td>
      </tr>`
    ).join('');

    const html = `
<!DOCTYPE html>
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
        <a href="https://www.primalpantry.co.nz/cart/" style="display:inline-block;background:#8CB47A;color:#141210;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Complete Your Order</a>
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

    // Send via Resend
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

    const resendData = await resendRes.json();
    if (!resendRes.ok) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Resend error', detail: resendData }) };
    }

    // Update status in Supabase
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    await sb.from('abandoned_checkout_status').upsert({
      stripe_session_id: session_id,
      status: 'contacted',
      contacted_at: new Date().toISOString(),
      contacted_by: staff_name || 'Unknown',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'stripe_session_id' });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, resend_id: resendData.id }),
    };
  } catch (err) {
    console.error('Recovery email error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
