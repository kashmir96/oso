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

    // Update each order via PUT /api/orders with carrier_service_code
    let updated = 0;
    let lastError = '';
    for (const oid of ids) {
      try {
        console.log('[eship-update] Updating order', oid, 'to', shipping_method);
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
        const text = await res.text();
        console.log('[eship-update] Response for', oid, ':', res.status, text.slice(0, 300));
        let data;
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
        if (res.ok) updated++;
        else lastError = data.message || text.slice(0, 200);
      } catch (e) {
        console.error('[eship-update] Error for', oid, ':', e.message);
        lastError = e.message;
      }
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
      body: JSON.stringify({ error: lastError || 'Update failed for all orders' }),
    };
  } catch (err) {
    console.error('[eship-update] Error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
