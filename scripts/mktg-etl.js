#!/usr/bin/env node
/**
 * mktg-etl.js — one-time CSV ETL into the canonical creative-agent tables.
 *
 * Reads CSVs from the marketing-playbook folder (next to this repo), parses
 * them, and inserts into the new mktg_creatives / mktg_reviews / etc tables.
 * Idempotent via source_row_hash — re-runs are safe and skip existing rows.
 *
 * Run from repo root:
 *
 *   node scripts/mktg-etl.js <csv> [...flags]
 *
 * CSV slugs:
 *   adsmanager       — ads with Meta performance (high-signal corpus)
 *   other-ads        — UTF-16 ads export with copy only (no perf)
 *   ads-export-2     — UTF-16 mega-export (10K rows; campaign tree)
 *   scripts          — video script library
 *   reviews          — Trustpilot reviews
 *   pain-points      — pain point reference table
 *   social-proof     — quotable proofs (press, reviews, endorsements, awards)
 *   primary-text     — historical primary-text bank
 *   script-types     — playbook structure_template patterns
 *   all              — runs every CSV in dependency order
 *
 * Flags:
 *   --playbook-dir=PATH        Override CSV folder (default: ../marketing-playbook/Marketing\ Agent)
 *   --retail-era-from=YYYY-MM-DD
 *   --retail-era-to=YYYY-MM-DD Mark creatives whose campaign date falls in this
 *                              range as generalizable=false (per the spec, the
 *                              retail era used different unit economics; its
 *                              patterns won't transfer).
 *   --limit=N                  Cap rows processed per CSV (debugging).
 *   --dry-run                  Parse + report counts but write nothing.
 *
 * Env required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *
 * Embeddings + verbatim phrase extraction are NOT done here. The columns
 * exist; backfill jobs (separate, in Block 2.1+) populate them. ETL stays
 * cheap and resumable — no API calls required to land the data.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse } = require('csv-parse/sync');

const REPO_ROOT = path.resolve(__dirname, '..');
process.chdir(REPO_ROOT);

const { sbSelect, sbInsert } = require(path.join(REPO_ROOT, 'netlify/functions/_lib/ckf-sb.js'));

// ─── CLI parsing ────────────────────────────────────────────────────────────
function parseFlags(argv) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v === undefined ? true : v;
    } else {
      out._.push(a);
    }
  }
  return out;
}

const flags = parseFlags(process.argv.slice(2));
const target = flags._[0];
if (!target) {
  console.error('Usage: node scripts/mktg-etl.js <csv> [...flags]\nSee header for CSV slugs.');
  process.exit(1);
}

// Try a few likely locations for the playbook folder. The repo lives under
// "Websites - Claude/oso" and the playbook under "Websites - Claude/marketing-playbook",
// so we walk up parents looking for a sibling marketing-playbook folder. If
// the repo is checked out as a worktree (e.g. .claude/worktrees/foo) we may
// need to walk up several levels.
function resolvePlaybookDir() {
  if (flags['playbook-dir']) return flags['playbook-dir'];
  let dir = REPO_ROOT;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'marketing-playbook', 'Marketing Agent');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(REPO_ROOT, '..', 'marketing-playbook', 'Marketing Agent'); // fallback for error message
}
const PLAYBOOK_DIR = resolvePlaybookDir();
const RETAIL_FROM = flags['retail-era-from'] ? new Date(flags['retail-era-from']) : null;
const RETAIL_TO   = flags['retail-era-to']   ? new Date(flags['retail-era-to'])   : null;
const LIMIT       = flags.limit ? parseInt(flags.limit, 10) : null;
const DRY_RUN     = !!flags['dry-run'];

if (RETAIL_FROM && RETAIL_TO && RETAIL_FROM > RETAIL_TO) {
  console.error('--retail-era-from must be ≤ --retail-era-to');
  process.exit(1);
}

// ─── CSV reader ─────────────────────────────────────────────────────────────
// Some exports (Meta's "ads export 2.csv", "other ads export.csv") are
// UTF-16 LE with BOM and tab-delimited. Detect both transparently.
function readCsv(absPath) {
  const buf = fs.readFileSync(absPath);
  let text;
  let delimiter = ',';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    // UTF-16 LE BOM. Strip BOM, decode.
    text = buf.slice(2).toString('utf16le');
    delimiter = '\t';
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    text = buf.slice(2).toString('utf16le'); // Best effort
    delimiter = '\t';
  } else {
    text = buf.toString('utf8');
    // Sniff: if first line has more tabs than commas, switch.
    const first = text.split(/\r?\n/, 1)[0] || '';
    if ((first.match(/\t/g) || []).length > (first.match(/,/g) || []).length) {
      delimiter = '\t';
    }
  }
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    bom: true,
    delimiter,
    trim: true,
  });
}

function rowHash(csvSlug, ...parts) {
  return crypto.createHash('sha256')
    .update(csvSlug + '|' + parts.map((p) => String(p ?? '')).join('|'))
    .digest('hex')
    .slice(0, 32);
}

function isInRetailEra(dateStr) {
  if (!RETAIL_FROM || !RETAIL_TO || !dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  return d >= RETAIL_FROM && d <= RETAIL_TO;
}

// ─── Idempotent insert ──────────────────────────────────────────────────────
// PostgREST sbInsert doesn't expose ON CONFLICT cleanly, but our schema
// uses a UNIQUE constraint on source_row_hash. So:
// - check if hash exists; if yes, skip
// - else insert
// Cheap enough for one-time ETL. Not optimal for large tables, but fine.
const seenHashes = new Map(); // table -> Set<hash>
async function loadSeenHashes(table) {
  if (DRY_RUN) return new Set();
  if (seenHashes.has(table)) return seenHashes.get(table);
  const set = new Set();
  let offset = 0;
  while (true) {
    const rows = await sbSelect(table, `select=source_row_hash&source_row_hash=not.is.null&limit=1000&offset=${offset}`);
    for (const r of rows) if (r.source_row_hash) set.add(r.source_row_hash);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  seenHashes.set(table, set);
  return set;
}

async function insertRows(table, rows) {
  if (DRY_RUN) {
    return { inserted: rows.length, skipped: 0, dry_run: true };
  }
  const seen = await loadSeenHashes(table);
  let inserted = 0;
  let skipped = 0;
  // Batch in chunks of 100 — PostgREST handles arrays as bulk.
  const fresh = rows.filter((r) => {
    if (r.source_row_hash && seen.has(r.source_row_hash)) { skipped++; return false; }
    return true;
  });
  for (let i = 0; i < fresh.length; i += 100) {
    const chunk = fresh.slice(i, i + 100);
    try {
      await sbInsert(table, chunk);
      inserted += chunk.length;
      for (const r of chunk) if (r.source_row_hash) seen.add(r.source_row_hash);
    } catch (e) {
      // PostgREST returns "23505" on dup-key — surface as skip not failure.
      if (String(e.message || e).includes('23505') || String(e.message || e).includes('duplicate key')) {
        skipped += chunk.length;
      } else {
        console.error(`[insertRows ${table}]`, e.message || e);
        throw e;
      }
    }
  }
  return { inserted, skipped };
}

// ─── ETL: adsmanager.csv ────────────────────────────────────────────────────
async function etlAdsmanager() {
  const file = path.join(PLAYBOOK_DIR, 'adsmanager.csv');
  const rows = readCsv(file);
  const limited = LIMIT ? rows.slice(0, LIMIT) : rows;
  console.log(`adsmanager.csv: ${rows.length} rows`);

  const out = limited.map((r, i) => {
    const adName = r['Ad name'] || r['ad_name'] || `ad-${i}`;
    const startDate = r['Reporting starts'];
    const generalizable = !isInRetailEra(startDate);
    const performance = {
      ad_metrics: {
        impressions: numOrNull(r['Impressions']),
        clicks:      numOrNull(r['Link clicks']),
        ctr:         numOrNull(r['CTR (link click-through rate)']),
        conversions: numOrNull(r['Results']),
        spend:       numOrNull(r['Amount spent (NZD)']),
        primary_kpi_value: numOrNull(r['Results']),
      },
      reach:     numOrNull(r['Reach']),
      frequency: numOrNull(r['Frequency']),
      cost_per_result: numOrNull(r['Cost per results']),
      reporting_window: { start: startDate, end: r['Reporting ends'] },
    };
    const hasPerf = performance.ad_metrics.impressions != null || performance.ad_metrics.spend != null;
    const status = hasPerf ? 'performed' : 'drafted';
    return {
      creative_type: 'ad',
      brief: { objective: 'historical', audience: 'historical', platform: 'meta', format: 'unknown', constraints: [] },
      components: { headline: adName },
      pattern_tags: [],
      status,
      performance: hasPerf ? performance : null,
      shipped_at: hasPerf ? safeDate(startDate) : null,
      performed_at: hasPerf ? safeDate(r['Reporting ends']) : null,
      generalizable,
      generalization_caveat: generalizable ? null : 'Retail-era creative — different unit economics + audience funnel.',
      source_csv: 'adsmanager.csv',
      source_row_hash: rowHash('adsmanager', adName, startDate),
    };
  });
  const res = await insertRows('mktg_creatives', out);
  console.log(`  -> mktg_creatives: +${res.inserted} inserted, ${res.skipped} skipped`);
}

// ─── ETL: other-ads (UTF-16 ad copy export, no perf) ────────────────────────
async function etlOtherAds() {
  const file = path.join(PLAYBOOK_DIR, 'other ads export.csv');
  const rows = readCsv(file);
  const limited = LIMIT ? rows.slice(0, LIMIT) : rows;
  console.log(`other ads export.csv: ${rows.length} rows`);

  const out = limited.map((r, i) => {
    const adName = r['Ad Name'] || r['Title'] || `other-${i}`;
    const adId = r['Ad ID'] || `synth-${i}`;
    const body = r['Body'] || r['Marketing Message Primary Text'] || null;
    return {
      creative_type: 'ad',
      brief: { objective: 'historical', audience: 'historical', platform: 'meta', format: 'unknown', constraints: [] },
      components: {
        headline: r['Title'] || adName,
        body,
        cta: r['Call to Action'] || null,
        cta_link: r['Call to Action Link'] || null,
      },
      pattern_tags: [],
      status: 'drafted',
      generalizable: true,
      source_csv: 'other-ads',
      source_row_hash: rowHash('other-ads', adId, adName),
    };
  });
  const res = await insertRows('mktg_creatives', out);
  console.log(`  -> mktg_creatives: +${res.inserted} inserted, ${res.skipped} skipped`);
}

// ─── ETL: ads export 2 (huge UTF-16 campaign tree) ──────────────────────────
async function etlAdsExport2() {
  const file = path.join(PLAYBOOK_DIR, 'ads export 2.csv');
  const rows = readCsv(file);
  const limited = LIMIT ? rows.slice(0, LIMIT) : rows;
  console.log(`ads export 2.csv: ${rows.length} rows (campaign-tree mega-export)`);

  // The headers in this file describe campaign-level rows, not creative
  // bodies. Treat each row as a creative shell with the ad name + campaign
  // metadata. Anything missing falls through.
  const out = limited.map((r, i) => {
    const adName = r['Ad Name'] || r['Title'] || r['Campaign Name'] || `ae2-${i}`;
    const startTime = r['Campaign Start Time'] || r['Ad Set Start Time'];
    const generalizable = !isInRetailEra(startTime);
    return {
      creative_type: 'ad',
      brief: { objective: 'historical', audience: 'historical', platform: 'meta', format: 'unknown', constraints: [] },
      components: {
        headline: r['Title'] || adName,
        body: r['Body'] || null,
        cta: r['Call to Action'] || null,
      },
      pattern_tags: [],
      status: 'drafted',
      generalizable,
      generalization_caveat: generalizable ? null : 'Retail-era campaign.',
      source_csv: 'ads-export-2',
      source_row_hash: rowHash('ads-export-2', r['Ad ID'] || adName, i),
    };
  });
  const res = await insertRows('mktg_creatives', out);
  console.log(`  -> mktg_creatives: +${res.inserted} inserted, ${res.skipped} skipped`);
}

// ─── ETL: scripts.csv ───────────────────────────────────────────────────────
async function etlScripts() {
  const file = path.join(PLAYBOOK_DIR, 'scripts.csv');
  const rows = readCsv(file);
  const limited = LIMIT ? rows.slice(0, LIMIT) : rows;
  console.log(`scripts.csv: ${rows.length} rows`);

  const out = limited.map((r) => {
    const sid = r.script_id;
    const meta = (r.meta_performance || '').trim();
    const hasPerf = meta && meta.toLowerCase() !== 'no performance data' && meta.toLowerCase() !== '' && meta !== '-';
    return {
      creative_type: 'video_script',
      brief: {
        objective: r.funnel_stage || 'historical',
        audience: r.audience_segment || 'historical',
        platform: 'meta',
        format: 'video',
        constraints: [],
      },
      components: {
        script: {
          full_script: r.script_content,
          hook: null,
          outline_beats: [],
        },
        cta: r.cta || null,
        composition_pattern: r.script_type || null,
        hook_type: r.angle_hook_type || null,
      },
      pattern_tags: [r.script_type, r.funnel_stage, r.angle_hook_type, r.emotional_tone].filter(Boolean),
      status: hasPerf ? 'performed' : 'drafted',
      performance: hasPerf ? { video_metrics: { notes: meta } } : null,
      shipped_at: hasPerf ? new Date().toISOString() : null,
      performed_at: hasPerf ? new Date().toISOString() : null,
      generalizable: true,
      source_csv: 'scripts.csv',
      source_row_hash: rowHash('scripts', sid),
    };
  });
  const res = await insertRows('mktg_creatives', out);
  console.log(`  -> mktg_creatives: +${res.inserted} inserted, ${res.skipped} skipped`);
}

// ─── ETL: reviews.csv ───────────────────────────────────────────────────────
async function etlReviews() {
  const file = path.join(PLAYBOOK_DIR, 'reviews.csv');
  const rows = readCsv(file);
  const limited = LIMIT ? rows.slice(0, LIMIT) : rows;
  console.log(`reviews.csv: ${rows.length} rows`);

  const out = limited.map((r) => ({
    source: (r.source_url || '').includes('trustpilot') ? 'trustpilot' : 'other',
    captured_at: safeDate(r.review_date) || new Date().toISOString(),
    rating: numOrNull(r.rating),
    raw_text: [r.review_title, r.review_content].filter(Boolean).join(' — '),
    verbatim_phrases: [],   // Backfilled by Block 2.1 via Haiku extraction.
    pain_points_referenced: [],
    products_referenced: [],
    audience_segment: r.reviewer_location || null,
    usable_for_social_proof: true,
    consent_to_quote: false, // Default false; review platform may need opt-in.
    source_csv: 'reviews.csv',
    source_row_hash: rowHash('reviews', r.review_id),
  }));
  const res = await insertRows('mktg_reviews', out);
  console.log(`  -> mktg_reviews: +${res.inserted} inserted, ${res.skipped} skipped`);
}

// ─── ETL: pain_points.csv ───────────────────────────────────────────────────
async function etlPainPoints() {
  const file = path.join(PLAYBOOK_DIR, 'pain_points.csv');
  const rows = readCsv(file);
  console.log(`pain_points.csv: ${rows.length} rows`);

  const out = rows.map((r) => ({
    name: r.condition_name,
    description: [
      r.symptoms ? `Symptoms: ${r.symptoms}` : null,
      r.triggers ? `Triggers: ${r.triggers}` : null,
      r.typical_treatments_and_frustrations ? `Frustrations: ${r.typical_treatments_and_frustrations}` : null,
      r.why_tallow_helps ? `Why tallow helps: ${r.why_tallow_helps}` : null,
    ].filter(Boolean).join(' '),
    audience_segment: null,
    frequency: 0,
    example_phrasings: [],
    products_relevant: r.products_that_help ? r.products_that_help.split(',').map((s) => s.trim()).filter(Boolean) : [],
    active: true,
    source_csv: 'pain_points.csv',
    source_row_hash: rowHash('pain_points', r.condition_id, r.condition_name),
  }));
  const res = await insertRows('mktg_pain_points', out);
  console.log(`  -> mktg_pain_points: +${res.inserted} inserted, ${res.skipped} skipped`);
}

// ─── ETL: social_proof.csv ──────────────────────────────────────────────────
async function etlSocialProof() {
  const file = path.join(PLAYBOOK_DIR, 'social_proof.csv');
  const rows = readCsv(file);
  console.log(`social_proof.csv: ${rows.length} rows`);

  const TYPE_MAP = {
    'Media mention': 'press_mention',
    'Press mention': 'press_mention',
    'Stat': 'stat',
    'Endorsement': 'endorsement',
    'Award': 'award',
    'Review': 'review_quote',
  };

  const out = rows.map((r) => ({
    type: TYPE_MAP[r.category] || 'press_mention',
    content: r.claim,
    source: r.source || null,
    captured_at: new Date().toISOString(),
    current: true,
    consent: true,
    source_csv: 'social_proof.csv',
    source_row_hash: rowHash('social_proof', r.proof_id, r.claim),
  }));
  const res = await insertRows('mktg_social_proof', out);
  console.log(`  -> mktg_social_proof: +${res.inserted} inserted, ${res.skipped} skipped`);
}

// ─── ETL: primary-text.csv ──────────────────────────────────────────────────
async function etlPrimaryText() {
  const file = path.join(PLAYBOOK_DIR, 'primary-text.csv');
  const rows = readCsv(file);
  console.log(`primary-text.csv: ${rows.length} rows`);

  const out = rows.map((r, i) => ({
    text: r.text,
    campaign_id: null,
    notes: null,
    source_csv: 'primary-text.csv',
    source_row_hash: rowHash('primary-text', i, (r.text || '').slice(0, 200)),
  })).filter((r) => r.text);
  const res = await insertRows('mktg_primary_text_bank', out);
  console.log(`  -> mktg_primary_text_bank: +${res.inserted} inserted, ${res.skipped} skipped`);
}

// ─── ETL: script_types_reference.csv ────────────────────────────────────────
async function etlScriptTypes() {
  const file = path.join(PLAYBOOK_DIR, 'script_types_reference.csv');
  const rows = readCsv(file);
  console.log(`script_types_reference.csv: ${rows.length} rows`);

  const out = rows.map((r) => ({
    pattern_type: 'structure_template',
    name: r.script_type,
    description: r.description || '',
    definition: { funnel_stage: r.funnel_stage, when_to_use: r.when_to_use },
    evidence_creative_ids: [],
    performance_summary: { n_observations: 0 },
    audience_segments: [],
    active: true,                  // Reference taxonomy — pre-approved.
    approved_at: new Date().toISOString(),
    approved_by: 'etl-seed',
    source_csv: 'script_types_reference.csv',
    source_row_hash: rowHash('script-types', r.script_type, r.funnel_stage),
  }));
  const res = await insertRows('mktg_playbook_patterns', out);
  console.log(`  -> mktg_playbook_patterns: +${res.inserted} inserted, ${res.skipped} skipped`);
}

// ─── helpers ────────────────────────────────────────────────────────────────
function numOrNull(v) {
  if (v == null || v === '' || v === '-') return null;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function safeDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────
const TASKS = {
  adsmanager:   etlAdsmanager,
  'other-ads':  etlOtherAds,
  'ads-export-2': etlAdsExport2,
  scripts:      etlScripts,
  reviews:      etlReviews,
  'pain-points': etlPainPoints,
  'social-proof': etlSocialProof,
  'primary-text': etlPrimaryText,
  'script-types': etlScriptTypes,
};

const ORDER = [
  'pain-points',     // referenced by reviews
  'social-proof',
  'script-types',    // playbook patterns first — referenced as evidence
  'reviews',
  'primary-text',
  'scripts',
  'adsmanager',      // small, high-signal
  'other-ads',
  'ads-export-2',    // huge — last
];

(async () => {
  if (!DRY_RUN && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars (use --dry-run to parse without writing).');
    process.exit(1);
  }
  if (!fs.existsSync(PLAYBOOK_DIR)) {
    console.error(`Playbook folder not found: ${PLAYBOOK_DIR}`);
    console.error('Pass --playbook-dir=PATH to override.');
    process.exit(1);
  }
  console.log(`Playbook dir: ${PLAYBOOK_DIR}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'WRITE'}`);
  if (RETAIL_FROM) console.log(`Retail era: ${RETAIL_FROM.toISOString().slice(0,10)} to ${RETAIL_TO.toISOString().slice(0,10)} -> generalizable=false`);

  const taskNames = target === 'all' ? ORDER : [target];
  for (const name of taskNames) {
    const fn = TASKS[name];
    if (!fn) { console.error(`Unknown CSV slug: ${name}`); process.exit(1); }
    console.log(`\n--- ${name} ---`);
    try { await fn(); }
    catch (e) { console.error(`  FAILED: ${e.message || e}`); process.exit(1); }
  }
  console.log('\nETL complete.');
})();
