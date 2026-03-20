/**
 * eship-cancel.js
 *
 * Deletes an unshipped order from StarshipIt when refunded.
 * Expects POST with { order_number: "cs_live_..." }
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

  const apiHeaders = {
    'StarShipIT-Api-Key': API_KEY,
    'Ocp-Apim-Subscription-Key': SUB_KEY,
    'Content-Type': 'application/json',
  };

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const orderNumber = body.order_number;
  if (!orderNumber) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'order_number required' }) };
  }

  try {
    // Search for the order in StarshipIt unshipped orders
    const searchRes = await fetch(`https://api.starshipit.com/api/orders/search?order_number=${encodeURIComponent(orderNumber)}`, {
      method: 'GET',
      headers: apiHeaders,
    });

    const searchData = await searchRes.json();
    const orders = searchData.orders || searchData.order || [];

    if (orders.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Order not found in StarshipIt (may already be shipped or removed)' }),
      };
    }

    // Delete the order — try by order_id if available, otherwise by order_number
    const starshipOrderId = orders[0].order_id || orders[0].id;

    const deleteRes = await fetch(`https://api.starshipit.com/api/orders/${starshipOrderId}`, {
      method: 'DELETE',
      headers: apiHeaders,
    });

    if (!deleteRes.ok) {
      const errText = await deleteRes.text();
      return {
        statusCode: deleteRes.status,
        headers,
        body: JSON.stringify({ error: `StarshipIt delete failed: ${errText}` }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: `Order ${orderNumber} removed from StarshipIt` }),
    };
  } catch (err) {
    console.error('[eship-cancel] Error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
