/**
 * stripe-refund.js
 *
 * Refunds a Stripe checkout session's payment intent.
 * Uses Stripe REST API directly (no SDK needed).
 *
 * Expects POST with { stripe_session_id: "cs_live_..." }
 *
 * Env vars required:
 *   STRIPE_SECRET_KEY
 */

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Stripe key not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const sessionId = body.stripe_session_id;
  if (!sessionId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'stripe_session_id required' }) };
  }

  // Manual orders don't have Stripe sessions — skip refund
  if (sessionId.startsWith('manual_')) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, skipped: true, message: 'Manual order — no Stripe refund needed' }) };
  }

  const stripeHeaders = {
    'Authorization': `Bearer ${STRIPE_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  try {
    // 1. Retrieve the checkout session to get payment_intent
    const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { 'Authorization': `Bearer ${STRIPE_KEY}` },
    });
    const sessionData = await sessionRes.json();

    if (!sessionRes.ok) {
      return { statusCode: sessionRes.status, headers, body: JSON.stringify({ error: `Stripe session lookup failed: ${sessionData.error?.message || JSON.stringify(sessionData)}` }) };
    }

    const paymentIntentId = sessionData.payment_intent;
    if (!paymentIntentId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No payment intent found for this session (may already be refunded or unpaid)' }) };
    }

    // 2. Create a full refund on the payment intent
    const refundRes = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: stripeHeaders,
      body: `payment_intent=${encodeURIComponent(paymentIntentId)}`,
    });
    const refundData = await refundRes.json();

    if (!refundRes.ok) {
      return { statusCode: refundRes.status, headers, body: JSON.stringify({ error: `Stripe refund failed: ${refundData.error?.message || JSON.stringify(refundData)}` }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, refund_id: refundData.id, amount: refundData.amount, status: refundData.status }),
    };
  } catch (err) {
    console.error('[stripe-refund] Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
