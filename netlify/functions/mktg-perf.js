/**
 * mktg-perf.js — sync ad-level Meta performance into mktg_ads.
 *
 * Pulls /act_{ACCOUNT}/insights?level=ad for a date window, normalises the
 * payload to our AdPerformance shape, and upserts onto rows in mktg_ads
 * matched by ad_id. Seed data stores ids as "a:120243…" (legacy Meta export
 * convention); the Meta API returns the bare numeric id, so we match both.
 *
 * POST { action: 'sync', from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 *   -> { matched, unmatched, updated, sample_unmatched }
 *
 * POST { action: 'preview', from, to }
 *   -> raw normalised rows from Meta (no DB writes) for inspection
 *
 * POST { action: 'last_synced' } -> { last_synced_at, count }
 *
 * Env: FB_AD_ACCOUNT_ID, FB_ACCESS_TOKEN
 */
const { sbSelect, sbFetch } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

function num(v) { return v == null ? null : Number(v); }

function parsePurchases(actions = [], actionValues = []) {
  let results = 0;
  let value = 0;
  for (const a of actions) {
    if (a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase') {
      results += Number(a.value || 0);
    }
  }
  for (const a of actionValues) {
    if (a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase') {
      value += Number(a.value || 0);
    }
  }
  return { results, value };
}

async function fetchAdLevelInsights(from, to) {
  const accountId = process.env.FB_AD_ACCOUNT_ID;
  const accessToken = process.env.FB_ACCESS_TOKEN;
  if (!accountId || !accessToken) throw new Error('FB_AD_ACCOUNT_ID / FB_ACCESS_TOKEN not set');

  const timeRange = JSON.stringify({ since: from, until: to });
  const fields = [
    'ad_id', 'ad_name', 'impressions', 'reach', 'frequency',
    'spend', 'clicks', 'inline_link_clicks',
    'actions', 'action_values',
    'ctr', 'cpc', 'cost_per_inline_link_click',
  ].join(',');

  let url = `https://graph.facebook.com/v21.0/act_${accountId}/insights?level=ad&time_range=${encodeURIComponent(timeRange)}&fields=${fields}&limit=500&access_token=${accessToken}`;

  const all = [];
  let pages = 0;
  while (url && pages < 20) {
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) throw new Error(`FB API: ${json.error.message}`);
    if (json.data) all.push(...json.data);
    url = json.paging?.next || null;
    pages++;
  }
  return all;
}

function normalise(row, from, to) {
  const { results, value } = parsePurchases(row.actions, row.action_values);
  const linkClicks = num(row.inline_link_clicks);
  const impressions = num(row.impressions);
  const ctrLink = linkClicks != null && impressions ? (linkClicks / impressions) * 100 : null;
  const cpcLink = num(row.cost_per_inline_link_click);
  return {
    raw_ad_id: row.ad_id,
    ad_name: row.ad_name,
    performance: {
      reporting_start: from,
      reporting_end: to,
      spend_nzd: num(row.spend),
      results,
      results_value_nzd: value || null,
      cpr_nzd: results > 0 && row.spend ? Number(row.spend) / results : null,
      reach: num(row.reach),
      frequency: num(row.frequency),
      impressions,
      link_clicks: linkClicks,
      ctr_link_pct: ctrLink,
      cpc_link_nzd: cpcLink,
    },
  };
}

// Build a lookup: both 'a:123' and bare '123' point to the row's PK string.
async function loadAdIndex() {
  const rows = await sbSelect('mktg_ads', 'select=ad_id');
  const index = new Map();
  for (const r of rows) {
    if (!r.ad_id) continue;
    index.set(r.ad_id, r.ad_id);
    if (r.ad_id.startsWith('a:')) index.set(r.ad_id.slice(2), r.ad_id);
    else index.set(`a:${r.ad_id}`, r.ad_id);
  }
  return index;
}

async function patchAd(ad_id, performance) {
  const res = await sbFetch(`/rest/v1/mktg_ads?ad_id=eq.${encodeURIComponent(ad_id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ performance, perf_synced_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Patch ${ad_id} failed: ${res.status} ${await res.text()}`);
  return true;
}

async function sync(from, to, { dryRun = false } = {}) {
  if (!from || !to) throw new Error('from and to (YYYY-MM-DD) required');
  const [insights, index] = await Promise.all([
    fetchAdLevelInsights(from, to),
    loadAdIndex(),
  ]);

  let matched = 0;
  let updated = 0;
  const unmatched = [];

  for (const row of insights) {
    const norm = normalise(row, from, to);
    const pk = index.get(row.ad_id) || index.get(`a:${row.ad_id}`);
    if (!pk) {
      unmatched.push({ ad_id: row.ad_id, ad_name: row.ad_name });
      continue;
    }
    matched++;
    if (!dryRun) {
      await patchAd(pk, norm.performance);
      updated++;
    }
  }

  return {
    fetched: insights.length,
    matched,
    updated,
    unmatched_count: unmatched.length,
    sample_unmatched: unmatched.slice(0, 10),
    dry_run: dryRun,
  };
}

async function preview(from, to) {
  const insights = await fetchAdLevelInsights(from, to);
  return { rows: insights.map((r) => normalise(r, from, to)) };
}

async function lastSynced() {
  const rows = await sbSelect(
    'mktg_ads',
    'select=ad_id,perf_synced_at&perf_synced_at=not.is.null&order=perf_synced_at.desc&limit=1'
  );
  const all = await sbSelect('mktg_ads', 'select=ad_id&perf_synced_at=not.is.null');
  return {
    last_synced_at: rows[0]?.perf_synced_at || null,
    count: all.length,
  };
}

exports.handler = withGate(async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;
  try {
    if (action === 'sync')        return reply(200, await sync(body.from, body.to, { dryRun: !!body.dry_run }));
    if (action === 'preview')     return reply(200, await preview(body.from, body.to));
    if (action === 'last_synced') return reply(200, await lastSynced());
    return reply(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('[mktg-perf]', e);
    return reply(500, { error: e.message || 'Server error' });
  }
});
