/**
 * analytics-dashboard.js
 *
 * Authenticated endpoint that returns aggregated analytics data.
 * Uses Supabase RPC functions for GROUP BY queries.
 *
 * GET ?token=X&site=SITE_ID&from=DATE&to=DATE&metric=METRIC[&col=COLUMN]
 *
 * Env vars required: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
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

async function callRpc(name, params) {
  const res = await sbFetch(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`RPC ${name} failed:`, data);
    throw new Error(`RPC ${name}: ${data.message || res.status}`);
  }
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'GET') return reply(405, { error: 'GET only' });

  const qs = event.queryStringParameters || {};
  const { token, site, from, to, metric, col, attr } = qs;

  // Parse filters: fc0/fv0, fc1/fv1, etc.
  const allowed_filter_cols = ['pathname','referrer_domain','browser','device_type','country','os','utm_campaign','utm_source','utm_medium','utm_content','utm_term','event_name','ft_source','ft_campaign','ft_medium','lt_source','lt_campaign','lt_medium'];
  const filters = [];
  for (let i = 0; i < 5; i++) {
    const fc = qs['fc' + i], fv = qs['fv' + i];
    if (fc && fv && allowed_filter_cols.includes(fc)) {
      filters.push({ col: fc, val: fv });
    }
  }

  // Auth
  const staff = await getStaffByToken(token);
  if (!staff) return reply(401, { error: 'Unauthorized' });

  // Sites list (no date range needed)
  if (metric === 'sites') {
    const data = await callRpc('analytics_sites', {});
    return reply(200, data);
  }

  if (!site || !from || !to || !metric) {
    return reply(400, { error: 'Missing params: site, from, to, metric' });
  }

  // Convert NZ dates to UTC — dynamically detect NZST (+12) vs NZDT (+13)
  const nzOffset = (() => {
    const now = new Date();
    const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const nz = new Date(now.toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
    const h = Math.round((nz - utc) / 3600000);
    return `${h >= 0 ? '+' : '-'}${String(Math.abs(h)).padStart(2, '0')}:00`;
  })();
  const p_from = new Date(from + 'T00:00:00' + nzOffset).toISOString();
  // Add 1 day to 'to' so it includes the full end date in NZ time
  const toDate = new Date(to + 'T00:00:00' + nzOffset);
  toDate.setDate(toDate.getDate() + 1);
  const p_to = toDate.toISOString();

  const baseParams = { p_site: site, p_from, p_to };
  // Add filters as JSON array if present
  if (filters.length > 0) {
    baseParams.p_filters = filters; // Supabase RPC will serialize as JSON
  }

  try {
    switch (metric) {
      case 'summary': {
        const data = await callRpc('analytics_summary', baseParams);
        return reply(200, data);
      }

      case 'timeseries': {
        // Use 'hour' for ranges <= 2 days, 'day' otherwise
        const diffMs = toDate - new Date(from);
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        const interval = diffDays <= 2 ? 'hour' : 'day';
        const data = await callRpc('analytics_timeseries', { ...baseParams, p_interval: interval });
        return reply(200, data);
      }

      case 'pages': {
        const data = await callRpc('analytics_grouped', { ...baseParams, p_column: 'pathname' });
        return reply(200, data);
      }

      case 'entry_pages': {
        const data = await callRpc('analytics_entry_pages', baseParams);
        return reply(200, data);
      }

      case 'exit_pages': {
        const data = await callRpc('analytics_exit_pages', baseParams);
        return reply(200, data);
      }

      case 'referrers': {
        const data = await callRpc('analytics_grouped', { ...baseParams, p_column: 'referrer_domain' });
        return reply(200, data);
      }

      case 'browsers': {
        const data = await callRpc('analytics_grouped', { ...baseParams, p_column: 'browser' });
        return reply(200, data);
      }

      case 'devices': {
        const data = await callRpc('analytics_grouped', { ...baseParams, p_column: 'device_type' });
        return reply(200, data);
      }

      case 'countries': {
        const data = await callRpc('analytics_grouped', { ...baseParams, p_column: 'country' });
        return reply(200, data);
      }

      case 'os': {
        const data = await callRpc('analytics_grouped', { ...baseParams, p_column: 'os' });
        return reply(200, data);
      }

      case 'events': {
        const data = await callRpc('analytics_events_summary', baseParams);
        return reply(200, data);
      }

      // UTM columns
      case 'campaigns': {
        let column = col || 'utm_campaign';
        const allowed = ['utm_campaign', 'utm_source', 'utm_medium', 'utm_content', 'utm_term'];
        if (!allowed.includes(column)) return reply(400, { error: 'Invalid column' });
        // Map to first/last touch columns when attribution model is set
        if (attr === 'first' || attr === 'last') {
          const prefix = attr === 'first' ? 'ft_' : 'lt_';
          const attrMap = { utm_source: prefix + 'source', utm_campaign: prefix + 'campaign', utm_medium: prefix + 'medium' };
          if (attrMap[column]) column = attrMap[column];
        }
        const data = await callRpc('analytics_grouped', { ...baseParams, p_column: column });
        return reply(200, data);
      }

      case 'funnel': {
        const column = col || 'pathname';
        const allowed = ['pathname', 'referrer_domain', 'browser', 'device_type', 'country', 'os', 'utm_campaign', 'utm_source', 'utm_medium', 'utm_content', 'utm_term'];
        if (!allowed.includes(column)) return reply(400, { error: 'Invalid column' });
        const data = await callRpc('analytics_funnel_grouped', { ...baseParams, p_column: column });
        return reply(200, data);
      }

      case 'conversions': {
        const thankYou = qs.thank_you || '/pages/thank-you/';
        // Don't pass p_filters — analytics_conversions doesn't support them
        const data = await callRpc('analytics_conversions', { p_site: site, p_from, p_to, p_thank_you: thankYou });
        return reply(200, data);
      }

      case 'funnel_stages': {
        const data = await callRpc('analytics_funnel_stages', baseParams);
        return reply(200, data);
      }

      default:
        return reply(400, { error: 'Unknown metric' });
    }
  } catch (err) {
    console.error('Dashboard error:', err.message);
    return reply(500, { error: err.message });
  }
};
