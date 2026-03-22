/**
 * eship-update.js
 *
 * Change a StarshipIt order's bag size by deleting and recreating
 * the order with the new shipping_method (carrier product code).
 * StarshipIt's rules engine ignores shipping_method on PUT updates,
 * so delete+recreate is the reliable approach.
 *
 * POST /.netlify/functions/eship-update
 * Body: { order_id: 123, shipping_method: "CPOLTPA5", token: "staff_token" }
 *
 * Env vars required:
 *   STARSHIPIT_API_KEY
 *   STARSHIPIT_SUBSCRIPTION_KEY
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY (for token validation)
 */

const { createClient } = require('@supabase/supabase-js');

let _sb;
function getSb() {
  if (!_sb) _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _sb;
}

async function validateToken(token) {
  if (!token) return null;
  const { data } = await getSb().from('staff').select('id,role').eq('session_token', token).single();
  return data;
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

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

  const API_KEY = process.env.STARSHIPIT_API_KEY;
  const SUB_KEY = process.env.STARSHIPIT_SUBSCRIPTION_KEY;

  if (!API_KEY || !SUB_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'StarshipIt keys not configured' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { order_id, shipping_method, token } = body;

    const staff = await validateToken(token);
    if (!staff) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    if (!order_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'order_id required' }) };
    }

    if (!shipping_method) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'shipping_method required' }) };
    }

    const apiHeaders = {
      'StarShipIT-Api-Key': API_KEY,
      'Ocp-Apim-Subscription-Key': SUB_KEY,
      'Content-Type': 'application/json',
    };

    // Step 1: Fetch the existing order details
    const searchRes = await fetch(
      `https://api.starshipit.com/api/orders/search?order_id=${order_id}`,
      { headers: apiHeaders }
    );
    const searchData = await searchRes.json();
    const existingOrder = searchData.order || searchData.orders?.[0];

    if (!existingOrder) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Order not found in StarshipIt' }) };
    }

    // Step 2: Delete the existing order
    const deleteRes = await fetch(
      `https://api.starshipit.com/api/orders/${order_id}`,
      { method: 'DELETE', headers: apiHeaders }
    );

    if (!deleteRes.ok) {
      const deleteErr = await deleteRes.json();
      console.error('[eship-update] Delete failed:', JSON.stringify(deleteErr));
      return { statusCode: deleteRes.status, headers, body: JSON.stringify({ error: 'Failed to delete old order', details: deleteErr }) };
    }

    await wait(500); // Brief pause between delete and recreate

    // Step 3: Recreate with new shipping method
    const newOrder = {
      order: {
        order_number: existingOrder.order_number,
        order_date: existingOrder.order_date || new Date().toISOString(),
        reference: existingOrder.reference || '',
        shipping_method: shipping_method,
        signature_required: existingOrder.signature_required || false,
        authority_to_leave: existingOrder.authority_to_leave !== false,
        currency: existingOrder.currency || 'NZD',
        destination: existingOrder.destination || {},
        sender: existingOrder.sender || undefined,
        items: existingOrder.items || [],
        packages: existingOrder.packages || [{}],
      },
    };

    const createRes = await fetch('https://api.starshipit.com/api/orders', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify(newOrder),
    });

    const createData = await createRes.json();

    if (!createRes.ok) {
      console.error('[eship-update] Recreate failed:', JSON.stringify(createData));
      return {
        statusCode: createRes.status,
        headers,
        body: JSON.stringify({
          error: 'Deleted old order but failed to recreate with new bag size. Order may need manual recreation.',
          details: createData,
          original_order: existingOrder,
        }),
      };
    }

    const newOrderId = createData.order?.order_id || order_id;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        order_id: newOrderId,
        old_order_id: order_id,
        shipping_method,
      }),
    };
  } catch (err) {
    console.error('[eship-update] Error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
