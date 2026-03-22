/**
 * eship-print.js
 *
 * Netlify function to trigger StarshipIt to print all unshipped orders.
 * The StarshipIt Desktop Agent on the connected computer picks up the
 * print job and sends labels to the configured printer.
 *
 * POST /.netlify/functions/eship-print
 * Body: { order_ids: [123, 456, ...] }  (optional – omit to print all unshipped)
 *
 * Env vars required:
 *   STARSHIPIT_API_KEY
 *   STARSHIPIT_SUBSCRIPTION_KEY
 */

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function apiFetch(url, apiHeaders, options = {}) {
  const res = await fetch(url, { headers: apiHeaders, ...options });
  const data = await res.json();
  if (data.statusCode === 429) {
    await wait(1500);
    const retry = await fetch(url, { headers: apiHeaders, ...options });
    return retry.json();
  }
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

  const apiHeaders = {
    'StarShipIT-Api-Key': API_KEY,
    'Ocp-Apim-Subscription-Key': SUB_KEY,
    'Content-Type': 'application/json',
  };

  try {
    const body = JSON.parse(event.body || '{}');
    let orderIds = body.order_ids || [];
    const carrierServiceCode = body.carrier_service_code || null; // Optional: override bag size at print time

    // If no specific order IDs provided, fetch all unshipped orders
    if (orderIds.length === 0) {
      const unshippedData = await apiFetch(
        'https://api.starshipit.com/api/orders/unshipped?limit=200',
        apiHeaders
      );
      const unshippedOrders = Array.isArray(unshippedData.orders) ? unshippedData.orders : [];
      orderIds = unshippedOrders.map(o => o.order_id).filter(Boolean);
    }

    if (orderIds.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'No orders to print', printed: 0 }),
      };
    }

    // Call StarshipIt's print endpoint for each order
    // This creates shipments which the Desktop Agent will pick up and print
    // If carrier_service_code is provided, override the bag size at print time
    const results = [];
    for (const orderId of orderIds) {
      try {
        const shipmentBody = { order_id: orderId };
        if (carrierServiceCode) {
          shipmentBody.carrier_service_code = carrierServiceCode;
          shipmentBody.carrier = 'CourierPost';
        }
        const result = await apiFetch(
          'https://api.starshipit.com/api/orders/shipment',
          apiHeaders,
          {
            method: 'POST',
            body: JSON.stringify(shipmentBody),
          }
        );
        results.push({ order_id: orderId, success: !result.errors, result });
      } catch (err) {
        results.push({ order_id: orderId, success: false, error: err.message });
      }
    }

    const printed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        printed,
        total: orderIds.length,
        failed: failed.length > 0 ? failed : undefined,
      }),
    };
  } catch (err) {
    console.error('[eship-print] Error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
