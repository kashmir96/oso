/**
 * manual-order.js
 *
 * Creates a manual order: saves to Supabase + pushes to StarshipIt.
 * Expects POST with order JSON from the dashboard form.
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   STARSHIPIT_API_KEY, STARSHIPIT_SUBSCRIPTION_KEY
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

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    customer_name, email, phone,
    street, suburb, city, postcode,
    items, // [{ description, sku, quantity, unit_price }]
    shipping_cost, payment_method, notes,
    eship_only, order_number, // eship_only mode: skip Supabase, use existing order_number
  } = body;

  if (!customer_name || !email || !city || !items || items.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: customer_name, email, city, items' }) };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const API_KEY = process.env.STARSHIPIT_API_KEY;
  const SUB_KEY = process.env.STARSHIPIT_SUBSCRIPTION_KEY;

  const results = { supabase: null, eship: null };

  // ── Calculate totals ──
  const totalValue = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
  // Use NZ time for order_date and order_hour (fallback to UTC if conversion fails)
  let orderDate, orderHour;
  try {
    const nzNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
    orderDate = `${nzNow.getFullYear()}-${String(nzNow.getMonth() + 1).padStart(2, '0')}-${String(nzNow.getDate()).padStart(2, '0')}`;
    orderHour = nzNow.getHours();
  } catch (_) {
    orderDate = new Date().toISOString().split('T')[0];
    orderHour = new Date().getUTCHours();
  }
  const manualId = eship_only ? order_number : ('manual_' + Date.now());

  // ── 1. Save to Supabase (skip in eship_only mode) ──
  if (eship_only) {
    results.supabase = { success: true, skipped: true };
  } else try {
    // Insert order
    const orderRes = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        stripe_session_id: manualId,
        order_date: orderDate,
        order_hour: orderHour,
        status: 'Ordered - Paid',
        customer_name,
        email,
        phone: phone || '',
        payment_method: payment_method || 'Manual',
        shipping_cost: Number(shipping_cost) || 0,
        discount_applied: 0,
        total_value: totalValue,
        currency: 'NZD',
        market: 'NZ',
        street_address: street || '',
        suburb: suburb || '',
        city,
        postcode: postcode || '',
        country_code: 'NZ',
      }),
    });

    const orderData = await orderRes.json();
    if (!orderRes.ok) {
      throw new Error(JSON.stringify(orderData));
    }

    const orderId = Array.isArray(orderData) ? orderData[0]?.id : orderData.id;

    // Insert line items
    if (orderId) {
      const lineItemRows = items.map(item => ({
        order_id: orderId,
        description: item.description,
        sku: item.sku || '',
        quantity: item.quantity,
        unit_price: item.unit_price,
      }));

      await fetch(`${SUPABASE_URL}/rest/v1/order_line_items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify(lineItemRows),
      });
    }

    results.supabase = { success: true, order_id: orderId };
  } catch (err) {
    results.supabase = { success: false, error: err.message };
  }

  // ── 2. Push to eShip ──
  if (API_KEY && SUB_KEY) {
    try {
      // Calculate jar count / weight / size from items
      let totalJars = 0;
      const goodsDescParts = [];
      const eshipItems = [];

      for (const item of items) {
        const skuLower = (item.sku || '').toLowerCase();
        let jarsPerUnit = 1;
        if (skuLower.includes('60ml') || skuLower.includes('lip')) jarsPerUnit = 0.5;
        else if (skuLower.includes('scalp-bundle')) jarsPerUnit = 9;
        else if (skuLower.includes('black')) jarsPerUnit = 9;
        else if (skuLower.includes('250')) jarsPerUnit = 9;
        else if (skuLower.includes('sensitive-skin-kit')) jarsPerUnit = 9;
        else if (skuLower.includes('anti-aging')) jarsPerUnit = 6;
        else if (skuLower.includes('shampoo-bottle') || skuLower.includes('conditioner')) jarsPerUnit = 6;
        else if (skuLower.includes('lotion') || skuLower.includes('liqsoap')) jarsPerUnit = 4;
        else if (skuLower.includes('liquid-bundle')) jarsPerUnit = 4;
        else if (skuLower.includes('vitallow')) jarsPerUnit = 3;
        else if (skuLower.includes('200ml') || skuLower.includes('powder')) jarsPerUnit = 2;
        else if (skuLower.includes('cleanser')) jarsPerUnit = 2;

        let packMultiplier = 1;
        if (skuLower.includes('-3pk') || skuLower.includes('trio')) packMultiplier = 3;

        const unitJars = jarsPerUnit * packMultiplier;
        totalJars += unitJars * item.quantity;

        goodsDescParts.push(`${item.quantity} x ${item.description || item.sku}`);
        eshipItems.push({
          description: item.description || item.sku,
          sku: item.sku || '',
          quantity: item.quantity,
          weight: Math.ceil((unitJars * item.quantity * 0.2) * 2) / 2,
          value: item.quantity * item.unit_price,
          country_of_origin: 'New Zealand',
        });
      }

      const weight = Math.ceil((totalJars * 0.2) * 2) / 2;
      let carrierProduct;
      if (totalJars > 9) carrierProduct = 'CPOLTPA3';
      else if (totalJars > 6) carrierProduct = 'CPOLTPA4';
      else if (totalJars > 3) carrierProduct = 'CPOLTPA5';
      else carrierProduct = 'CPOLTPDL';

      const goodsDesc = goodsDescParts.join(', ');

      const orderBody = {
        order: {
          order_number: manualId,
          order_date: new Date().toISOString(),
          reference: goodsDesc,
          shipping_method: carrierProduct,
          carrier_service_code: carrierProduct,
          carrier: 'CourierPost',
          signature_required: false,
          authority_to_leave: true,
          currency: 'NZD',
          destination: {
            name: customer_name,
            email,
            phone: phone || '',
            street: street || '',
            suburb: suburb || '',
            city,
            post_code: postcode || '',
            country: 'New Zealand',
            delivery_instructions: notes || goodsDesc,
          },
          items: eshipItems,
          packages: [{
            weight,
            height: 0.13,
            width: 0.13,
            length: 0.24,
          }],
        },
      };

      const eshipRes = await fetch('https://api.starshipit.com/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'StarShipIT-Api-Key': API_KEY,
          'Ocp-Apim-Subscription-Key': SUB_KEY,
        },
        body: JSON.stringify(orderBody),
      });

      const eshipData = await eshipRes.json();
      results.eship = eshipRes.ok
        ? { success: true, order_id: eshipData.order?.order_id }
        : { success: false, error: JSON.stringify(eshipData) };
    } catch (err) {
      results.eship = { success: false, error: err.message };
    }
  } else {
    results.eship = { success: false, error: 'StarshipIt keys not configured' };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(results),
  };
};
