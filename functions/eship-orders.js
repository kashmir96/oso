/**
 * eship-orders.js
 *
 * Netlify function proxy for StarshipIt API.
 * Returns unshipped + shipped orders so the dashboard can display
 * shipping status, tracking numbers, etc.
 *
 * Env vars required:
 *   STARSHIPIT_API_KEY
 *   STARSHIPIT_SUBSCRIPTION_KEY
 */

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const fetch = (await import('node-fetch')).default;

  const API_KEY = process.env.STARSHIPIT_API_KEY;
  const SUB_KEY = process.env.STARSHIPIT_SUBSCRIPTION_KEY;

  if (!API_KEY || !SUB_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'StarshipIt keys not configured' }) };
  }

  const apiHeaders = {
    'StarShipIT-Api-Key': API_KEY,
    'Ocp-Apim-Subscription-Key': SUB_KEY,
    'Content-Type': 'application/json',
  };

  // Query params from dashboard
  const params = event.queryStringParameters || {};
  const sinceDate = params.since || '';  // e.g. '2026-01-01'
  const page = params.page || '1';
  const limit = params.limit || '50';

  try {
    // Fetch both unshipped and shipped orders in parallel
    const [unshippedRes, shippedRes] = await Promise.all([
      fetch(`https://api.starshipit.com/api/orders?limit=${limit}&page=${page}${sinceDate ? '&since_order_date=' + sinceDate : ''}`, {
        method: 'GET',
        headers: apiHeaders,
      }),
      fetch(`https://api.starshipit.com/api/orders/shipped?limit=${limit}&page=${page}${sinceDate ? '&since_order_date=' + sinceDate : ''}`, {
        method: 'GET',
        headers: apiHeaders,
      }),
    ]);

    const unshippedData = await unshippedRes.json();
    const shippedData = await shippedRes.json();

    // Normalize: StarshipIt returns { orders: [...] } or { order: [...] }
    const unshipped = (unshippedData.orders || unshippedData.order || []).map(o => ({
      ...o,
      _shipping_status: 'Unshipped',
    }));

    const shipped = (shippedData.orders || shippedData.order || []).map(o => ({
      ...o,
      _shipping_status: 'Shipped',
    }));

    // Combine and sort by date descending
    const all = [...shipped, ...unshipped].sort((a, b) => {
      const da = new Date(a.order_date || a.shipped_date || 0);
      const db = new Date(b.order_date || b.shipped_date || 0);
      return db - da;
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        orders: all,
        total_unshipped: unshippedData.total || unshipped.length,
        total_shipped: shippedData.total || shipped.length,
      }),
    };
  } catch (err) {
    console.error('[eship-orders] Error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
