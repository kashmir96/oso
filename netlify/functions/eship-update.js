/**
 * eship-update.js
 *
 * Update a StarshipIt order's shipping method (bag size).
 *
 * NOTE: StarshipIt does not allow setting carrier_service_code
 * directly via the API. You must set up Rules in your StarshipIt
 * dashboard (Settings → Rules) that map shipping_method values
 * (CPOLTPDL, CPOLTPA5, CPOLTPA4, CPOLTPA3) to the corresponding
 * NZ Post carrier products.
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

    // Update the order via StarshipIt PUT API
    // Try all possible field names for carrier product code
    const updateBody = {
      order: {
        order_id: order_id,
        carrier: 'CourierPost',
        carrier_service_code: shipping_method,
        shipping_method: shipping_method,
        shipping_description: shipping_method,
      },
    };
    console.log('[eship-update] Sending:', JSON.stringify(updateBody));

    const res = await fetch('https://api.starshipit.com/api/orders', {
      method: 'PUT',
      headers: apiHeaders,
      body: JSON.stringify(updateBody),
    });

    const data = await res.json();
    console.log('[eship-update] Response:', JSON.stringify(data));

    if (!res.ok) {
      console.error('[eship-update] StarshipIt error:', JSON.stringify(data));
      return { statusCode: res.status, headers, body: JSON.stringify({ error: data.message || 'StarshipIt update failed', details: data }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, order_id, shipping_method }),
    };
  } catch (err) {
    console.error('[eship-update] Error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
