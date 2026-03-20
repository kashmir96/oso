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

    // Debug: log response keys and sample order to help diagnose status mapping
    const unshippedKeys = Object.keys(unshippedData);
    const shippedKeys = Object.keys(shippedData);
    const sampleUnshipped = (unshippedData.orders || unshippedData.order || [])[0];
    const sampleShipped = (shippedData.orders || shippedData.order || [])[0];
    console.log('[eship-orders] Unshipped response keys:', unshippedKeys, 'count:', (unshippedData.orders || unshippedData.order || []).length);
    console.log('[eship-orders] Shipped response keys:', shippedKeys, 'count:', (shippedData.orders || shippedData.order || []).length);
    if (sampleUnshipped) console.log('[eship-orders] Sample unshipped order keys:', Object.keys(sampleUnshipped));
    if (sampleShipped) console.log('[eship-orders] Sample shipped order keys:', Object.keys(sampleShipped), 'status:', sampleShipped.status, 'delivered:', sampleShipped.delivered, 'tracking_events:', sampleShipped.tracking_events?.length);

    // Normalize: StarshipIt returns { orders: [...] } or { order: [...] }
    const unshipped = (unshippedData.orders || unshippedData.order || []).map(o => ({
      ...o,
      _shipping_status: o.printed ? 'Printed' : 'Waiting to Print',
      _status_group: 'unshipped',
    }));

    const shipped = (shippedData.orders || shippedData.order || []).map(o => {
      // Determine shipped status from tracking/delivery info
      const status = (o.status || '').toLowerCase();
      const lastEvent = (o.tracking_events || []).slice(-1)[0];
      const lastEventDesc = (lastEvent?.description || lastEvent?.status || '').toLowerCase();

      let _shipping_status = 'In Transit';
      let _status_group = 'shipped';

      if (o.delivered || status.includes('deliver') || lastEventDesc.includes('deliver')) {
        _shipping_status = 'Delivered';
        _status_group = 'delivered';
      } else if (
        status.includes('exception') || status.includes('fail') || status.includes('return') ||
        lastEventDesc.includes('exception') || lastEventDesc.includes('fail') || lastEventDesc.includes('return')
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
        total_unshipped: unshippedData.total || unshipped.length,
        total_shipped: shippedData.total || shipped.length,
        _debug: {
          unshipped_keys: unshippedKeys,
          shipped_keys: shippedKeys,
          unshipped_count: (unshippedData.orders || unshippedData.order || []).length,
          shipped_count: (shippedData.orders || shippedData.order || []).length,
          sample_shipped_status: sampleShipped ? { status: sampleShipped.status, delivered: sampleShipped.delivered, tracking_events_count: sampleShipped.tracking_events?.length, tracking_status: sampleShipped.tracking_status, current_status: sampleShipped.current_status } : null,
          sample_unshipped: sampleUnshipped ? { status: sampleUnshipped.status, printed: sampleUnshipped.printed, keys: Object.keys(sampleUnshipped) } : null,
        },
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
