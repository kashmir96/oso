/**
 * claude-chat.js
 *
 * Authenticated proxy to Claude API for the dashboard AI assistant.
 * Supports tool use so Claude can manipulate dashboard filters/tabs.
 *
 * POST { token, messages, context }
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY
 */

const Anthropic = require('@anthropic-ai/sdk');

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function reply(statusCode, data) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(data) };
}

async function sbFetch(url, opts = {}) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${SUPABASE_URL}${url}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      ...opts.headers,
    },
  });
}

async function getStaffByToken(token) {
  if (!token) return null;
  const res = await sbFetch(`/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id`);
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

// Tools Claude can use to manipulate the dashboard
const DASHBOARD_TOOLS = [
  {
    name: 'switch_tab',
    description: 'Switch the dashboard to a different tab.',
    input_schema: {
      type: 'object',
      properties: {
        tab: {
          type: 'string',
          enum: ['sales', 'orders', 'shipping', 'customers', 'comms', 'manufacturing', 'website', 'marketing', 'finance', 'actions', 'settings'],
          description: 'The tab to switch to. "sales" is the Overview tab.',
        },
      },
      required: ['tab'],
    },
  },
  {
    name: 'set_date_range',
    description: 'Change the dashboard date range filter.',
    input_schema: {
      type: 'object',
      properties: {
        range: {
          type: 'string',
          enum: ['today', 'yesterday', '7d', '30d', 'month', 'all', 'custom'],
          description: 'Preset date range, or "custom" to specify exact dates.',
        },
        from: { type: 'string', description: 'Start date (YYYY-MM-DD) when range is "custom".' },
        to: { type: 'string', description: 'End date (YYYY-MM-DD) when range is "custom".' },
      },
      required: ['range'],
    },
  },
  {
    name: 'set_filter',
    description: 'Set a filter on the dashboard (source, medium, campaign, or city).',
    input_schema: {
      type: 'object',
      properties: {
        filter_type: {
          type: 'string',
          enum: ['source', 'medium', 'campaign', 'city'],
          description: 'Which filter to set.',
        },
        value: {
          type: 'string',
          description: 'The value to filter by. Use empty string "" to clear this filter.',
        },
      },
      required: ['filter_type', 'value'],
    },
  },
  {
    name: 'clear_filters',
    description: 'Reset all filters to their default state (All).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'scroll_to_section',
    description: 'Scroll the dashboard to a specific section.',
    input_schema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['stats', 'revenue-chart', 'hours-chart', 'products-chart', 'heatmap', 'map', 'utm', 'trending', 'orders-table'],
          description: 'The section to scroll to.',
        },
      },
      required: ['section'],
    },
  },
  {
    name: 'get_table_data',
    description: 'Read data from a specific table currently visible on the dashboard UI. Use this to get detailed data before answering questions.',
    input_schema: {
      type: 'object',
      properties: {
        table: {
          type: 'string',
          enum: ['orders', 'trending_products', 'utm_campaigns', 'bought_together', 'magnet_products', 'shipping', 'customers', 'website_pages', 'website_referrers', 'website_browsers', 'website_countries'],
          description: 'Which UI table to read.',
        },
      },
      required: ['table'],
    },
  },
  {
    name: 'query_database',
    description: 'Query the Supabase database directly. Use this to access raw data across all tables — orders, line items, customers, inventory, manufacturing, shipping, analytics, abandoned carts, email messages, reviews, and more. Returns up to 100 rows. You can select specific columns, filter, and sort.',
    input_schema: {
      type: 'object',
      properties: {
        table: {
          type: 'string',
          description: 'The database table to query. Available tables: orders, order_line_items, product_cogs, inventory_baselines, inventory_reorder_points, manufacturing_batches, shipments, customer_reviews, abandoned_checkout_status, email_messages, gmail_accounts, site_changelogs, competitors, competitor_snapshots, competitor_changes, staff (limited fields), google_tokens (limited), xero_tokens (limited)',
        },
        select: {
          type: 'string',
          description: 'Columns to select (PostgREST format). E.g. "id,email,total_value,order_date" or "*" for all. Sensitive columns (passwords, tokens, secrets) are automatically stripped.',
        },
        filters: {
          type: 'string',
          description: 'PostgREST filter query string. E.g. "order_date=gte.2024-01-01&order_date=lte.2024-01-31&city=eq.Auckland". Supports eq, neq, gt, gte, lt, lte, like, ilike, in, is.',
        },
        order: {
          type: 'string',
          description: 'Sort order. E.g. "order_date.desc" or "total_value.desc".',
        },
        limit: {
          type: 'number',
          description: 'Max rows to return (default 50, max 100).',
        },
      },
      required: ['table'],
    },
  },
];

// Columns to strip from database results (security)
const SENSITIVE_COLUMNS = ['password', 'password_hash', 'session_token', 'access_token', 'refresh_token', 'oauth_state', 'secret', 'api_key', 'totp_secret'];

function stripSensitive(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map(row => {
    const clean = {};
    for (const [k, v] of Object.entries(row)) {
      if (SENSITIVE_COLUMNS.some(s => k.toLowerCase().includes(s))) continue;
      clean[k] = v;
    }
    return clean;
  });
}

async function executeDbQuery(input) {
  const { table, select, filters, order, limit } = input;

  // Block fully sensitive tables
  const blocked = ['secrets', 'api_keys'];
  if (blocked.includes(table)) return { error: 'Access denied to this table' };

  let url = `/rest/v1/${encodeURIComponent(table)}?`;
  const params = [];

  // Select
  const sel = select || '*';
  params.push(`select=${encodeURIComponent(sel)}`);

  // Filters
  if (filters) params.push(filters);

  // Order
  if (order) params.push(`order=${encodeURIComponent(order)}`);

  // Limit
  const lim = Math.min(Number(limit) || 50, 100);
  params.push(`limit=${lim}`);

  url += params.join('&');

  try {
    const res = await sbFetch(url);
    const data = await res.json();
    if (!res.ok) return { error: data.message || `Database error ${res.status}`, hint: data.hint || '' };
    return { rows: stripSensitive(data), count: data.length };
  } catch (e) {
    return { error: e.message };
  }
}

const SYSTEM_PROMPT = `You are an AI assistant embedded in the Primal Pantry business dashboard. Primal Pantry is a New Zealand-based tallow skincare brand selling online via Stripe, with NZ and AU markets.

You help the business owner interpret their data — sales, orders, website analytics, shipping, customer behavior, ad spend, and manufacturing.

You have tools to manipulate the dashboard (switch tabs, change date ranges, set filters, scroll, read UI tables) AND you can query the database directly with query_database for raw data across all tables.

Key database tables:
- orders: id, order_date, email, name, city, total_value, shipping_cost, payment_status, fulfillment_status, source, utm_source, utm_medium, utm_campaign, utm_content, created_at, order_hour
- order_line_items: id, order_id, sku, product_name, quantity, unit_price, total_price
- product_cogs: sku, product_name, cogs_nzd
- inventory_baselines: sku, product_name, quantity, counted_at
- inventory_reorder_points: sku, reorder_point, reorder_qty
- manufacturing_batches: id, product_sku, product_name, quantity, status, created_at
- shipments: id, order_id, tracking_number, carrier, status, shipped_at
- customer_reviews: id, order_id, email, name, rating, review_text, created_at
- abandoned_checkout_status: stripe_session_id, email, status, created_at, recovered_at
- email_messages: id, gmail_account_id, thread_id, subject, from_address, to_address, date, snippet, labels
- site_changelogs: id, deploy_id, deployed_at, summary, files_changed, is_funnel_related
- competitors: id, name, url, active
- competitor_snapshots: id, competitor_id, checked_at, product_count, price_range
- staff: id, username, display_name, role (no passwords/tokens)

Guidelines:
- Be concise and direct. Lead with insights, not fluff.
- Use NZD ($) for currency unless discussing AU orders.
- When analyzing trends, compare to previous periods when context is available.
- If the user asks about something on a different tab, switch to it.
- Use query_database proactively when you need raw data to answer well.
- Highlight anomalies, trends, and actionable insights.
- You can chain multiple tool calls — e.g., switch tab + query database + read table.`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return reply(400, { error: 'Invalid JSON' });
  }

  const { token, messages, context } = body;

  // Auth
  const staff = await getStaffByToken(token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return reply(500, { error: 'ANTHROPIC_API_KEY not configured' });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Build system prompt with current dashboard context
  let systemPrompt = SYSTEM_PROMPT;
  if (context) {
    systemPrompt += `\n\n## Current Dashboard State\n${context}`;
  }

  try {
    let currentMessages = [...messages];
    let totalUsage = { input_tokens: 0, output_tokens: 0 };

    // Loop to handle server-side tool calls (query_database)
    for (let turn = 0; turn < 4; turn++) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        tools: DASHBOARD_TOOLS,
        messages: currentMessages,
      });

      totalUsage.input_tokens += response.usage?.input_tokens || 0;
      totalUsage.output_tokens += response.usage?.output_tokens || 0;

      // Check if any tool calls are query_database (server-side)
      const serverToolCalls = response.content.filter(c => c.type === 'tool_use' && c.name === 'query_database');

      if (serverToolCalls.length === 0 || response.stop_reason !== 'tool_use') {
        // No server-side tools — return response to client for UI tool handling
        return reply(200, {
          content: response.content,
          stop_reason: response.stop_reason,
          usage: totalUsage,
        });
      }

      // Execute server-side tool calls and continue the loop
      currentMessages.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          if (block.name === 'query_database') {
            const result = await executeDbQuery(block.input);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result).slice(0, 8000) });
          } else {
            // Client-side tool — return a placeholder so the loop can continue
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: '{"status":"executed_on_client"}' });
          }
        }
      }
      currentMessages.push({ role: 'user', content: toolResults });
    }

    // Max turns reached — return last response
    return reply(200, { content: [{ type: 'text', text: 'I ran into complexity limits. Please try a simpler question.' }], stop_reason: 'end_turn', usage: totalUsage });
  } catch (err) {
    console.error('Claude API error:', err);
    return reply(502, { error: 'AI service error: ' + (err.message || 'unknown') });
  }
};
