/**
 * eship-update.js
 *
 * Update StarshipIt order(s) carrier product code (bag size).
 *
 * Supports single and batch updates:
 *   Single: { order_id: 123, shipping_method: "CPOLTPA5", token: "..." }
 *   Batch:  { order_ids: [123, 456], shipping_method: "CPOLTPA5", token: "..." }
 *
 * Uses two approaches for reliability:
 * 1. PUT /api/orders with carrier_service_code (single order update)
 * 2. PUT /api/orders/update with product_code (batch update)
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
    const { order_id, order_ids, shipping_method, token } = body;

    const staff = await validateToken(token);
    if (!staff) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    if (!shipping_method) return { statusCode: 400, headers, body: JSON.stringify({ error: 'shipping_method required' }) };

    const ids = order_ids || (order_id ? [order_id] : []);
    if (ids.length === 0) return { statusCode: 400, headers, body: JSON.stringify({ error: 'order_id or order_ids required' }) };

    const apiHeaders = {
      'StarShipIT-Api-Key': API_KEY,
      'Ocp-Apim-Subscription-Key': SUB_KEY,
      'Content-Type': 'application/json',
    };

    // Try batch update endpoint first (most direct way to set product code)
    const batchBody = {
      order_ids: ids,
      product_code: shipping_method,
    };

    console.log('[eship-update] Batch updating', ids.length, 'orders to product_code:', shipping_method);

    const batchRes = await fetch('https://api.starshipit.com/api/orders/update', {
      method: 'PUT',
      headers: apiHeaders,
      body: JSON.stringify(batchBody),
    });

    const batchData = await batchRes.json();
    console.log('[eship-update] Batch response:', batchRes.status, JSON.stringify(batchData).slice(0, 300));

    if (batchRes.ok) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, order_id: ids[0], order_ids: ids, shipping_method }),
      };
    }

    // Fallback: try single PUT with carrier_service_code for each order
    console.log('[eship-update] Batch failed, falling back to single updates');
    let updated = 0;
    for (const oid of ids) {
      const res = await fetch('https://api.starshipit.com/api/orders', {
        method: 'PUT',
        headers: apiHeaders,
        body: JSON.stringify({
          order: {
            order_id: oid,
            carrier_service_code: shipping_method,
            shipping_method: shipping_method,
          },
        }),
      });
      const data = await res.json();
      console.log('[eship-update] Single update', oid, ':', res.status, JSON.stringify(data).slice(0, 200));
      if (res.ok) updated++;
    }

    if (updated > 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, order_id: ids[0], order_ids: ids, shipping_method, updated }),
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Both batch and single update failed', batch_response: batchData }),
    };
  } catch (err) {
    console.error('[eship-update] Error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
