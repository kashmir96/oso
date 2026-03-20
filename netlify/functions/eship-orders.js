/**
 * eship-orders.js
 *
 * Netlify function proxy for StarshipIt API.
 * Returns unshipped + shipped orders so the dashboard can display
 * shipping status, tracking numbers, etc.
 *
 * Statuses:
 *   Unshipped: "Waiting to Print" | "Printed"
 *   Shipped:   "In Transit" | "Delivered" | "Exception"
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

    // StarshipIt unshipped endpoint returns { data: [...] }, shipped returns { orders: [...] }
    const rawUnshipped = unshippedData.data || unshippedData.orders || unshippedData.order || [];
    const unshippedList = Array.isArray(rawUnshipped) ? rawUnshipped : [];
    const rawShipped = shippedData.orders || shippedData.order || [];
    const shippedList = Array.isArray(rawShipped) ? rawShipped : [];

    const unshipped = unshippedList.map(o => ({
      ...o,
      _shipping_status: o.printed ? 'Printed' : 'Waiting to Print',
      _status_group: 'unshipped',
    }));

    const shipped = shippedList.map(o => {
      // StarshipIt uses tracking_short_status / tracking_full_status rather than status/tracking_events
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
        total_unshipped: unshippedData.total_records || unshipped.length,
        total_shipped: shippedData.total || shipped.length,
        _debug_unshipped_type: typeof (unshippedData.data),
        _debug_unshipped_keys: Object.keys(unshippedData),
        _debug_unshipped_data_sample: unshippedData.data ? JSON.stringify(unshippedData.data).slice(0, 500) : 'null',
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
