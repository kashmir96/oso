/**
 * action-engine.js
 *
 * Business rules engine for the Action Center.
 * Runs on schedule (daily 6am NZT) + manual trigger via GET ?token=X&refresh=1
 *
 * 1. Loads configurable thresholds from action_rule_config
 * 2. Fetches ad platform data, inventory data, orders, competitor changes, emails
 * 3. Evaluates each enabled rule → creates alerts in action_alerts
 * 4. Sends SMS for P1 alerts with sms_on_trigger
 * 5. Generates AI daily summary via Claude API
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, TWILIO_SID, TWILIO_API,
 *           TWILIO_FROM_NUMBER, ALERT_PHONE_NUMBERS, ANTHROPIC_API_KEY,
 *           FB_ACCESS_TOKEN, FB_AD_ACCOUNT_ID,
 *           GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN
 */

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

async function getStaffByToken(token) {
  if (!token) return null;
  const res = await sbFetch(`/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=id`);
  const rows = await res.json();
  return rows?.[0] || null;
}

async function sendSMS(message) {
  const SID = process.env.TWILIO_SID;
  const TOKEN = process.env.TWILIO_API;
  const FROM = process.env.TWILIO_FROM_NUMBER;
  const numbers = (process.env.ALERT_PHONE_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);
  if (!SID || !TOKEN || !FROM || !numbers.length) return [];
  const results = [];
  for (const TO of numbers) {
    try {
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
        method: 'POST',
        headers: { 'Authorization': 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: FROM, To: TO, Body: message }).toString(),
      });
      results.push({ to: TO, success: true });
    } catch (e) { results.push({ to: TO, error: e.message }); }
  }
  return results;
}

function getNZDate(daysAgo = 0) {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

// ── Data Fetchers ──

async function loadConfig() {
  const res = await sbFetch('/rest/v1/action_rule_config?select=config_key,value');
  const rows = await res.json();
  const config = {};
  (rows || []).forEach(r => { config[r.config_key] = Number(r.value); });
  return config;
}

async function loadRules() {
  const res = await sbFetch('/rest/v1/action_rules?enabled=eq.true&select=*');
  return (await res.json()) || [];
}

async function loadRecentAlerts() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const res = await sbFetch(`/rest/v1/action_alerts?created_at=gte.${since}&status=eq.new&select=rule_key,context`);
  return (await res.json()) || [];
}

async function loadOrders(days = 30) {
  const from = getNZDate(days);
  const res = await sbFetch(`/rest/v1/orders?order_date=gte.${from}&select=id,order_date,total_value,email,utm_source,utm_campaign,utm_content,status,created_at&order=order_date.desc`);
  return (await res.json()) || [];
}

async function loadLineItems() {
  const res = await sbFetch('/rest/v1/order_line_items?select=order_id,sku,description,quantity,unit_price');
  return (await res.json()) || [];
}

async function loadInventory() {
  const [rpRes, blRes, mfgRes] = await Promise.all([
    sbFetch('/rest/v1/inventory_reorder_points?select=*'),
    sbFetch('/rest/v1/inventory_baselines?select=*&order=counted_at.desc'),
    sbFetch('/rest/v1/manufacturing_batches?select=product_sku,quantity,created_at'),
  ]);
  return {
    reorderPoints: (await rpRes.json()) || [],
    baselines: (await blRes.json()) || [],
    batches: (await mfgRes.json()) || [],
  };
}

async function loadFBCampaigns(from, to) {
  try {
    const token = process.env.FB_ACCESS_TOKEN;
    const accountId = process.env.FB_AD_ACCOUNT_ID;
    if (!token || !accountId) return [];
    const fields = 'campaign_name,campaign_id,impressions,clicks,spend,actions,action_values,frequency';
    const url = `https://graph.facebook.com/v21.0/${accountId}/insights?fields=${fields}&time_range={"since":"${from}","until":"${to}"}&level=campaign&limit=200&access_token=${token}`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.data || []).map(c => ({
      name: c.campaign_name, id: c.campaign_id, platform: 'facebook',
      impressions: Number(c.impressions || 0), clicks: Number(c.clicks || 0),
      spend: Number(c.spend || 0), frequency: Number(c.frequency || 0),
      conversions: (c.actions || []).filter(a => a.action_type === 'purchase').reduce((s, a) => s + Number(a.value || 0), 0),
      conversions_value: (c.action_values || []).filter(a => a.action_type === 'purchase').reduce((s, a) => s + Number(a.value || 0), 0),
    }));
  } catch { return []; }
}

async function loadGoogleCampaigns(from, to) {
  try {
    const res = await sbFetch('/rest/v1/google_tokens?id=eq.1&select=access_token,refresh_token,expires_at,ads_customer_id');
    const rows = await res.json();
    if (!rows?.[0]?.access_token || !rows[0].ads_customer_id) return [];
    let token = rows[0];
    // Refresh if needed
    if (new Date(token.expires_at) < new Date(Date.now() + 60000)) {
      const tRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET }).toString(),
      });
      const td = await tRes.json();
      if (td.access_token) {
        token.access_token = td.access_token;
        await sbFetch('/rest/v1/google_tokens?id=eq.1', { method: 'PATCH', body: { access_token: td.access_token, expires_at: new Date(Date.now() + td.expires_in * 1000).toISOString() } });
      }
    }
    const query = `SELECT campaign.name, campaign.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}' AND campaign.status = 'ENABLED' ORDER BY metrics.cost_micros DESC`;
    const apiRes = await fetch(`https://googleads.googleapis.com/v23/customers/${token.ads_customer_id}/googleAds:searchStream`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${token.access_token}`, 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const apiData = await apiRes.json();
    if (!apiRes.ok) return [];
    const campaigns = {};
    for (const batch of (Array.isArray(apiData) ? apiData : [apiData])) {
      for (const row of (batch.results || [])) {
        const name = row.campaign?.name || '';
        if (!campaigns[name]) campaigns[name] = { name, id: row.campaign?.id, platform: 'google', impressions: 0, clicks: 0, spend: 0, conversions: 0, conversions_value: 0, frequency: 0 };
        campaigns[name].impressions += Number(row.metrics?.impressions || 0);
        campaigns[name].clicks += Number(row.metrics?.clicks || 0);
        campaigns[name].spend += (Number(row.metrics?.costMicros || 0)) / 1000000;
        campaigns[name].conversions += Number(row.metrics?.conversions || 0);
        campaigns[name].conversions_value += Number(row.metrics?.conversionsValue || 0);
      }
    }
    return Object.values(campaigns);
  } catch { return []; }
}

async function loadCompetitorChanges() {
  const since = getNZDate(7);
  const res = await sbFetch(`/rest/v1/competitor_changes?detected_at=gte.${since}T00:00:00Z&select=*&order=detected_at.desc&limit=20`);
  return (await res.json()) || [];
}

async function loadCustomerEmails() {
  const since = getNZDate(7);
  const res = await sbFetch(`/rest/v1/email_messages?date=gte.${since}T00:00:00Z&direction=eq.inbound&select=subject,snippet,customer_email,date&order=date.desc&limit=50`);
  return (await res.json()) || [];
}

// ── Rule Evaluators ──

function evaluateAdOps(campaigns, config, recentAlertKeys) {
  const alerts = [];
  const cpaTarget = config.cpa_target || 30;

  for (const c of campaigns) {
    if (c.spend < 1) continue;
    const cpa = c.conversions > 0 ? c.spend / c.conversions : Infinity;
    const ctr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
    const roas = c.spend > 0 ? c.conversions_value / c.spend : 0;
    const ctx = { campaign: c.name, platform: c.platform };

    // Kill: CPA too high
    const cpaKillThreshold = cpaTarget * (config.cpa_kill_multiplier || 2);
    if (cpa > cpaKillThreshold && c.conversions > 0) {
      alerts.push({ rule_key: 'adops_kill_cpa', title: `Kill: ${c.name} — CPA $${cpa.toFixed(2)}`, detail: `CPA $${cpa.toFixed(2)} exceeds $${cpaKillThreshold.toFixed(0)} threshold (${(config.cpa_kill_multiplier||2)}x target). Platform: ${c.platform}.`, context: { ...ctx, cpa, threshold: cpaKillThreshold } });
    }

    // Kill: Zero conversions with spend
    const zeroConvThreshold = cpaTarget * (config.zero_conv_spend_multiplier || 2);
    if (c.conversions === 0 && c.spend > zeroConvThreshold) {
      alerts.push({ rule_key: 'adops_kill_zero_conv', title: `Kill: ${c.name} — $${c.spend.toFixed(2)} spent, 0 conversions`, detail: `Spent $${c.spend.toFixed(2)} with zero conversions (threshold: $${zeroConvThreshold.toFixed(0)}). Platform: ${c.platform}.`, context: { ...ctx, spend: c.spend } });
    }

    // Kill: CTR too low
    if (ctr < (config.ctr_kill_floor || 0.5) && c.impressions > 500) {
      alerts.push({ rule_key: 'adops_kill_ctr', title: `Kill: ${c.name} — CTR ${ctr.toFixed(2)}%`, detail: `CTR ${ctr.toFixed(2)}% below ${config.ctr_kill_floor || 0.5}% floor. ${c.impressions.toLocaleString()} impressions. Platform: ${c.platform}.`, context: { ...ctx, ctr } });
    }

    // Kill: Frequency too high (FB only)
    if (c.frequency > (config.freq_kill_threshold || 4) && c.platform === 'facebook') {
      alerts.push({ rule_key: 'adops_kill_frequency', title: `Flag: ${c.name} — Frequency ${c.frequency.toFixed(1)}`, detail: `Frequency ${c.frequency.toFixed(1)} exceeds ${config.freq_kill_threshold || 4}. Audience fatigued.`, context: { ...ctx, frequency: c.frequency } });
    }

    // Scale: CPA efficient
    const cpaScaleThreshold = cpaTarget * ((config.cpa_scale_pct || 70) / 100);
    if (cpa < cpaScaleThreshold && cpa > 0 && c.conversions >= 3) {
      alerts.push({ rule_key: 'adops_scale_cpa', title: `Scale: ${c.name} — CPA $${cpa.toFixed(2)}`, detail: `CPA $${cpa.toFixed(2)} is below $${cpaScaleThreshold.toFixed(0)} (${config.cpa_scale_pct || 70}% of target). Consider increasing budget 20%.`, context: { ...ctx, cpa } });
    }

    // Scale: ROAS strong
    if (roas >= (config.roas_scale_threshold || 3) && c.spend > 10) {
      alerts.push({ rule_key: 'adops_scale_roas', title: `Scale: ${c.name} — ROAS ${roas.toFixed(1)}x`, detail: `ROAS ${roas.toFixed(1)}x exceeds ${config.roas_scale_threshold || 3}x threshold. Consider increasing budget 30%.`, context: { ...ctx, roas } });
    }

    // Creative: CTR low
    if (ctr < (config.ctr_creative_floor || 0.8) && ctr > 0 && c.impressions > 1000) {
      alerts.push({ rule_key: 'adops_creative_ctr', title: `New Creative: ${c.name} — CTR ${ctr.toFixed(2)}%`, detail: `CTR ${ctr.toFixed(2)}% below ${config.ctr_creative_floor || 0.8}% creative threshold. Test new hook or format.`, context: { ...ctx, ctr } });
    }

    // Creative: Frequency high (FB only)
    if (c.frequency > (config.freq_creative_threshold || 3.5) && c.platform === 'facebook') {
      alerts.push({ rule_key: 'adops_creative_freq', title: `New Creative: ${c.name} — Frequency ${c.frequency.toFixed(1)}`, detail: `Frequency ${c.frequency.toFixed(1)} exceeds creative threshold. Audience seeing ad too often.`, context: { ...ctx, frequency: c.frequency } });
    }
  }

  // Anomalies: compare totals to baseline (simplified — full implementation would use daily data)
  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  const totalConv = campaigns.reduce((s, c) => s + c.conversions, 0);
  const totalRev = campaigns.reduce((s, c) => s + c.conversions_value, 0);
  const totalCPA = totalConv > 0 ? totalSpend / totalConv : 0;
  const totalROAS = totalSpend > 0 ? totalRev / totalSpend : 0;
  // Note: baseline comparison requires historical data — these alerts will fire on absolute thresholds initially
  // Full baseline comparison will be added in Phase 2

  return alerts;
}

function evaluateInventory(inventoryData, orders, lineItems, config) {
  const alerts = [];
  const { reorderPoints, baselines, batches } = inventoryData;

  const rpMap = {};
  reorderPoints.forEach(r => { rpMap[r.sku] = r; });
  const blMap = {};
  baselines.forEach(r => { if (!blMap[r.sku]) blMap[r.sku] = r; });

  const orderMap = {};
  orders.forEach(o => { orderMap[o.id] = o; });

  // Calculate daily sales velocity per SKU (last 30 days)
  const skuSales30d = {};
  lineItems.forEach(li => {
    const order = orderMap[li.order_id];
    if (!order) return;
    skuSales30d[li.sku] = (skuSales30d[li.sku] || 0) + (li.quantity || 1);
  });

  for (const [sku, rp] of Object.entries(rpMap)) {
    const baseline = blMap[sku];
    const baselineQty = baseline ? baseline.quantity : 0;
    const baselineDate = baseline ? baseline.counted_at : '1970-01-01T00:00:00Z';

    const manufactured = batches.filter(b => b.product_sku === sku && b.created_at > baselineDate).reduce((s, b) => s + (b.quantity || 0), 0);
    const sold = lineItems.filter(li => {
      if (li.sku !== sku) return false;
      const order = orderMap[li.order_id];
      return order && (order.created_at || order.order_date) > baselineDate;
    }).reduce((s, li) => s + (li.quantity || 1), 0);

    const currentStock = baselineQty + manufactured - sold;
    const dailyVelocity = (skuSales30d[sku] || 0) / 30;
    const daysOfSupply = dailyVelocity > 0 ? currentStock / dailyVelocity : currentStock > 0 ? 999 : 0;

    const ctx = { sku, currentStock, daysOfSupply: Math.round(daysOfSupply), dailyVelocity: dailyVelocity.toFixed(1) };

    // Urgent
    if (daysOfSupply < (config.urgent_days_supply || 14) && dailyVelocity > 0) {
      alerts.push({ rule_key: 'inv_urgent', title: `URGENT: ${sku} — ${Math.round(daysOfSupply)} days supply`, detail: `Only ${currentStock} units left at ${dailyVelocity.toFixed(1)}/day velocity. Emergency reorder needed.`, context: ctx });
    }
    // Reorder
    else if (daysOfSupply < (config.reorder_days_supply || 45) && dailyVelocity > 0) {
      alerts.push({ rule_key: 'inv_reorder', title: `Reorder: ${sku} — ${Math.round(daysOfSupply)} days supply`, detail: `${currentStock} units at ${dailyVelocity.toFixed(1)}/day. Below ${config.reorder_days_supply || 45}-day threshold.`, context: ctx });
    }

    // Overstock tiers
    if (daysOfSupply > (config.overstock_clearance_days || 180)) {
      alerts.push({ rule_key: 'inv_overstock_clearance', title: `Clearance: ${sku} — ${Math.round(daysOfSupply)} days supply`, detail: `${currentStock} units, ${Math.round(daysOfSupply)} days at current velocity. Consider clearance pricing or discontinuing.`, context: ctx });
    } else if (daysOfSupply > (config.overstock_discount_days || 120)) {
      alerts.push({ rule_key: 'inv_overstock_discount', title: `Overstock: ${sku} — ${Math.round(daysOfSupply)} days`, detail: `Run targeted discount. Email buyers of complementary products.`, context: ctx });
    } else if (daysOfSupply > (config.overstock_bundle_days || 90)) {
      alerts.push({ rule_key: 'inv_overstock_bundle', title: `Bundle: ${sku} — ${Math.round(daysOfSupply)} days`, detail: `Add to bundle offers. Increase ad spend on this SKU.`, context: ctx });
    }

    // Zero sales
    if (dailyVelocity === 0 && currentStock > 0) {
      alerts.push({ rule_key: 'inv_zero_sales', title: `Zero Sales: ${sku}`, detail: `No sales in last 30 days. ${currentStock} units in stock. Investigate.`, context: ctx });
    }
  }

  return alerts;
}

// ── AI Summary ──

async function generateSummary(alerts, orders, campaigns, inventoryData, competitorChanges, customerEmails, lineItems) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const yesterday = getNZDate(1);
  const yesterdayOrders = orders.filter(o => o.order_date === yesterday);
  const yRevenue = yesterdayOrders.reduce((s, o) => s + Number(o.total_value || 0), 0);

  // Product analysis
  const productSales = {};
  const firstPurchaseProducts = {};
  const emailOrders = {};
  orders.forEach(o => { if (o.email) { if (!emailOrders[o.email]) emailOrders[o.email] = []; emailOrders[o.email].push(o); } });
  lineItems.forEach(li => {
    const order = orders.find(o => o.id === li.order_id);
    if (!order) return;
    const desc = li.description || li.sku || 'Unknown';
    if (!productSales[desc]) productSales[desc] = { revenue: 0, units: 0, orders: 0 };
    productSales[desc].revenue += (li.unit_price || 0) * (li.quantity || 1);
    productSales[desc].units += li.quantity || 1;
    productSales[desc].orders++;
    // Check if this is a first purchase for this customer
    if (order.email && emailOrders[order.email]) {
      const custOrders = emailOrders[order.email].sort((a, b) => a.order_date.localeCompare(b.order_date));
      if (custOrders[0]?.id === order.id) {
        firstPurchaseProducts[desc] = (firstPurchaseProducts[desc] || 0) + 1;
      }
    }
  });

  const topProducts = Object.entries(productSales).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 10);
  const topMagnets = Object.entries(firstPurchaseProducts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  const totalConv = campaigns.reduce((s, c) => s + c.conversions, 0);
  const totalRev = campaigns.reduce((s, c) => s + c.conversions_value, 0);

  // Creative performance ranking (by ROAS and CTR)
  const creativeRanking = campaigns
    .filter(c => c.spend > 5)
    .map(c => ({
      name: c.name, platform: c.platform,
      spend: c.spend.toFixed(2),
      roas: c.spend > 0 ? (c.conversions_value / c.spend).toFixed(1) : '0',
      ctr: c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : '0',
      cpa: c.conversions > 0 ? (c.spend / c.conversions).toFixed(2) : 'N/A',
      conversions: c.conversions,
    }))
    .sort((a, b) => Number(b.roas) - Number(a.roas));

  // Discount tracking: check if any orders used discount codes recently
  const discountOrders = orders.filter(o => o.discount_applied && Number(o.discount_applied) > 0);
  const discountRate = orders.length > 0 ? ((discountOrders.length / orders.length) * 100).toFixed(1) : '0';
  const discountRevenue = discountOrders.reduce((s, o) => s + Number(o.total_value || 0), 0);
  const nonDiscountRevenue = orders.filter(o => !o.discount_applied || Number(o.discount_applied) === 0).reduce((s, o) => s + Number(o.total_value || 0), 0);

  // Inventory status for batch sizing
  const invStatus = (inventoryData.reorderPoints || []).map(rp => {
    const bl = inventoryData.baselines.find(b => b.sku === rp.sku);
    const baseQty = bl ? bl.quantity : 0;
    const baseDate = bl ? bl.counted_at : '1970-01-01';
    const mfg = inventoryData.batches.filter(b => b.product_sku === rp.sku && b.created_at > baseDate).reduce((s, b) => s + (b.quantity || 0), 0);
    const soldQty = lineItems.filter(li => li.sku === rp.sku).length;
    const stock = baseQty + mfg - soldQty;
    const velocity = soldQty / 30;
    return { sku: rp.sku, stock, velocity: velocity.toFixed(1), daysSupply: velocity > 0 ? Math.round(stock / velocity) : 999, reorderPoint: rp.reorder_point };
  });

  // Seasonal context
  const month = new Date().getMonth();
  const seasonalNotes = [];
  if (month === 10) seasonalNotes.push('Black Friday / Cyber Monday approaching — plan stock and ad budgets');
  if (month === 11) seasonalNotes.push('Christmas gift season peak — ensure stock and shipping capacity');
  if (month === 0) seasonalNotes.push('New Year / summer skincare season in NZ');
  if (month === 3 || month === 4) seasonalNotes.push('Autumn transition — winter skincare messaging opportunity');
  if (month === 5) seasonalNotes.push('Winter skincare season starting — moisturiser and balm demand rises');

  const context = {
    date: yesterday,
    yesterday: { orders: yesterdayOrders.length, revenue: yRevenue.toFixed(2), aov: yesterdayOrders.length > 0 ? (yRevenue / yesterdayOrders.length).toFixed(2) : '0' },
    ads: {
      totalSpend: totalSpend.toFixed(2), totalConversions: totalConv,
      cpa: totalConv > 0 ? (totalSpend / totalConv).toFixed(2) : 'N/A',
      roas: totalSpend > 0 ? (totalRev / totalSpend).toFixed(1) : 'N/A',
      campaigns: campaigns.slice(0, 10).map(c => ({ name: c.name, platform: c.platform, spend: c.spend.toFixed(2), conversions: c.conversions, cpa: c.conversions > 0 ? (c.spend / c.conversions).toFixed(2) : 'N/A', roas: c.spend > 0 ? (c.conversions_value / c.spend).toFixed(1) : '0', ctr: c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : '0' })),
    },
    creativeRanking: creativeRanking.slice(0, 10),
    discounts: { discountedOrderPct: discountRate + '%', discountRevenue: discountRevenue.toFixed(2), fullPriceRevenue: nonDiscountRevenue.toFixed(2) },
    inventory: invStatus.filter(i => i.stock > 0 || i.velocity > 0),
    activeAlerts: { total: alerts.length, p1: alerts.filter(a => a.priority === 'P1').length, p2: alerts.filter(a => a.priority === 'P2').length, p3: alerts.filter(a => a.priority === 'P3').length, list: alerts.slice(0, 15).map(a => ({ title: a.title, priority: a.priority, category: a.category })) },
    topProducts: topProducts.map(([name, d]) => ({ name, revenue: d.revenue.toFixed(2), units: d.units })),
    topMagnets: topMagnets.map(([name, count]) => ({ name, firstPurchases: count })),
    competitorChanges: competitorChanges.slice(0, 10).map(c => ({ summary: c.summary, type: c.change_type })),
    customerEmails: customerEmails.slice(0, 10).map(e => ({ subject: e.subject, snippet: (e.snippet || '').slice(0, 100) })),
    seasonalNotes,
  };

  const dayOfWeek = new Date().getDay();
  const isMonday = dayOfWeek === 1;

  const systemPrompt = `You are the AI business analyst for Primal Pantry, a NZ-based tallow skincare DTC brand. You make direct, specific recommendations. Use NZD. No fluff. Bold key numbers and actions.`;

  const userPrompt = `Generate a ${isMonday ? 'weekly' : 'daily'} briefing for ${yesterday}.

Data:
${JSON.stringify(context, null, 2)}

Structure your response as:
${isMonday ? `**Weekly Summary**: Key wins, losses, and week-over-week trends.
**Focus This Week**: Top 3 priorities across ad ops, inventory, and product.
**Ad Ops**: Which campaigns to kill (CPA too high), scale (CPA/ROAS strong), or create new creatives for. Rank creatives by performance — tell me which to focus budget on.
**Product Intelligence**: Winners to focus ad spend on, best magnet products for acquisition, best upsells for cross-sell.
**Inventory & Batches**: Stock status per SKU, recommended batch sizes based on velocity, when to run sales for overstock.
**Discounts**: Is any active discount driving uplift? Should it be cancelled or extended?
**Competitor & Trends**: Notable competitor moves, seasonal opportunities, customer request themes from emails.
**Improvements**: One specific improvement for each area (ads, inventory, website, email).` :
`**Yesterday**: Revenue, orders, AOV, standout events.
**Ad Ops — Kill/Scale/Create**: Which campaigns to kill NOW (and why), which to increase budget on, which need new creatives. Rank top 3 creatives to focus spend on.
**Product Focus**: Winners to push harder, best magnet products for new customer acquisition, best upsell pairings.
**Inventory**: Any SKUs at risk? Recommended next batch sizes based on velocity. Flag if any SKU should go on sale.
**Discounts**: % of orders discounted, revenue comparison (discounted vs full-price). Recommend if discount should continue or end.
**Alerts**: Top actions from today's rule alerts.
**Intel**: Competitor changes, customer email themes, seasonal considerations.`}

Keep each section to 1-3 sentences. Be specific — name campaigns, SKUs, and numbers.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    if (!text) return null;

    // Store summary — upsert by date+type
    const summaryType = isMonday ? 'weekly' : 'daily';
    // Check if exists first
    const existingRes = await sbFetch(`/rest/v1/action_daily_summary?summary_date=eq.${yesterday}&summary_type=eq.${summaryType}&select=id`);
    const existing = await existingRes.json();
    if (existing && existing.length > 0) {
      await sbFetch(`/rest/v1/action_daily_summary?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        body: { summary_text: text, alert_snapshot: { total: alerts.length, p1: alerts.filter(a => a.priority === 'P1').length }, generated_at: new Date().toISOString() },
      });
    } else {
      await sbFetch('/rest/v1/action_daily_summary', {
        method: 'POST',
        body: { summary_date: yesterday, summary_type: summaryType, summary_text: text, alert_snapshot: { total: alerts.length, p1: alerts.filter(a => a.priority === 'P1').length }, generated_at: new Date().toISOString() },
      });
    }

    return text;
  } catch (e) {
    console.error('AI summary error:', e.message);
    return null;
  }
}

// ── Main Handler ──

exports.handler = async (event) => {
  const HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  const qs = event.queryStringParameters || {};

  // Auth for manual triggers
  if (qs.token) {
    const staff = await getStaffByToken(qs.token);
    if (!staff) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    console.log('Action engine starting...');

    // 1. Load config + rules + recent alerts for dedup
    const [config, rules, recentAlerts] = await Promise.all([loadConfig(), loadRules(), loadRecentAlerts()]);
    const recentKeys = new Set(recentAlerts.map(a => a.rule_key + '|' + JSON.stringify(a.context)));

    // 2. Fetch data sources
    const from14 = getNZDate(14);
    const today = getNZDate(0);
    const [fbCampaigns, gCampaigns, orders, lineItems, inventory, competitorChanges, customerEmails] = await Promise.all([
      loadFBCampaigns(from14, today),
      loadGoogleCampaigns(from14, today),
      loadOrders(30),
      loadLineItems(),
      loadInventory(),
      loadCompetitorChanges(),
      loadCustomerEmails(),
    ]);

    const allCampaigns = [...fbCampaigns, ...gCampaigns];
    console.log(`Loaded: ${allCampaigns.length} campaigns, ${orders.length} orders, ${inventory.reorderPoints.length} SKUs`);

    // 3. Run evaluators
    const ruleMap = {};
    rules.forEach(r => { ruleMap[r.rule_key] = r; });

    let newAlerts = [];
    // Ad Ops
    const adAlerts = evaluateAdOps(allCampaigns, config, recentKeys);
    newAlerts.push(...adAlerts);
    // Inventory
    const invAlerts = evaluateInventory(inventory, orders, lineItems, config);
    newAlerts.push(...invAlerts);

    // 4. Deduplicate: skip if identical rule_key+context exists as new in last 24h
    newAlerts = newAlerts.filter(a => {
      const key = a.rule_key + '|' + JSON.stringify(a.context || {});
      return !recentKeys.has(key);
    });

    // 5. Enrich with rule metadata
    newAlerts = newAlerts.map(a => {
      const rule = ruleMap[a.rule_key];
      return {
        rule_key: a.rule_key,
        category: rule?.category || 'unknown',
        priority: rule?.priority || 'P2',
        title: a.title,
        detail: a.detail,
        context: a.context || {},
        status: 'new',
        sms_sent: false,
      };
    }).filter(a => ruleMap[a.rule_key]); // Only insert for enabled rules

    // 6. Insert alerts
    if (newAlerts.length > 0) {
      await sbFetch('/rest/v1/action_alerts', {
        method: 'POST',
        body: newAlerts,
      });
    }
    console.log(`Created ${newAlerts.length} new alerts`);

    // 7. SMS for P1 alerts
    const smsAlerts = newAlerts.filter(a => {
      const rule = ruleMap[a.rule_key];
      return a.priority === 'P1' && rule?.sms_on_trigger;
    });
    let smsResults = [];
    if (smsAlerts.length > 0) {
      const msg = `Action Center: ${smsAlerts.length} urgent alert(s)\n${smsAlerts.map(a => '• ' + a.title).join('\n')}`;
      smsResults = await sendSMS(msg.slice(0, 1600));
    }

    // 8. AI Summary (on scheduled run or manual refresh with summary=1)
    let summary = null;
    if (!qs.token || qs.summary === '1') {
      // Combine existing + new alerts for context
      const allAlertsList = [...newAlerts.map(a => ({ ...a })), ...recentAlerts];
      summary = await generateSummary(allAlertsList, orders, allCampaigns, inventory, competitorChanges, customerEmails, lineItems);
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        alerts_created: newAlerts.length,
        sms_sent: smsResults.length,
        summary: summary || undefined,
      }),
    };
  } catch (err) {
    console.error('Action engine error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
