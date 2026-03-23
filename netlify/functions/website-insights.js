/**
 * website-insights.js
 *
 * Daily AI-generated website performance insights.
 * Scheduled at 6:30am NZT. Also supports manual trigger via GET ?token=X&refresh=1
 *
 * Aggregates: analytics (7d vs prior 7d), per-page funnel, device breakdown,
 * ad campaigns, live page HTML content → Claude Sonnet 4 → stored in website_insights table.
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY,
 *           FB_ACCESS_TOKEN, FB_AD_ACCOUNT_ID,
 *           GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN
 */

const SITE_ID = 'PrimalPantry.co.nz';
const BASE_URL = 'https://primalpantry.co.nz';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function reply(code, data) {
  return { statusCode: code, headers: HEADERS, body: JSON.stringify(data) };
}

function sbFetch(path, opts = {}) {
  const headers = {
    'apikey': process.env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (opts.prefer) headers['Prefer'] = opts.prefer;
  return fetch(`${process.env.SUPABASE_URL}${path}`, {
    headers,
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

async function callRpc(name, params) {
  const res = await sbFetch(`/rest/v1/rpc/${name}`, { method: 'POST', body: params });
  const data = await res.json();
  if (!res.ok) { console.error(`RPC ${name} failed:`, data); return null; }
  return data;
}

async function getStaffByToken(token) {
  if (!token) return null;
  const res = await sbFetch(`/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id`);
  const rows = await res.json();
  return rows?.[0] || null;
}

function getNZDate(daysAgo = 0) {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

function toUTC(dateStr) {
  const nzMonth = new Date().getMonth();
  const nzOffset = (nzMonth >= 3 && nzMonth <= 8) ? '+12:00' : '+13:00';
  return new Date(dateStr + 'T00:00:00' + nzOffset).toISOString();
}

function toUTCEnd(dateStr) {
  const nzMonth = new Date().getMonth();
  const nzOffset = (nzMonth >= 3 && nzMonth <= 8) ? '+12:00' : '+13:00';
  const d = new Date(dateStr + 'T00:00:00' + nzOffset);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function pctChange(current, prior) {
  if (!prior || prior === 0) return current > 0 ? '+100%' : '0%';
  const pct = ((current - prior) / prior * 100).toFixed(1);
  return (pct >= 0 ? '+' : '') + pct + '%';
}

// ── HTML Extraction (from competitor-check.js pattern) ──

function stripTags(html) { return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' '); }

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

function extractMetaDescription(html) {
  const m = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*\/?>/i)
           || html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["'][^>]*\/?>/i);
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

function extractHeroText(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripTags(h1[1]).trim().replace(/\s+/g, ' ').slice(0, 500);
  const h2 = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  if (h2) return stripTags(h2[1]).trim().replace(/\s+/g, ' ').slice(0, 500);
  return '';
}

function extractVisibleText(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = stripTags(text).replace(/\s+/g, ' ').trim();
  return text.slice(0, 3000);
}

// ── Data Loaders ──

async function loadSummary(from, to) {
  return callRpc('analytics_summary', { p_site: SITE_ID, p_from: toUTC(from), p_to: toUTCEnd(to) });
}

async function loadPages(from, to) {
  return callRpc('analytics_grouped', { p_site: SITE_ID, p_from: toUTC(from), p_to: toUTCEnd(to), p_column: 'pathname' });
}

async function loadDevices(from, to) {
  return callRpc('analytics_grouped', { p_site: SITE_ID, p_from: toUTC(from), p_to: toUTCEnd(to), p_column: 'device_type' });
}

async function loadDeviceForPage(from, to, pathname) {
  return callRpc('analytics_grouped', {
    p_site: SITE_ID, p_from: toUTC(from), p_to: toUTCEnd(to), p_column: 'device_type',
    p_filters: [{ col: 'pathname', val: pathname }],
  });
}

async function loadFunnelStages(from, to) {
  return callRpc('analytics_funnel_stages', { p_site: SITE_ID, p_from: toUTC(from), p_to: toUTCEnd(to) });
}

async function loadFunnelByPage(from, to) {
  return callRpc('analytics_funnel_grouped', { p_site: SITE_ID, p_from: toUTC(from), p_to: toUTCEnd(to), p_column: 'pathname' });
}

async function loadEntryPages(from, to) {
  return callRpc('analytics_entry_pages', { p_site: SITE_ID, p_from: toUTC(from), p_to: toUTCEnd(to) });
}

async function loadExitPages(from, to) {
  return callRpc('analytics_exit_pages', { p_site: SITE_ID, p_from: toUTC(from), p_to: toUTCEnd(to) });
}

async function loadFBCampaigns(from, to) {
  const token = process.env.FB_ACCESS_TOKEN;
  const accountId = process.env.FB_AD_ACCOUNT_ID;
  if (!token || !accountId) return [];
  try {
    const fields = 'campaign_name,impressions,clicks,spend,actions,action_values,frequency';
    const url = `https://graph.facebook.com/v21.0/${accountId}/insights?fields=${fields}&level=campaign&time_range={"since":"${from}","until":"${to}"}&limit=100&access_token=${token}`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.data || []).map(c => ({
      name: c.campaign_name, platform: 'facebook',
      impressions: Number(c.impressions || 0), clicks: Number(c.clicks || 0),
      spend: Number(c.spend || 0), frequency: Number(c.frequency || 0),
      conversions: (c.actions || []).filter(a => a.action_type === 'purchase').reduce((s, a) => s + Number(a.value || 0), 0),
      conversions_value: (c.action_values || []).filter(a => a.action_type === 'purchase').reduce((s, a) => s + Number(a.value || 0), 0),
    }));
  } catch (e) { console.error('FB campaigns error:', e.message); return []; }
}

async function loadGoogleCampaigns(from, to) {
  try {
    const tokenRes = await sbFetch('/rest/v1/google_tokens?select=*&limit=1');
    const tokens = await tokenRes.json();
    if (!tokens?.[0]?.access_token || !tokens[0].ads_customer_id) return [];
    const t = tokens[0];
    // Refresh token
    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: t.refresh_token, grant_type: 'refresh_token' }),
    });
    const refreshData = await refreshRes.json();
    const accessToken = refreshData.access_token || t.access_token;
    const custId = t.ads_customer_id.replace(/-/g, '');
    const query = `SELECT campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status = 'ENABLED' ORDER BY metrics.cost_micros DESC`;
    const gRes = await fetch(`https://googleads.googleapis.com/v23/customers/${custId}/googleAds:searchStream`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN, 'Content-Type': 'application/json', 'login-customer-id': custId },
      body: JSON.stringify({ query }),
    });
    const gData = await gRes.json();
    const rows = (gData[0]?.results || gData.results || []);
    return rows.map(r => ({
      name: r.campaign?.name || '', platform: 'google',
      impressions: Number(r.metrics?.impressions || 0), clicks: Number(r.metrics?.clicks || 0),
      spend: Number(r.metrics?.costMicros || 0) / 1e6,
      conversions: Number(r.metrics?.conversions || 0),
      conversions_value: Number(r.metrics?.conversionsValue || 0),
    }));
  } catch (e) { console.error('Google campaigns error:', e.message); return []; }
}

async function loadFBAdCreatives() {
  const token = process.env.FB_ACCESS_TOKEN;
  const accountId = process.env.FB_AD_ACCOUNT_ID;
  if (!token || !accountId) return [];
  try {
    const fields = 'name,creative{title,body,link_url},campaign_name,status';
    const url = `https://graph.facebook.com/v21.0/${accountId}/ads?fields=${fields}&effective_status=["ACTIVE"]&limit=50&access_token=${token}`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.data || []).map(ad => ({
      name: ad.name, campaign: ad.campaign_name || '',
      headline: ad.creative?.title || '', body: ad.creative?.body || '',
      link_url: ad.creative?.link_url || '',
    }));
  } catch (e) { console.error('FB ad creatives error:', e.message); return []; }
}

async function fetchLivePage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PrimalPantryBot/1.0)', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return res.text();
  } catch { return null; }
}

// ── Main ──

async function generateInsight() {
  const today = getNZDate(0);
  const sevenAgo = getNZDate(7);
  const fourteenAgo = getNZDate(14);

  console.log('Loading analytics data...');

  // Parallel fetch: current vs prior period + campaigns
  const [
    curSummary, priorSummary,
    curPages, priorPages,
    curDevices, priorDevices,
    curFunnel, priorFunnel,
    curFunnelByPage,
    entryPages, exitPages,
    fbCampaigns, gCampaigns,
    fbAdCreatives,
  ] = await Promise.all([
    loadSummary(sevenAgo, today),
    loadSummary(fourteenAgo, sevenAgo),
    loadPages(sevenAgo, today),
    loadPages(fourteenAgo, sevenAgo),
    loadDevices(sevenAgo, today),
    loadDevices(fourteenAgo, sevenAgo),
    loadFunnelStages(sevenAgo, today),
    loadFunnelStages(fourteenAgo, sevenAgo),
    loadFunnelByPage(sevenAgo, today),
    loadEntryPages(sevenAgo, today),
    loadExitPages(sevenAgo, today),
    loadFBCampaigns(sevenAgo, today),
    loadGoogleCampaigns(sevenAgo, today),
    loadFBAdCreatives(),
  ]);

  // Top pages by traffic
  const topPages = (curPages || []).sort((a, b) => b.visitors - a.visitors).slice(0, 10);
  const topPagePaths = topPages.slice(0, 5).map(p => p.value);

  // Fetch live HTML + per-page device breakdown for top 5
  console.log('Fetching live pages and device data...');
  const livePageData = [];
  for (const pathname of topPagePaths) {
    const [html, deviceData] = await Promise.all([
      fetchLivePage(BASE_URL + pathname),
      loadDeviceForPage(sevenAgo, today, pathname),
    ]);
    livePageData.push({
      pathname,
      title: html ? extractTitle(html) : '',
      meta_description: html ? extractMetaDescription(html) : '',
      hero_text: html ? extractHeroText(html) : '',
      visible_text: html ? extractVisibleText(html) : '',
      device_breakdown: deviceData || [],
    });
  }

  // Ad ↔ page cross-reference
  const adPageMapping = (fbAdCreatives || []).map(ad => {
    let landingPath = '';
    try { landingPath = ad.link_url ? new URL(ad.link_url).pathname : ''; } catch {}
    return { ...ad, landing_pathname: landingPath };
  }).filter(a => a.landing_pathname);

  // Build page trend data
  const pagesTrend = topPages.map(p => {
    const prior = (priorPages || []).find(pp => pp.value === p.value);
    const funnel = (curFunnelByPage || []).find(f => f.value === p.value);
    return {
      pathname: p.value,
      visitors: p.visitors, pageviews: p.pageviews,
      bounce_rate: p.bounce_rate, avg_duration: p.avg_duration,
      visitors_change: prior ? pctChange(p.visitors, prior.visitors) : 'new page',
      bounce_change: prior ? (p.bounce_rate - prior.bounce_rate).toFixed(1) + 'pp' : null,
      funnel_atc: funnel?.atc_uniques || 0,
      funnel_sales: funnel?.sale_uniques || 0,
      atc_rate: p.visitors > 0 ? ((funnel?.atc_uniques || 0) / p.visitors * 100).toFixed(1) + '%' : '0%',
      conv_rate: p.visitors > 0 ? ((funnel?.sale_uniques || 0) / p.visitors * 100).toFixed(1) + '%' : '0%',
    };
  });

  const allCampaigns = [...fbCampaigns, ...gCampaigns];
  const totalSpend = allCampaigns.reduce((s, c) => s + c.spend, 0);

  // Build context bundle
  const context = {
    period: `${sevenAgo} to ${today} (vs ${fourteenAgo} to ${sevenAgo})`,
    summary: {
      current: curSummary,
      prior: priorSummary,
      changes: curSummary && priorSummary ? {
        visitors: pctChange(curSummary.unique_visitors, priorSummary.unique_visitors),
        pageviews: pctChange(curSummary.total_pageviews, priorSummary.total_pageviews),
        bounce_rate_change: ((curSummary.bounce_rate || 0) - (priorSummary.bounce_rate || 0)).toFixed(1) + 'pp',
        avg_duration_change: ((curSummary.avg_duration || 0) - (priorSummary.avg_duration || 0)).toFixed(0) + 's',
      } : null,
    },
    funnel: {
      current: curFunnel?.[0] || curFunnel || {},
      prior: priorFunnel?.[0] || priorFunnel || {},
    },
    devices: {
      current: curDevices || [],
      prior: priorDevices || [],
    },
    topPages: pagesTrend,
    entryPages: (entryPages || []).slice(0, 8),
    exitPages: (exitPages || []).slice(0, 8),
    livePages: livePageData,
    campaigns: allCampaigns.sort((a, b) => b.spend - a.spend).slice(0, 15).map(c => ({
      name: c.name, platform: c.platform, spend: '$' + c.spend.toFixed(2),
      clicks: c.clicks, impressions: c.impressions,
      conversions: c.conversions, revenue: '$' + c.conversions_value.toFixed(2),
      roas: c.spend > 0 ? (c.conversions_value / c.spend).toFixed(1) + 'x' : '-',
    })),
    totalAdSpend: '$' + totalSpend.toFixed(2),
    adCreatives: adPageMapping.slice(0, 10),
  };

  // Generate insight via Claude
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('No ANTHROPIC_API_KEY'); return null; }

  const systemPrompt = `You are the website performance analyst for Primal Pantry (primalpantry.co.nz), a New Zealand-based tallow skincare DTC brand. You analyze website analytics, live page content, and ad campaign data to find actionable improvements that increase revenue. Be direct, specific, and data-driven. Use NZD. Bold (**text**) key numbers and actions. Every recommendation must be something the owner can act on today.`;

  const userPrompt = `Generate a website performance insight for ${today}.

Data:
${JSON.stringify(context, null, 2)}

Structure your response exactly as these sections:

**🌐 Performance This Week**: Visitors, pageviews, bounce rate vs last week. Key trend. One-line verdict.

**📈 Traffic Changes**: Pages gaining or losing traffic week-over-week. Why (campaign? organic? seasonal?). Action for each.

**🛒 Conversion Opportunities**: Pages with high traffic but low conversion rate. Compare visitors → ATC → purchase. Which page to optimise first and why.

**📱 Device Issues**: Compare mobile vs desktop bounce rate and conversion for top pages. Flag any page where mobile bounces 10%+ more than desktop. Suggest specific mobile fixes.

**🎯 Ad ↔ Page Alignment**: For active ad campaigns, compare the ad copy/headline with the actual landing page hero text and content. Flag mismatches where the ad promises something the page doesn't deliver. Suggest specific copy or page changes.

**📝 Page Recommendations**: For the top 3 highest-opportunity pages, review the actual live page content (title, meta, hero, visible text) and suggest: headline clarity, CTA strength, trust signals, urgency, product positioning.

**✅ Top 3 Actions Today**: The 3 most impactful changes to make right now, ranked by expected revenue impact.

Keep each section to 2-4 sentences max. Name specific pages, campaigns, and numbers. Every recommendation must be actionable.`;

  try {
    console.log('Calling Claude API...');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2048, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    if (!text) { console.error('Empty Claude response'); return null; }

    // Store in website_insights (upsert by date)
    const existingRes = await sbFetch(`/rest/v1/website_insights?insight_date=eq.${today}&select=id`);
    const existing = await existingRes.json();
    if (existing && existing.length > 0) {
      await sbFetch(`/rest/v1/website_insights?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        body: { insight_text: text, context_snapshot: context, generated_at: new Date().toISOString() },
      });
    } else {
      await sbFetch('/rest/v1/website_insights', {
        method: 'POST',
        body: { insight_date: today, insight_text: text, context_snapshot: context, generated_at: new Date().toISOString() },
      });
    }

    console.log('Website insight stored successfully');
    return text;
  } catch (e) {
    console.error('Claude API error:', e.message);
    return null;
  }
}

// ── Handler ──

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};

  // Auth for manual triggers
  if (qs.token) {
    const staff = await getStaffByToken(qs.token);
    if (!staff) return reply(401, { error: 'Unauthorized' });
  }

  try {
    const insight = await generateInsight();
    return reply(200, { success: true, insight: insight || 'Generated (check Supabase)' });
  } catch (err) {
    console.error('Website insights error:', err);
    return reply(500, { error: err.message });
  }
};
