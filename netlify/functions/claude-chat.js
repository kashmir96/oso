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
          enum: ['sales', 'orders', 'shipping', 'customers', 'manufacturing', 'website'],
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
    description: 'Read data from a specific table currently visible on the dashboard. Use this to get detailed data before answering questions.',
    input_schema: {
      type: 'object',
      properties: {
        table: {
          type: 'string',
          enum: ['orders', 'trending_products', 'utm_campaigns', 'bought_together', 'magnet_products', 'shipping', 'customers', 'website_pages', 'website_referrers', 'website_browsers', 'website_countries'],
          description: 'Which table to read.',
        },
      },
      required: ['table'],
    },
  },
];

const SYSTEM_PROMPT = `You are an AI assistant embedded in the Primal Pantry business dashboard. Primal Pantry is a New Zealand-based tallow skincare brand selling online via Stripe, with NZ and AU markets.

You help the business owner interpret their data — sales, orders, website analytics, shipping, customer behavior, ad spend, and manufacturing.

You have tools to manipulate the dashboard: switch tabs, change date ranges, set filters, scroll to sections, and read table data. Use these proactively when the user's question requires looking at specific data.

Guidelines:
- Be concise and direct. Lead with insights, not fluff.
- Use NZD ($) for currency unless discussing AU orders.
- When analyzing trends, compare to previous periods when context is available.
- If the user asks about something on a different tab, switch to it.
- If you need more data to answer well, use get_table_data before responding.
- Highlight anomalies, trends, and actionable insights.
- You can chain multiple tool calls — e.g., switch tab + set date range + read table.`;

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
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      tools: DASHBOARD_TOOLS,
      messages: messages,
    });

    return reply(200, {
      content: response.content,
      stop_reason: response.stop_reason,
      usage: response.usage,
    });
  } catch (err) {
    console.error('Claude API error:', err);
    return reply(502, { error: 'AI service error: ' + (err.message || 'unknown') });
  }
};
