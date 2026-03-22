/**
 * eship-update.js
 *
 * Change a StarshipIt order's bag size by deleting and recreating it.
 * StarshipIt has no API field for carrier product code — it's set at
 * creation time via shipping_method which maps to carrier rules.
 *
 * POST /.netlify/functions/eship-update
 * Body: { order_id: 123, shipping_method: "CPOLTPA5", token: "staff_token" }
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

async function apiFetch(url, apiHeaders, options = {}) {
  const res = await fetch(url, { headers: apiHeaders, ...options });
  return res.json();
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const API_KEY = process.env.STARSHIPIT_API_KEY;
  const SUB_KEY = process.env.STARSHIPIT_SUBSCRIPTION_KEY;
  if (!API_KEY || !SUB_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'StarshipIt keys not configured' }) };

  try {
    const body = JSON.parse(event.body || '{}');
    const { order_id, shipping_method, token } = body;

    const staff = await validateToken(token);
    if (!staff) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    if (!order_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'order_id required' }) };
    if (!shipping_method) return { statusCode: 400, headers, body: JSON.stringify({ error: 'shipping_method required' }) };

    const apiHeaders = {
      'StarShipIT-Api-Key': API_KEY,
      'Ocp-Apim-Subscription-Key': SUB_KEY,
      'Content-Type': 'application/json',
    };

    // Step 1: Find the order in unshipped list (most reliable source of full order data)
    console.log('[eship-update] Looking for order_id:', order_id);
    const unshippedData = await apiFetch('https://api.starshipit.com/api/orders/unshipped?limit=200', apiHeaders);
    const unshippedOrders = Array.isArray(unshippedData.orders) ? unshippedData.orders : [];
    let existingOrder = unshippedOrders.find(o => o.order_id === order_id);

    // Also check printed orders if not found in unshipped
    if (!existingOrder) {
      const summaryData = await apiFetch('https://api.starshipit.com/api/orders/summary?order_status=printed', apiHeaders);
      const printedOrders = Array.isArray(summaryData.orders) ? summaryData.orders : [];
      existingOrder = printedOrders.find(o => o.order_id === order_id);
    }

    if (!existingOrder) {
      console.log('[eship-update] Order not found in unshipped or printed lists');
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Order not found — can only change bag size on unshipped/printed orders' }) };
    }

    console.log('[eship-update] Found order:', existingOrder.order_number, 'current shipping_method:', existingOrder.shipping_method);

    // Step 2: Delete the existing order
    const deleteRes = await fetch(`https://api.starshipit.com/api/orders/${order_id}`, {
      method: 'DELETE',
      headers: apiHeaders,
    });

    if (!deleteRes.ok) {
      const deleteErr = await deleteRes.text();
      console.error('[eship-update] Delete failed:', deleteErr);
      return { statusCode: deleteRes.status, headers, body: JSON.stringify({ error: 'Failed to delete order: ' + deleteErr }) };
    }

    console.log('[eship-update] Deleted order_id:', order_id);
    await wait(800);

    // Step 3: Recreate with the new shipping method
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
        items: (existingOrder.items || []).map(item => ({
          description: item.description || '',
          sku: item.sku || '',
          quantity: item.quantity || 1,
          weight: item.weight || 0.2,
          value: item.value || 0,
          country_of_origin: item.country_of_origin || 'New Zealand',
        })),
        packages: existingOrder.packages || [{ weight: 0.5, height: 0.13, width: 0.13, length: 0.24 }],
      },
    };

    console.log('[eship-update] Recreating with shipping_method:', shipping_method);
    const createRes = await fetch('https://api.starshipit.com/api/orders', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify(newOrder),
    });

    const createData = await createRes.json();
    console.log('[eship-update] Create response:', JSON.stringify(createData).slice(0, 500));

    if (!createRes.ok) {
      console.error('[eship-update] Recreate FAILED — original order was deleted!');
      return {
        statusCode: createRes.status,
        headers,
        body: JSON.stringify({
          error: 'Deleted old order but failed to recreate. Contact support with this data.',
          details: createData,
          original_order: existingOrder,
        }),
      };
    }

    const newOrderId = createData.order?.order_id || order_id;
    console.log('[eship-update] Success! New order_id:', newOrderId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, order_id: newOrderId, old_order_id: order_id, shipping_method }),
    };
  } catch (err) {
    console.error('[eship-update] Error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
