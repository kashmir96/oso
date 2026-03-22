/**
 * eship-update.js
 *
 * Update a StarshipIt order's shipping method (bag size).
 *
 * POST /.netlify/functions/eship-update
 * Body: { order_id: 123, shipping_method: "CPOLTPDL", token: "staff_token" }
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

    // Validate staff token
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

    // Update the order's shipping method via StarshipIt API
    const res = await fetch('https://api.starshipit.com/api/orders', {
      method: 'PUT',
      headers: apiHeaders,
      body: JSON.stringify({
        order: {
          order_id: order_id,
          shipping_method: shipping_method,
        },
      }),
    });

    const data = await res.json();

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
