/**
 * stripe-refund.js
 *
 * Refunds a Stripe checkout session's payment intent (full or partial).
 * Uses Stripe REST API directly (no SDK needed).
 *
 * Expects POST with:
 *   { stripe_session_id, token, amount_cents?, reason? }
 *
 * - token: staff session token (required — admin/owner only)
 * - amount_cents: if provided, partial refund in cents; otherwise full refund
 * - reason: refund reason (stored frontend-side in Supabase)
 *
 * Env vars required:
 *   STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function reply(statusCode, data) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(data) };
}

async function getStaffByToken(token) {
  if (!token) return null;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id,role`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_KEY) return reply(500, { error: 'Stripe key not configured' });

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return reply(400, { error: 'Invalid JSON' });
  }

  // Auth — require admin/owner
  const staff = await getStaffByToken(body.token);
  if (!staff) return reply(401, { error: 'Unauthorized' });
  if (staff.role !== 'owner' && staff.role !== 'admin') {
    return reply(403, { error: 'Only admin/owner can process refunds' });
  }

  const sessionId = body.stripe_session_id;
  if (!sessionId) return reply(400, { error: 'stripe_session_id required' });

  const amountCents = body.amount_cents ? Number(body.amount_cents) : null;

  // Manual orders don't have Stripe sessions — skip Stripe but report success
  if (sessionId.startsWith('manual_')) {
    return reply(200, { success: true, skipped: true, message: 'Manual order — no Stripe refund needed', amount: amountCents || 0 });
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
      return reply(sessionRes.status, { error: `Stripe session lookup failed: ${sessionData.error?.message || JSON.stringify(sessionData)}` });
    }

    const paymentIntentId = sessionData.payment_intent;
    if (!paymentIntentId) {
      return reply(400, { error: 'No payment intent found for this session (may already be refunded or unpaid)' });
    }

    // 2. Create refund — partial if amount_cents provided, otherwise full
    let refundBody = `payment_intent=${encodeURIComponent(paymentIntentId)}`;
    if (amountCents && amountCents > 0) {
      refundBody += `&amount=${amountCents}`;
    }

    const refundRes = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: stripeHeaders,
      body: refundBody,
    });
    const refundData = await refundRes.json();

    if (!refundRes.ok) {
      return reply(refundRes.status, { error: `Stripe refund failed: ${refundData.error?.message || JSON.stringify(refundData)}` });
    }

    return reply(200, {
      success: true,
      refund_id: refundData.id,
      amount: refundData.amount,
      status: refundData.status,
    });
  } catch (err) {
    console.error('[stripe-refund] Error:', err);
    return reply(500, { error: err.message });
  }
};
