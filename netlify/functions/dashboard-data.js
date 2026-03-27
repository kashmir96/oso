/**
 * dashboard-data.js
 *
 * Authenticated data proxy for the dashboard.
 * Validates staff session token, then executes whitelisted
 * Supabase operations using the service key.
 *
 * POST body:
 *   { token, table, operation, params }
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_TABLES = new Set([
  'orders',
  'order_line_items',
  'customer_tags',
  'manufacturing_batches',
  'product_unit_costs',
  'checkout_errors',
  'inventory_baselines',
  'inventory_reorder_points',
  'supplier_orders',
  'customer_reviews',
  'email_messages',
  'gmail_accounts',
  'product_price_map',
  'contacts',
  'email_prompts',
  'suppliers',
  'wholesalers',
  'meta_contacts',
  'macros',
  'live_chat_sessions',
  'action_rules',
  'action_alerts',
  'action_rule_config',
  'action_daily_summary',
  'site_changelogs',
  'adspend_hourly',
  'expenses',
  'tests',
  'quiz_leads',
  'quiz_referrals',
  'quiz_sessions',
]);

const ALLOWED_OPS = new Set(['select', 'insert', 'update', 'delete', 'upsert']);

let _sb;
function getSb() {
  if (!_sb) _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _sb;
}

async function validateToken(token) {
  if (!token) return null;
  const sb = getSb();
  const { data } = await sb.from('staff').select('id,role').eq('session_token', token).single();
  return data;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { token, table, operation, params = {} } = body;

  // Auth check
  const staff = await validateToken(token);
  if (!staff) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorised' }) };
  }

  // Whitelist checks
  if (!ALLOWED_TABLES.has(table)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: `Table "${table}" not allowed` }) };
  }
  if (!ALLOWED_OPS.has(operation)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: `Operation "${operation}" not allowed` }) };
  }

  const sb = getSb();

  try {
    let query = sb.from(table);

    // Build query based on operation
    switch (operation) {
      case 'select':
        query = query.select(params.select || '*');
        break;
      case 'insert':
        if (!params.data) return { statusCode: 400, headers, body: JSON.stringify({ error: 'data required for insert' }) };
        query = query.insert(params.data);
        break;
      case 'update':
        if (!params.data) return { statusCode: 400, headers, body: JSON.stringify({ error: 'data required for update' }) };
        query = query.update(params.data);
        break;
      case 'delete':
        query = query.delete();
        break;
      case 'upsert':
        if (!params.data) return { statusCode: 400, headers, body: JSON.stringify({ error: 'data required for upsert' }) };
        const upsertOpts = {};
        if (params.onConflict) upsertOpts.onConflict = params.onConflict;
        query = query.upsert(params.data, upsertOpts);
        break;
    }

    // Apply filters
    if (params.filters && Array.isArray(params.filters)) {
      for (const f of params.filters) {
        if (f.op === 'eq') query = query.eq(f.col, f.val);
        else if (f.op === 'neq') query = query.neq(f.col, f.val);
        else if (f.op === 'gt') query = query.gt(f.col, f.val);
        else if (f.op === 'gte') query = query.gte(f.col, f.val);
        else if (f.op === 'lt') query = query.lt(f.col, f.val);
        else if (f.op === 'lte') query = query.lte(f.col, f.val);
        else if (f.op === 'in') query = query.in(f.col, f.val);
        else if (f.op === 'cs') query = query.contains(f.col, f.val);
      }
    }

    // Apply ordering
    if (params.order) {
      query = query.order(params.order.col, { ascending: params.order.ascending ?? true });
    }

    // Apply limit
    if (params.limit) {
      query = query.limit(params.limit);
    }

    // Apply select for insert/update/upsert (to return data)
    if (['insert', 'update', 'upsert'].includes(operation) && params.select) {
      query = query.select(params.select);
    }

    // Single row
    if (params.single) {
      query = query.single();
    }

    // For large select queries without an explicit limit, paginate to get ALL rows
    // (Supabase defaults to 1000 rows per request)
    if (operation === 'select' && !params.limit && !params.single) {
      let allData = [];
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        let pageQuery = sb.from(table).select(params.select || '*');
        // Re-apply filters
        if (params.filters && Array.isArray(params.filters)) {
          for (const f of params.filters) {
            if (f.op === 'eq') pageQuery = pageQuery.eq(f.col, f.val);
            else if (f.op === 'neq') pageQuery = pageQuery.neq(f.col, f.val);
            else if (f.op === 'gt') pageQuery = pageQuery.gt(f.col, f.val);
            else if (f.op === 'gte') pageQuery = pageQuery.gte(f.col, f.val);
            else if (f.op === 'lt') pageQuery = pageQuery.lt(f.col, f.val);
            else if (f.op === 'lte') pageQuery = pageQuery.lte(f.col, f.val);
            else if (f.op === 'in') pageQuery = pageQuery.in(f.col, f.val);
            else if (f.op === 'cs') pageQuery = pageQuery.contains(f.col, f.val);
          }
        }
        if (params.order) {
          pageQuery = pageQuery.order(params.order.col, { ascending: params.order.ascending ?? true });
        }
        pageQuery = pageQuery.range(offset, offset + PAGE - 1);
        const { data: pageData, error: pageError } = await pageQuery;
        if (pageError) {
          return { statusCode: 400, headers, body: JSON.stringify({ data: null, error: { message: pageError.message } }) };
        }
        allData = allData.concat(pageData || []);
        if (!pageData || pageData.length < PAGE) break;
        offset += PAGE;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ data: allData, error: null }) };
    }

    const { data, error } = await query;

    if (error) {
      return { statusCode: 400, headers, body: JSON.stringify({ data: null, error: { message: error.message } }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ data, error: null }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ data: null, error: { message: err.message } }) };
  }
};
