/**
 * mktg-data.js — read-only entity browser for /mktg.
 *
 * POST { action, ...params }
 *
 * Actions:
 *   list_campaigns                              -> [{ campaign + product_count + concept_count + ad_count }]
 *   get_campaign       { id }                   -> campaign + products + concepts + ads + scripts
 *   list_concepts      { campaign_id?, status? } -> concepts
 *   get_concept        { id }                   -> concept + linked archetypes + linked ads
 *   list_ads           { campaign_id?, concept_id?, sort? } -> ads (sortable by spend / cpr)
 *   get_ad             { ad_id }                -> ad
 *   list_scripts       { campaign_id? }         -> scripts
 *   get_script         { id }                   -> script
 *   list_archetypes    { kind: 'copy'|'visual'|'video' } -> archetypes
 *   list_offers
 *   list_hooks
 *   list_symptoms
 *   list_trust_signals
 *   list_locked_decisions
 *   list_weekly_batches
 *   summary                                     -> top-line counts + DB-empty signal
 */
const { sbSelect } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

function asArray(json) {
  return Array.isArray(json) ? json : [];
}

// Lazy auto-seed: if mktg_campaigns is empty on first read, run the bundled
// seed once. Avoids the "Load PrimalPantry playbook" button — the playbook
// is just there. Idempotent (seed itself uses upsert), and we only attempt
// once per cold-start, so the cost is zero on the hot path.
let _seedAttempted = false;
async function ensureSeeded() {
  if (_seedAttempted) return;
  _seedAttempted = true;
  try {
    const rows = await sbSelect('mktg_campaigns', 'select=id&limit=1');
    if (Array.isArray(rows) && rows.length > 0) return; // already seeded
    console.log('[mktg-data] mktg tables empty — running auto-seed from bundled JSON');
    const { runSeed } = require('./mktg-seed.js');
    const results = await runSeed();
    const totalInserted = Object.values(results)
      .reduce((s, r) => s + (r?.inserted || 0), 0);
    console.log(`[mktg-data] auto-seed inserted ${totalInserted} rows across ${Object.keys(results).length} tables`);
  } catch (e) {
    // Don't break reads if seeding errors out — the playbook is just empty
    // until the user applies the schema or manually re-seeds.
    console.warn('[mktg-data] auto-seed failed (continuing with empty playbook):', e.message);
  }
}

async function listCampaigns() {
  const [campaigns, products, concepts, ads] = await Promise.all([
    sbSelect('mktg_campaigns', 'select=*&order=name.asc'),
    sbSelect('mktg_products', 'select=campaign_id'),
    sbSelect('mktg_concepts', 'select=campaign_id,status'),
    sbSelect('mktg_ads', 'select=campaign_id,performance'),
  ]);
  return campaigns.map((c) => {
    const cAds = ads.filter((a) => a.campaign_id === c.id);
    return {
      ...c,
      product_count: products.filter((p) => p.campaign_id === c.id).length,
      concept_count: concepts.filter((x) => x.campaign_id === c.id).length,
      workhorse_count: concepts.filter((x) => x.campaign_id === c.id && x.status === 'workhorse').length,
      ad_count: cAds.length,
      total_spend_nzd: cAds.reduce((s, a) => s + (a.performance?.spend_nzd || 0), 0),
      total_results: cAds.reduce((s, a) => s + (a.performance?.results || 0), 0),
    };
  });
}

async function getCampaign(id) {
  if (!id) throw new Error('id required');
  const enc = encodeURIComponent(id);
  const [campaigns, products, concepts, ads, scripts, copyArch] = await Promise.all([
    sbSelect('mktg_campaigns', `id=eq.${enc}&select=*&limit=1`),
    sbSelect('mktg_products', `campaign_id=eq.${enc}&select=*&order=name.asc`),
    sbSelect('mktg_concepts', `campaign_id=eq.${enc}&select=*&order=status.asc,name.asc`),
    sbSelect('mktg_ads', `campaign_id=eq.${enc}&select=*&order=ad_name.asc`),
    sbSelect('mktg_production_scripts', `campaign_id=eq.${enc}&select=*&order=name.asc`),
    sbSelect('mktg_copy_archetypes', `campaign_id=eq.${enc}&select=*&order=type_label.asc`),
  ]);
  return {
    campaign: campaigns[0] || null,
    products,
    concepts,
    ads,
    scripts,
    copy_archetypes: copyArch,
  };
}

async function listConcepts({ campaign_id, status }) {
  const filters = ['select=*'];
  if (campaign_id) filters.push(`campaign_id=eq.${encodeURIComponent(campaign_id)}`);
  if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
  filters.push('order=status.asc,name.asc');
  return sbSelect('mktg_concepts', filters.join('&'));
}

async function getConcept(id) {
  if (!id) throw new Error('id required');
  const enc = encodeURIComponent(id);
  const concepts = await sbSelect('mktg_concepts', `id=eq.${enc}&select=*&limit=1`);
  const concept = concepts[0];
  if (!concept) return { concept: null };
  const [copyArch, visualArch, videoOpeners, ads] = await Promise.all([
    concept.copy_archetype_id
      ? sbSelect('mktg_copy_archetypes', `id=eq.${encodeURIComponent(concept.copy_archetype_id)}&select=*&limit=1`)
      : Promise.resolve([]),
    concept.visual_archetype_ids?.length
      ? sbSelect('mktg_visual_archetypes',
          `id=in.(${concept.visual_archetype_ids.map(encodeURIComponent).join(',')})&select=*`)
      : Promise.resolve([]),
    concept.video_opener_ids?.length
      ? sbSelect('mktg_video_openers',
          `id=in.(${concept.video_opener_ids.map(encodeURIComponent).join(',')})&select=*`)
      : Promise.resolve([]),
    sbSelect('mktg_ads', `concept_id=eq.${enc}&select=*&order=ad_name.asc`),
  ]);
  return {
    concept,
    copy_archetype: copyArch[0] || null,
    visual_archetypes: visualArch,
    video_openers: videoOpeners,
    ads,
  };
}

async function listAds({ campaign_id, concept_id, sort }) {
  const filters = ['select=*'];
  if (campaign_id) filters.push(`campaign_id=eq.${encodeURIComponent(campaign_id)}`);
  if (concept_id) filters.push(`concept_id=eq.${encodeURIComponent(concept_id)}`);
  filters.push('limit=500');
  const ads = await sbSelect('mktg_ads', filters.join('&'));

  if (sort === 'spend') {
    ads.sort((a, b) => (b.performance?.spend_nzd || 0) - (a.performance?.spend_nzd || 0));
  } else if (sort === 'cpr') {
    ads.sort((a, b) => {
      const ca = a.performance?.cpr_nzd ?? Infinity;
      const cb = b.performance?.cpr_nzd ?? Infinity;
      return ca - cb;
    });
  } else if (sort === 'results') {
    ads.sort((a, b) => (b.performance?.results || 0) - (a.performance?.results || 0));
  } else {
    ads.sort((a, b) => (a.ad_name || '').localeCompare(b.ad_name || ''));
  }
  return ads;
}

async function getAd(ad_id) {
  if (!ad_id) throw new Error('ad_id required');
  const rows = await sbSelect('mktg_ads', `ad_id=eq.${encodeURIComponent(ad_id)}&select=*&limit=1`);
  return { ad: rows[0] || null };
}

async function listScripts({ campaign_id }) {
  const filters = ['select=*'];
  if (campaign_id) filters.push(`campaign_id=eq.${encodeURIComponent(campaign_id)}`);
  filters.push('order=name.asc');
  return sbSelect('mktg_production_scripts', filters.join('&'));
}

async function getScript(id) {
  if (!id) throw new Error('id required');
  const rows = await sbSelect('mktg_production_scripts', `id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  return { script: rows[0] || null };
}

async function listArchetypes({ kind }) {
  if (kind === 'visual') return sbSelect('mktg_visual_archetypes', 'select=*&order=id.asc');
  if (kind === 'video') return sbSelect('mktg_video_openers', 'select=*&order=id.asc');
  return sbSelect('mktg_copy_archetypes', 'select=*&order=campaign_id.asc,type_label.asc');
}

async function summary() {
  const tables = [
    'mktg_campaigns', 'mktg_products', 'mktg_concepts', 'mktg_copy_archetypes',
    'mktg_visual_archetypes', 'mktg_video_openers', 'mktg_production_scripts',
    'mktg_ads', 'mktg_hooks', 'mktg_offers', 'mktg_symptoms', 'mktg_trust_signals',
    'mktg_locked_decisions', 'mktg_weekly_batches',
  ];
  const counts = {};
  for (const t of tables) {
    const rows = await sbSelect(t, 'select=*&limit=1');
    counts[t] = asArray(rows).length;
  }
  // Real counts via head=true is fiddly via sbFetch; do a cheap fetch with no limit cap by relying on PostgREST count header would be cleaner but this is fine for a summary screen.
  // For accuracy, do per-table count:
  const accurate = {};
  for (const t of tables) {
    const rows = await sbSelect(t, 'select=*');
    accurate[t] = asArray(rows).length;
  }
  return { counts: accurate, db_empty: Object.values(accurate).every((n) => n === 0) };
}

exports.handler = withGate(async (event) => {
  // Fire-and-await: cheap when already seeded (one SELECT + early return).
  await ensureSeeded();
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;
  try {
    switch (action) {
      case 'list_campaigns':       return reply(200, { campaigns: await listCampaigns() });
      case 'get_campaign':         return reply(200, await getCampaign(body.id));
      case 'list_concepts':        return reply(200, { concepts: await listConcepts(body) });
      case 'get_concept':          return reply(200, await getConcept(body.id));
      case 'list_ads':             return reply(200, { ads: await listAds(body) });
      case 'get_ad':               return reply(200, await getAd(body.ad_id));
      case 'list_scripts':         return reply(200, { scripts: await listScripts(body) });
      case 'get_script':           return reply(200, await getScript(body.id));
      case 'list_archetypes':      return reply(200, { archetypes: await listArchetypes(body) });
      case 'list_offers':          return reply(200, { offers: await sbSelect('mktg_offers', 'select=*&order=name.asc') });
      case 'list_hooks':           return reply(200, { hooks: await sbSelect('mktg_hooks', 'select=*&order=use.asc,id.asc') });
      case 'list_symptoms':        return reply(200, { symptoms: await sbSelect('mktg_symptoms', 'select=*&order=category.asc,text.asc') });
      case 'list_trust_signals':   return reply(200, { trust_signals: await sbSelect('mktg_trust_signals', 'select=*&order=label.asc') });
      case 'list_locked_decisions': return reply(200, { locked_decisions: await sbSelect('mktg_locked_decisions', 'select=*&order=key.asc') });
      case 'list_weekly_batches':  return reply(200, { weekly_batches: await sbSelect('mktg_weekly_batches', 'select=*&order=week_starting.desc') });
      case 'summary':              return reply(200, await summary());
      default:                     return reply(400, { error: 'Unknown action' });
    }
  } catch (e) {
    console.error('[mktg-data]', e);
    return reply(500, { error: e.message || 'Server error' });
  }
});
