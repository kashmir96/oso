/**
 * eship-orders.js
 *
 * Netlify function proxy for StarshipIt API.
 * Fetches orders from all tabs (New, Printed, Shipped) with summary counts.
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
    // Batch 1: unshipped + summary (summary returns all counts regardless of order_status param)
    const [unshippedRes, summaryRes] = await Promise.all([
      fetch(`https://api.starshipit.com/api/orders/unshipped?limit=${limit}&page=${page}${sinceDate ? '&since_order_date=' + sinceDate : ''}`, {
        headers: apiHeaders,
      }),
      fetch('https://api.starshipit.com/api/orders/summary?order_status=new', { headers: apiHeaders }),
    ]);

    const unshippedData = await unshippedRes.json();
    const summaryData = await summaryRes.json();

    // Batch 2: printed + shipped
    const [printedRes, shippedRes] = await Promise.all([
      fetch(`https://api.starshipit.com/api/orders?status=Printed&page_size=${limit}&page_number=${page}`, {
        headers: apiHeaders,
      }),
      fetch(`https://api.starshipit.com/api/orders/shipped?limit=${limit}&page=${page}${sinceDate ? '&since_order_date=' + sinceDate : ''}`, {
        headers: apiHeaders,
      }),
    ]);

    const printedData = await printedRes.json();
    const shippedData = await shippedRes.json();

    // Parse order lists
    const unshippedList = Array.isArray(unshippedData.orders) ? unshippedData.orders : [];
    const printedList = Array.isArray(printedData.order) ? printedData.order : [];
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

    // Summary has: unprinted_count, printed_count, shipped_count, archived_count, etc.
    const counts = summaryData.order_counts || summaryData;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        orders: all,
        summary: {
          waiting_to_print: counts.unprinted_count || unshipped.length,
          printed: counts.printed_count || printed.length,
          shipped: counts.shipped_count || shipped.length,
          archived: counts.archived_count || 0,
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
