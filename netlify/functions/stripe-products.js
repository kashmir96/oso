/**
 * stripe-products.js
 *
 * Manages Stripe products and prices for Primal Pantry.
 * Supports listing products, creating products, listing prices, and creating prices.
 *
 * POST body:
 *   { token, action, ...params }
 *
 * Actions:
 *   list-products   — lists all active products
 *   create-product  — creates a new product { name, description?, images? }
 *   list-prices     — lists prices for a product { product_id }
 *   create-price    — creates a new price { product_id, unit_amount, currency?, nickname?, recurring? }
 *
 * Env vars required:
 *   STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function reply(statusCode, data) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(data) };
}

async function getStaffByToken(token) {
  if (!token) return null;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id,role`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

async function supabaseInsert(table, row) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(row),
  });
  return res.json();
}

async function stripeGet(path, key) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { 'Authorization': `Bearer ${key}` },
  });
  return res.json();
}

async function stripePost(path, params, key) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') body.append(k, v);
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  return { status: res.status, data: await res.json() };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_KEY) return reply(500, { error: 'Stripe key not configured' });

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return reply(400, { error: 'Invalid JSON' });
  }

  // Auth — require admin/owner
  const staff = await getStaffByToken(body.token);
  if (!staff) return reply(401, { error: 'Unauthorized' });
  if (staff.role !== 'owner' && staff.role !== 'admin') {
    return reply(403, { error: 'Only admin/owner can manage products' });
  }

  const { action } = body;

  try {
    if (action === 'list-products') {
      const data = await stripeGet('products?active=true&limit=100', STRIPE_KEY);
      if (data.error) return reply(400, { error: data.error.message });
      return reply(200, { products: data.data || [] });
    }

    if (action === 'create-product') {
      const { name, description } = body;
      if (!name) return reply(400, { error: 'Product name is required' });
      const params = { name };
      if (description) params.description = description;
      const { status, data } = await stripePost('products', params, STRIPE_KEY);
      if (data.error) return reply(status, { error: data.error.message });
      return reply(200, { product: data });
    }

    if (action === 'list-prices') {
      const { product_id } = body;
      if (!product_id) return reply(400, { error: 'product_id is required' });
      const data = await stripeGet(`prices?product=${encodeURIComponent(product_id)}&active=true&limit=100`, STRIPE_KEY);
      if (data.error) return reply(400, { error: data.error.message });
      return reply(200, { prices: data.data || [] });
    }

    if (action === 'create-price') {
      const { product_id, unit_amount, currency, nickname, recurring_interval } = body;
      if (!product_id) return reply(400, { error: 'product_id is required' });
      if (!unit_amount && unit_amount !== 0) return reply(400, { error: 'unit_amount (in cents) is required' });

      const params = {
        product: product_id,
        unit_amount: String(Math.round(Number(unit_amount))),
        currency: currency || 'nzd',
      };
      if (nickname) params.nickname = nickname;
      if (recurring_interval) {
        params['recurring[interval]'] = recurring_interval;
      }

      const { status, data } = await stripePost('prices', params, STRIPE_KEY);
      if (data.error) return reply(status, { error: data.error.message });

      // If YAML metadata provided, also save to product_price_map
      let catalogEntry = null;
      if (body.category && body.product_type && body.variant && body.size && body.order_type) {
        try {
          catalogEntry = await supabaseInsert('product_price_map', {
            stripe_product_id: product_id,
            stripe_price_id: data.id,
            product_name: body.product_name || '',
            category: body.category,
            product_type: body.product_type,
            variant: body.variant,
            size: body.size,
            order_type: body.order_type,
            market: body.market || 'NZ',
            unit_amount: Math.round(Number(unit_amount)),
            currency: currency || 'nzd',
            display_price: body.display_price || null,
          });
        } catch (e) {
          console.error('[stripe-products] Catalog save error:', e);
        }
      }

      return reply(200, { price: data, catalogEntry });
    }

    return reply(400, { error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('[stripe-products] Error:', err);
    return reply(500, { error: err.message });
  }
};
