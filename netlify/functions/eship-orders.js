/**
 * eship-orders.js
 *
 * Netlify function proxy for StarshipIt API.
 * Returns unshipped + printed + shipped orders so the dashboard can display
 * shipping status, tracking numbers, etc.
 *
 * StarshipIt API endpoints used:
 *   /api/orders/unshipped  – "New" tab orders (waiting to print)
 *   /api/orders?status=Printed – "Printed" tab orders (labels printed, not yet shipped)
 *   /api/orders/shipped    – "Shipped" tab orders (dispatched)
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

  if (event.httpMethod !== 'GET') {
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

  const params = event.queryStringParameters || {};
  const sinceDate = params.since || '';
  const page = params.page || '1';
  const limit = params.limit || '50';

  try {
    // Fetch all three tabs in parallel
    const [unshippedRes, printedRes, shippedRes] = await Promise.all([
      // "New" tab — /api/orders/unshipped
      fetch(`https://api.starshipit.com/api/orders/unshipped?limit=${limit}&page=${page}${sinceDate ? '&since_order_date=' + sinceDate : ''}`, {
        headers: apiHeaders,
      }),
      // "Printed" tab — /api/orders?status=Printed
      fetch(`https://api.starshipit.com/api/orders?status=Printed&page_size=${limit}&page_number=${page}`, {
        headers: apiHeaders,
      }),
      // "Shipped" tab — /api/orders/shipped
      fetch(`https://api.starshipit.com/api/orders/shipped?limit=${limit}&page=${page}${sinceDate ? '&since_order_date=' + sinceDate : ''}`, {
        headers: apiHeaders,
      }),
    ]);

    const unshippedData = await unshippedRes.json();
    const printedData = await printedRes.json();
    const shippedData = await shippedRes.json();

    // /api/orders/unshipped returns { orders: [...] }
    const unshippedList = Array.isArray(unshippedData.orders) ? unshippedData.orders : [];
    // /api/orders?status=Printed returns { order: [...] }
    const printedList = Array.isArray(printedData.order) ? printedData.order : [];
    // /api/orders/shipped returns { orders: [...] }
    const shippedList = Array.isArray(shippedData.orders) ? shippedData.orders : [];

    const unshipped = unshippedList.map(o => ({
      ...o,
      _shipping_status: 'Waiting to Print',
      _status_group: 'unshipped',
    }));

    const printed = printedList.map(o => ({
      ...o,
      _shipping_status: 'Printed',
      _status_group: 'printed',
    }));

    const shipped = shippedList.map(o => {
      const shortStatus = (o.tracking_short_status || '').toLowerCase();
      const fullStatus = (o.tracking_full_status || '').toLowerCase();
      const status = (o.status || '').toLowerCase();

      let _shipping_status = 'In Transit';
      let _status_group = 'shipped';

      if (
        o.delivered ||
        shortStatus.includes('deliver') || fullStatus.includes('deliver') ||
        status.includes('deliver')
      ) {
        _shipping_status = 'Delivered';
        _status_group = 'delivered';
      } else if (
        shortStatus.includes('exception') || shortStatus.includes('fail') || shortStatus.includes('return') ||
        fullStatus.includes('exception') || fullStatus.includes('fail') || fullStatus.includes('return') ||
        status.includes('exception') || status.includes('fail') || status.includes('return')
      ) {
        _shipping_status = 'Exception';
        _status_group = 'exception';
      }

      return { ...o, _shipping_status, _status_group };
    });

    // Combine and sort by date descending
    const all = [...shipped, ...printed, ...unshipped].sort((a, b) => {
      const da = new Date(a.order_date || a.shipped_date || 0);
      const db = new Date(b.order_date || b.shipped_date || 0);
      return db - da;
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        orders: all,
        total_unshipped: unshippedData.total_pages ? (unshippedData.total_pages * parseInt(limit)) : unshipped.length,
        total_printed: printedList.length,
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
