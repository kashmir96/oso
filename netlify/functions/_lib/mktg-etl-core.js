/**
 * mktg-etl-core.js — pure transform logic for the CSV ETL.
 *
 * Each TRANSFORMERS[slug](rows, opts) returns an array of plain objects
 * ready for sbInsert into the corresponding mktg_* table. No DB writes
 * happen here -- that's the caller's job. Used by:
 *
 *   - scripts/mktg-etl.js                 (CLI; reads CSVs from local FS)
 *   - netlify/functions/mktg-etl-run.js   (HTTP; reads CSVs from Supabase Storage)
 *
 * Both share the same transform logic so output is byte-identical regardless
 * of which path runs the ETL.
 *
 * opts:
 *   { retailFrom: Date|null, retailTo: Date|null, limit: number|null }
 */
const crypto = require('node:crypto');

// ─── slug -> source filename in the playbook folder / etl bucket ───────────
const FILENAMES = {
  'adsmanager':    'adsmanager.csv',
  'other-ads':     'other ads export.csv',
  'ads-export-2':  'ads export 2.csv',
  'scripts':       'scripts.csv',
  'reviews':       'reviews.csv',
  'pain-points':   'pain_points.csv',
  'social-proof':  'social_proof.csv',
  'primary-text':  'primary-text.csv',
  'script-types':  'script_types_reference.csv',
};

// ─── slug -> destination table ──────────────────────────────────────────────
const TARGET_TABLES = {
  'adsmanager':    'mktg_creatives',
  'other-ads':     'mktg_creatives',
  'ads-export-2':  'mktg_creatives',
  'scripts':       'mktg_creatives',
  'reviews':       'mktg_reviews',
  'pain-points':   'mktg_pain_points',
  'social-proof':  'mktg_social_proof',
  'primary-text':  'mktg_primary_text_bank',
  'script-types':  'mktg_playbook_patterns',
};

// Suggested invocation order. ETL is idempotent so the order is informative
// rather than load-bearing -- it just means dependent reference data
// (pain points, patterns) lands before the records that might cite them.
const ORDER = [
  'pain-points', 'social-proof', 'script-types',
  'reviews', 'primary-text',
  'scripts', 'adsmanager', 'other-ads', 'ads-export-2',
];

const SLUGS = Object.keys(FILENAMES);

// ─── helpers ────────────────────────────────────────────────────────────────
function rowHash(csvSlug, ...parts) {
  return crypto.createHash('sha256')
    .update(csvSlug + '|' + parts.map((p) => String(p ?? '')).join('|'))
    .digest('hex')
    .slice(0, 32);
}

function isInRetailEra(dateStr, retailFrom, retailTo) {
  if (!retailFrom || !retailTo || !dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  return d >= retailFrom && d <= retailTo;
}

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

// ─── transformers ──────────────────────────────────────────────────────────
const TRANSFORMERS = {
  'adsmanager': (rows, opts = {}) => {
    const limited = opts.limit ? rows.slice(0, opts.limit) : rows;
    return limited.map((r, i) => {
      const adName    = r['Ad name'] || r['ad_name'] || `ad-${i}`;
      const startDate = r['Reporting starts'];
      const generalizable = !isInRetailEra(startDate, opts.retailFrom, opts.retailTo);
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
      return {
        creative_type: 'ad',
        brief: { objective: 'historical', audience: 'historical', platform: 'meta', format: 'unknown', constraints: [] },
        components: { headline: adName },
        pattern_tags: [],
        status: hasPerf ? 'performed' : 'drafted',
        performance: hasPerf ? performance : null,
        shipped_at: hasPerf ? safeDate(startDate) : null,
        performed_at: hasPerf ? safeDate(r['Reporting ends']) : null,
        generalizable,
        generalization_caveat: generalizable ? null : 'Retail-era creative -- different unit economics + audience funnel.',
        source_csv: 'adsmanager.csv',
        source_row_hash: rowHash('adsmanager', adName, startDate),
      };
    });
  },

  'other-ads': (rows, opts = {}) => {
    const limited = opts.limit ? rows.slice(0, opts.limit) : rows;
    return limited.map((r, i) => {
      const adName = r['Ad Name'] || r['Title'] || `other-${i}`;
      const adId   = r['Ad ID'] || `synth-${i}`;
      const body   = r['Body'] || r['Marketing Message Primary Text'] || null;
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
  },

  'ads-export-2': (rows, opts = {}) => {
    const limited = opts.limit ? rows.slice(0, opts.limit) : rows;
    return limited.map((r, i) => {
      const adName    = r['Ad Name'] || r['Title'] || r['Campaign Name'] || `ae2-${i}`;
      const startTime = r['Campaign Start Time'] || r['Ad Set Start Time'];
      const generalizable = !isInRetailEra(startTime, opts.retailFrom, opts.retailTo);
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
  },

  'scripts': (rows, opts = {}) => {
    const limited = opts.limit ? rows.slice(0, opts.limit) : rows;
    return limited.map((r) => {
      const meta    = (r.meta_performance || '').trim();
      const hasPerf = meta && meta.toLowerCase() !== 'no performance data' && meta !== '-';
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
          script: { full_script: r.script_content, hook: null, outline_beats: [] },
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
        source_row_hash: rowHash('scripts', r.script_id),
      };
    });
  },

  'reviews': (rows, opts = {}) => {
    const limited = opts.limit ? rows.slice(0, opts.limit) : rows;
    return limited.map((r) => ({
      source: (r.source_url || '').includes('trustpilot') ? 'trustpilot' : 'other',
      captured_at: safeDate(r.review_date) || new Date().toISOString(),
      rating: numOrNull(r.rating),
      raw_text: [r.review_title, r.review_content].filter(Boolean).join(' -- '),
      verbatim_phrases: [],
      pain_points_referenced: [],
      products_referenced: [],
      audience_segment: r.reviewer_location || null,
      usable_for_social_proof: true,
      consent_to_quote: false,
      source_csv: 'reviews.csv',
      source_row_hash: rowHash('reviews', r.review_id),
    }));
  },

  'pain-points': (rows) => rows.map((r) => ({
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
  })),

  'social-proof': (rows) => {
    const TYPE_MAP = {
      'Media mention': 'press_mention',
      'Press mention': 'press_mention',
      'Stat': 'stat',
      'Endorsement': 'endorsement',
      'Award': 'award',
      'Review': 'review_quote',
    };
    return rows.map((r) => ({
      type: TYPE_MAP[r.category] || 'press_mention',
      content: r.claim,
      source: r.source || null,
      captured_at: new Date().toISOString(),
      current: true,
      consent: true,
      source_csv: 'social_proof.csv',
      source_row_hash: rowHash('social_proof', r.proof_id, r.claim),
    }));
  },

  'primary-text': (rows) => rows.map((r, i) => ({
    text: r.text,
    campaign_id: null,
    notes: null,
    source_csv: 'primary-text.csv',
    source_row_hash: rowHash('primary-text', i, (r.text || '').slice(0, 200)),
  })).filter((r) => r.text),

  'script-types': (rows) => rows.map((r) => ({
    pattern_type: 'structure_template',
    name: r.script_type,
    description: r.description || '',
    definition: { funnel_stage: r.funnel_stage, when_to_use: r.when_to_use },
    evidence_creative_ids: [],
    performance_summary: { n_observations: 0 },
    audience_segments: [],
    active: true,
    approved_at: new Date().toISOString(),
    approved_by: 'etl-seed',
    source_csv: 'script_types_reference.csv',
    source_row_hash: rowHash('script-types', r.script_type, r.funnel_stage),
  })),
};

// ─── CSV reader (handles UTF-16 BOM tab-delimited Meta exports) ────────────
function parseCsvBuffer(buf) {
  const { parse } = require('csv-parse/sync');
  let text;
  let delimiter = ',';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    text = buf.slice(2).toString('utf16le');
    delimiter = '\t';
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    text = buf.slice(2).toString('utf16le');
    delimiter = '\t';
  } else {
    text = buf.toString('utf8');
    const first = text.split(/\r?\n/, 1)[0] || '';
    if ((first.match(/\t/g) || []).length > (first.match(/,/g) || []).length) delimiter = '\t';
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

module.exports = {
  FILENAMES,
  TARGET_TABLES,
  ORDER,
  SLUGS,
  TRANSFORMERS,
  parseCsvBuffer,
  rowHash,
  isInRetailEra,
  numOrNull,
  safeDate,
};
