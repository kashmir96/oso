/**
 * send-review-prompt.js
 *
 * Sends a branded review request email via Resend API.
 * Staff triggers this from the dashboard after an order is delivered.
 *
 * POST body:
 *   { email, customer_name, order_id, token }
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
    const { email, customer_name, order_id, token } = JSON.parse(event.body);

    if (!email || !order_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'email and order_id required' }) };
    }

    // Verify staff auth
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    if (token) {
      const { data: staff } = await sb.from('staff').select('id,role').eq('session_token', token).single();
      if (!staff) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorised' }) };
    }

    const firstName = (customer_name || '').split(' ')[0] || 'there';
    const reviewUrl = `https://www.primalpantry.co.nz/primalpantry/review.html?order_id=${order_id}&email=${encodeURIComponent(email)}`;

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
      <p style="font-size:14px;color:#6e6259;line-height:1.6;margin:0 0 12px;">
        We hope you're enjoying your Primal Pantry products! We'd love to hear how we did — it takes about 30 seconds.
      </p>
      <p style="font-size:14px;color:#6e6259;line-height:1.6;margin:0 0 24px;">
        Your honest feedback helps our small team keep improving.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${reviewUrl}" style="display:inline-block;background:#8CB47A;color:#141210;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Share Your Experience</a>
      </div>
      <p style="font-size:13px;color:#9c9287;line-height:1.5;margin:16px 0 0;text-align:center;">
        Just one quick question — we truly appreciate it!
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
        subject: `${firstName}, how did we do?`,
        html,
      }),
    });

    const resendData = await resendRes.json();
    if (!resendRes.ok) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Resend error', detail: resendData }) };
    }

    // Update order with review_prompted_at
    await sb.from('orders').update({
      review_prompted_at: new Date().toISOString(),
    }).eq('id', order_id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, resend_id: resendData.id }),
    };
  } catch (err) {
    console.error('Review prompt error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
