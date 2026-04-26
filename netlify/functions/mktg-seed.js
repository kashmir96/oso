/**
 * mktg-seed.js — one-time bulk loader for the marketing playbook.
 *
 * Reads the JSON files bundled at ./_mktg-seed/ and upserts them into the
 * mktg_* tables. Idempotent: re-running overwrites existing rows by primary
 * key (text id / ad_id / week_starting).
 *
 * POST { action: 'seed', confirm: 'YES' }       -> seeds everything
 * POST { action: 'seed', confirm: 'YES', only: ['campaigns','ads'] }
 *                                                -> seeds only the named tables
 * POST { action: 'status' }                     -> shows row counts per table
 *
 * Gated by withGate (Curtis only).
 */
const { sbFetch, sbSelect } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

// Exposed so mktg-data.js can lazy-auto-seed on first read without going
// through the gated handler. See `runSeed` export at the bottom.

// esbuild bundles these JSON files into the function output.
const META               = require('./_mktg-seed/meta.json');
const CAMPAIGNS          = require('./_mktg-seed/campaigns.json');
const PRODUCTS           = require('./_mktg-seed/products.json');
const TRUST_SIGNALS      = require('./_mktg-seed/trust_signals.json');
const SYMPTOMS           = require('./_mktg-seed/symptoms.json');
const COPY_ARCHETYPES    = require('./_mktg-seed/copy_archetypes.json');
const VISUAL_ARCHETYPES  = require('./_mktg-seed/visual_archetypes.json');
const VIDEO_OPENERS      = require('./_mktg-seed/video_openers.json');
const CONCEPTS           = require('./_mktg-seed/concepts.json');
const OFFERS             = require('./_mktg-seed/offers.json');
const PRODUCTION_SCRIPTS = require('./_mktg-seed/production_scripts.json');
const ADS                = require('./_mktg-seed/ads.json');
const HOOKS              = require('./_mktg-seed/hooks.json');
const WEEKLY_BATCHES     = require('./_mktg-seed/weekly_batches.json');

// PostgREST upsert via Prefer: resolution=merge-duplicates (needs the unique pk).
async function upsert(table, rows, pkCols = 'id') {
  if (!rows || rows.length === 0) return { inserted: 0 };
  const res = await sbFetch(`/rest/v1/${table}?on_conflict=${pkCols}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upsert ${table} failed: ${res.status} ${text}`);
  }
  const out = await res.json();
  return { inserted: Array.isArray(out) ? out.length : 0 };
}

// Synthesise an ad_id when the source row has none (preserves uniqueness).
function adKey(a) {
  if (a.ad_id) return a.ad_id;
  return `synth:${(a.ad_name || 'unnamed').toLowerCase().replace(/\s+/g, '-')}`;
}

const SEEDERS = {
  locked_decisions: async () => {
    const rows = (META.locked_decisions || []).map((d) => ({
      key: d.key,
      value: d.value,
      resolved_date: d.resolved_date,
      notes: d.notes || null,
    }));
    return upsert('mktg_locked_decisions', rows, 'key');
  },

  campaigns: async () => upsert('mktg_campaigns', CAMPAIGNS.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug || null,
    role_in_funnel: c.role_in_funnel || null,
    description: c.description || null,
    weekly_cadence: c.weekly_cadence || null,
    domain_default: c.domain_default || null,
  }))),

  products: async () => upsert('mktg_products', PRODUCTS.map((p) => ({
    id: p.id,
    campaign_id: p.campaign_id || null,
    name: p.name,
    full_name: p.full_name || null,
    tagline: p.tagline || null,
    description: p.description || null,
    price_from_nzd: p.price_from_nzd ?? null,
    variants: p.variants || [],
    ingredients: p.ingredients || [],
    size: p.size || null,
    format: p.format || null,
    status: p.status || 'active',
    url_slug: p.url_slug || null,
    notes: p.notes || null,
  }))),

  trust_signals: async () => upsert('mktg_trust_signals', TRUST_SIGNALS.map((t) => ({
    id: t.id,
    label: t.label,
    details: t.details || null,
    applies_to: t.applies_to || [],
  }))),

  symptoms: async () => upsert('mktg_symptoms', SYMPTOMS.map((s) => ({
    id: s.id,
    text: s.text,
    category: s.category,
    applies_to: s.applies_to || [],
  }))),

  copy_archetypes: async () => upsert('mktg_copy_archetypes', COPY_ARCHETYPES.map((a) => ({
    id: a.id,
    campaign_id: a.campaign_id || null,
    type_label: a.type_label || null,
    name: a.name,
    description: a.description || null,
    status: a.status || 'tested',
    example_body: a.example_body || null,
    structure: a.structure || null,
    pairs_with_visual_archetype_ids: a.pairs_with_visual_archetype_ids || [],
    pairs_with_video_opener_ids: a.pairs_with_video_opener_ids || [],
    notes: a.notes || null,
  }))),

  visual_archetypes: async () => upsert('mktg_visual_archetypes', VISUAL_ARCHETYPES.map((v) => ({
    id: v.id,
    name: v.name,
    description: v.description || null,
    used_by_ad_names: v.used_by_ad_names || [],
    pairs_with_copy_archetype_ids: v.pairs_with_copy_archetype_ids || [],
    vibe: v.vibe || null,
    notes: v.notes || null,
  }))),

  video_openers: async () => upsert('mktg_video_openers', VIDEO_OPENERS.map((v) => ({
    id: v.id,
    name: v.name,
    description: v.description || null,
    structure: v.structure || null,
    examples_by_campaign: v.examples_by_campaign || {},
    best_for: v.best_for || [],
    length_words_min: v.length_words_range?.[0] ?? null,
    length_words_max: v.length_words_range?.[1] ?? null,
    best_formats: v.best_formats || [],
  }))),

  concepts: async () => upsert('mktg_concepts', CONCEPTS.map((c) => ({
    id: c.id,
    campaign_id: c.campaign_id || null,
    name: c.name,
    copy_archetype_id: c.copy_archetype_id || null,
    visual_archetype_ids: c.visual_archetype_ids || [],
    video_opener_ids: c.video_opener_ids || [],
    status: c.status || 'new',
    performance: c.performance || null,
    ad_name_examples: c.ad_name_examples || [],
    notes: c.notes || null,
  }))),

  offers: async () => upsert('mktg_offers', OFFERS.map((o) => ({
    id: o.id,
    name: o.name,
    mechanic: o.mechanic || null,
    applies_to_campaigns: o.applies_to_campaigns || [],
    example_copy: o.example_copy || null,
    notes: o.notes || null,
  }))),

  production_scripts: async () => upsert('mktg_production_scripts', PRODUCTION_SCRIPTS.map((s) => ({
    id: s.id,
    campaign_id: s.campaign_id || null,
    name: s.name,
    concept_ids: s.concept_ids || [],
    video_opener_ids: s.video_opener_ids || [],
    length_words: s.length_words ?? null,
    status: s.status || 'draft',
    body: s.body || null,
    notes: s.notes || null,
  }))),

  ads: async () => upsert('mktg_ads', ADS.map((a) => ({
    ad_id: adKey(a),
    ad_name: a.ad_name,
    campaign_id: a.campaign_id || null,
    concept_id: a.concept_id || null,
    creative_type: a.creative_type || null,
    format: a.format || null,
    title: a.title || null,
    body: a.body || null,
    call_to_action: a.call_to_action || null,
    call_to_action_link: a.call_to_action_link || null,
    performance: a.performance || null,
  })), 'ad_id'),

  hooks: async () => upsert('mktg_hooks', HOOKS.map((h) => ({
    id: h.id,
    text: h.text,
    campaign_ids: h.campaign_ids || [],
    opener_style: h.opener_style || null,
    use: h.use || null,
  }))),

  weekly_batches: async () => upsert('mktg_weekly_batches', WEEKLY_BATCHES.map((w) => ({
    week_starting: w.week_starting,
    briefing: w.briefing || {},
    topical_layers: w.topical_layers || [],
    ad_slots: w.ad_slots || [],
    file_path: w.file_path || null,
  })), 'week_starting'),
};

// Order matters: parent rows before children that FK them.
const ORDER = [
  'locked_decisions',
  'campaigns',
  'products',
  'trust_signals',
  'symptoms',
  'visual_archetypes',
  'video_openers',
  'copy_archetypes',
  'concepts',
  'offers',
  'production_scripts',
  'ads',
  'hooks',
  'weekly_batches',
];

async function status() {
  const tables = [
    'mktg_locked_decisions','mktg_campaigns','mktg_products','mktg_trust_signals',
    'mktg_symptoms','mktg_copy_archetypes','mktg_visual_archetypes','mktg_video_openers',
    'mktg_concepts','mktg_offers','mktg_production_scripts','mktg_ads','mktg_hooks',
    'mktg_weekly_batches',
  ];
  const counts = {};
  for (const t of tables) {
    const rows = await sbSelect(t, 'select=*');
    counts[t] = Array.isArray(rows) ? rows.length : 0;
  }
  return { counts };
}

exports.handler = withGate(async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  try {
    if (action === 'status') return reply(200, await status());

    if (action === 'seed') {
      if (body.confirm !== 'YES') {
        return reply(400, { error: 'Pass {"confirm":"YES"} to actually seed.' });
      }
      const only = Array.isArray(body.only) && body.only.length > 0 ? body.only : ORDER;
      const results = {};
      for (const key of ORDER) {
        if (!only.includes(key)) continue;
        try {
          results[key] = await SEEDERS[key]();
        } catch (e) {
          results[key] = { error: e.message };
        }
      }
      return reply(200, { results, status: await status() });
    }

    return reply(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('[mktg-seed]', e);
    return reply(500, { error: e.message || 'Server error' });
  }
});

// Direct programmatic entry (no auth wrapper) for lazy auto-seed from
// mktg-data.js. Caller is responsible for ensuring this only fires from a
// trusted server-side path (it's not exposed via HTTP).
exports.runSeed = async function runSeed(only) {
  const keys = Array.isArray(only) && only.length > 0 ? only : ORDER;
  const results = {};
  for (const key of ORDER) {
    if (!keys.includes(key)) continue;
    try { results[key] = await SEEDERS[key](); }
    catch (e) { results[key] = { error: e.message }; }
  }
  return results;
};
