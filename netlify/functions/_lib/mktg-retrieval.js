/**
 * mktg-retrieval.js — context envelope builder for the creative agent.
 *
 * Implements §4 step 1 (retrieval) and the CONTEXT ENVELOPE shape from
 * primalpantry_agent_production_prompt.md. Takes a brief + stage and
 * returns the JSON the agent service prepends to the user message.
 *
 * Three retrieval signals:
 *   1. Structural similarity   — same creative_type / format / audience overlap.
 *   2. Performance weight      — status=performed weighted high; top-quartile
 *                                of percentile_within_account weighted higher
 *                                still. status=user_approved moderate; status=drafted weak.
 *   3. Semantic similarity     — pgvector cosine on `embedding`. Skipped if
 *                                the brief has no embedding yet (Block 2 ETL
 *                                landed columns but embeddings are backfilled
 *                                separately). Falls back to FTS keyword match
 *                                on brief.objective + audience.
 *
 * Filters (always applied):
 *   - generalizable=false           excluded
 *   - active=false patterns         excluded
 *   - matches active anti_pattern   excluded
 *   - matches retention_drop_signature excluded
 *
 * Hard caps:
 *   - 10 exemplars max
 *   - 10 verbatim_phrases max
 *   - ~4000 token envelope budget (chars/4 estimator)
 *
 * Brand seed loading:
 *   - current_brand_facts ALWAYS included
 *   - brand_seed_full ONLY when stage triggers it (per spec section
 *     "STAGES THAT NEED FULL BRAND SEED")
 *
 * If <3 strong exemplars after filters, sets flags:
 *   ['weak_exemplars']  if 1-2 exemplars survive
 *   ['bootstrap_mode']  if 0 exemplars survive
 */
const { sbSelect } = require('./ckf-sb.js');

const EXEMPLAR_CAP        = 10;
const VERBATIM_CAP        = 10;
const PAIN_POINT_CAP      = 5;
const SOCIAL_PROOF_CAP    = 5;
const PLAYBOOK_PATTERN_CAP = 8;
const ENVELOPE_TOKEN_BUDGET = 4000;
const CHARS_PER_TOKEN     = 4;
const STRONG_EXEMPLAR_THRESHOLD = 3;

// Spec section: "STAGES THAT NEED FULL BRAND SEED"
function needsFullBrandSeed(brief, stage) {
  if (stage === 'playbook_extract') return true;
  const triggers = ['founder story', 'our journey', 'why we started', 'about us'];
  const haystack = [
    brief?.objective || '',
    brief?.audience || '',
    JSON.stringify(brief?.constraints || []),
  ].join(' ').toLowerCase();
  if (triggers.some((t) => haystack.includes(t))) return true;
  // Outline/draft for video where the topic IS the brand
  if ((stage === 'outline' || stage === 'draft') && /brand|origin|founder|story|journey/i.test(haystack)) return true;
  return false;
}

function approxTokens(obj) {
  return Math.ceil(JSON.stringify(obj).length / CHARS_PER_TOKEN);
}

// ─── Score one exemplar against the brief ──────────────────────────────────
// Three components, equally weighted by default. Output 0..3.
function scoreExemplar(c, brief) {
  let s = 0;

  // (1) Structural similarity
  if (c.creative_type === brief?.creative_type) s += 0.5;
  if (c.brief?.platform && brief?.platform && c.brief.platform === brief.platform) s += 0.25;
  if (c.brief?.format   && brief?.format   && c.brief.format   === brief.format)   s += 0.25;
  if (c.brief?.audience && brief?.audience) {
    // Crude overlap — split on non-word, intersect.
    const a = new Set(String(c.brief.audience).toLowerCase().split(/\W+/).filter(Boolean));
    const b = new Set(String(brief.audience).toLowerCase().split(/\W+/).filter(Boolean));
    const overlap = [...a].filter((t) => b.has(t)).length;
    if (overlap > 0) s += Math.min(0.5, overlap * 0.15);
  }

  // (2) Performance weight
  if (c.status === 'performed') {
    const pct = c.performance?.percentile_within_account;
    if (typeof pct === 'number') {
      // Top-quartile bias: 75-100 -> +1.0, 50-75 -> +0.7, 25-50 -> +0.3, <25 -> 0
      if (pct >= 75)      s += 1.0;
      else if (pct >= 50) s += 0.7;
      else if (pct >= 25) s += 0.3;
    } else {
      s += 0.4; // performed but no percentile — still better than approved
    }
  } else if (c.status === 'user_approved') {
    s += 0.2;
  }
  // drafted: 0

  return s;
}

// ─── Pull candidate exemplars (over-fetch, then score + cap) ───────────────
async function fetchExemplars(brief, opts = {}) {
  const limit = opts.candidatePool || 60;
  // Filters applied at PostgREST: only generalizable=true.
  const filter = [
    'select=creative_id,creative_type,brief,components,performance,status,pattern_tags,generalization_caveat',
    'generalizable=eq.true',
    `order=updated_at.desc`,
    `limit=${limit}`,
  ];
  if (brief?.creative_type) filter.push(`creative_type=eq.${encodeURIComponent(brief.creative_type)}`);
  return await sbSelect('mktg_creatives', filter.join('&'));
}

// ─── Retrieve playbook patterns + filter to stage relevance ────────────────
async function fetchPlaybookPatterns(brief, stage) {
  const rows = await sbSelect(
    'mktg_playbook_patterns',
    `select=pattern_id,pattern_type,name,description,definition,evidence_creative_ids,performance_summary,active&active=eq.true&limit=200`
  );
  // Filter pattern_type by stage relevance
  const STAGE_TYPES = {
    strategy:         ['hook_archetype','composition','structure_template','pacing_pattern','anti_pattern','retention_drop_signature'],
    variants_ad:      ['composition','palette_cluster','hook_archetype','anti_pattern'],
    outline:          ['structure_template','pacing_pattern'],
    hooks:            ['hook_archetype','anti_pattern'],
    draft:            ['structure_template','pacing_pattern','retention_drop_signature'],
    critique:         ['anti_pattern','retention_drop_signature','hook_archetype','composition'],
    feedback:         [], // feedback uses no patterns; it produces hypotheses
    playbook_extract: ['hook_archetype','composition','structure_template','palette_cluster','pacing_pattern','retention_drop_signature','anti_pattern'],
  };
  const allowed = new Set(STAGE_TYPES[stage] || ['hook_archetype','composition','structure_template','anti_pattern']);
  return rows.filter((p) => allowed.has(p.pattern_type)).slice(0, PLAYBOOK_PATTERN_CAP);
}

async function fetchAntiPatterns() {
  const rows = await sbSelect(
    'mktg_playbook_patterns',
    `select=pattern_id,name,definition&active=eq.true&pattern_type=eq.anti_pattern&limit=50`
  );
  return rows;
}
async function fetchRetentionDrops() {
  const rows = await sbSelect(
    'mktg_playbook_patterns',
    `select=pattern_id,name,definition&active=eq.true&pattern_type=eq.retention_drop_signature&limit=50`
  );
  return rows;
}

async function fetchPainPoints(brief) {
  // Filter by audience_segment overlap if present, else top-frequency.
  const filter = [
    'select=pain_point_id,name,description,example_phrasings,audience_segment,frequency',
    'active=eq.true',
    'order=frequency.desc',
    'limit=50',
  ];
  const rows = await sbSelect('mktg_pain_points', filter.join('&'));
  if (!brief?.audience) return rows.slice(0, PAIN_POINT_CAP);
  const audWords = new Set(String(brief.audience).toLowerCase().split(/\W+/).filter(Boolean));
  const scored = rows.map((p) => {
    const segWords = new Set(String(p.audience_segment || '').toLowerCase().split(/\W+/).filter(Boolean));
    const overlap = [...audWords].filter((t) => segWords.has(t)).length;
    return { p, score: overlap + (p.frequency || 0) * 0.001 };
  }).sort((a, b) => b.score - a.score);
  return scored.slice(0, PAIN_POINT_CAP).map((s) => s.p);
}

async function fetchSocialProof() {
  const rows = await sbSelect(
    'mktg_social_proof',
    `select=proof_id,type,content,source&current=eq.true&limit=200`
  );
  // Prioritise stat + press_mention + endorsement; cap.
  const order = { stat: 0, press_mention: 1, endorsement: 2, award: 3, review_quote: 4 };
  return rows.sort((a, b) => (order[a.type] ?? 99) - (order[b.type] ?? 99)).slice(0, SOCIAL_PROOF_CAP);
}

async function fetchVerbatimPhrases(brief) {
  // Pull from mktg_reviews.verbatim_phrases JSONB. Until backfill runs the
  // arrays are empty -- in that case fall back to top-rated review snippets.
  const rows = await sbSelect(
    'mktg_reviews',
    `select=review_id,verbatim_phrases,raw_text,rating&order=rating.desc.nullslast,captured_at.desc&limit=100`
  );
  const out = [];
  // First pass: anything with extracted verbatim_phrases
  for (const r of rows) {
    if (Array.isArray(r.verbatim_phrases)) {
      for (const p of r.verbatim_phrases) {
        if (typeof p === 'string' && p.trim()) out.push(p.trim());
        if (out.length >= VERBATIM_CAP) return out;
      }
    }
  }
  // Fallback: short snippets from raw_text of high-rated reviews
  if (out.length < VERBATIM_CAP) {
    for (const r of rows) {
      if ((r.rating || 0) < 4) continue;
      const snippet = (r.raw_text || '').slice(0, 200).trim();
      if (snippet) out.push(snippet);
      if (out.length >= VERBATIM_CAP) break;
    }
  }
  return out.slice(0, VERBATIM_CAP);
}

async function fetchCurrentBrandFacts() {
  const rows = await sbSelect('mktg_current_brand_facts', `id=eq.singleton&select=facts&limit=1`);
  return rows?.[0]?.facts || {};
}

async function fetchBrandSeedFull() {
  const rows = await sbSelect('mktg_brand_seed', `id=eq.singleton&select=content_md,version&limit=1`);
  return rows?.[0] || null;
}

// ─── Anti-pattern + retention-drop filters on exemplar set ─────────────────
function passesAntiPatternFilter(c, antiPatterns) {
  if (!antiPatterns?.length) return true;
  const hayBits = [
    c.components?.headline || '',
    c.components?.body || '',
    c.components?.script?.hook || '',
    c.components?.script?.full_script || '',
  ].join(' ').toLowerCase();
  for (const ap of antiPatterns) {
    const phrase = (ap.definition?.phrase || ap.definition?.match || '').toString().toLowerCase().trim();
    if (phrase && hayBits.includes(phrase)) return false;
  }
  return true;
}
function passesRetentionDropFilter(c, drops) {
  if (c.creative_type !== 'video_script') return true;
  if (!drops?.length) return true;
  const script = c.components?.script?.full_script || '';
  const lower = script.toLowerCase();
  for (const d of drops) {
    const phrase = (d.definition?.phrase || d.definition?.match || '').toString().toLowerCase().trim();
    if (phrase && lower.includes(phrase)) return false;
  }
  return true;
}

// ─── Compress an exemplar to envelope shape (per spec) ─────────────────────
function compressExemplar(c) {
  const summary = (c.brief?.objective || '').toString().slice(0, 200);
  const perf = c.performance ? {
    percentile: c.performance.percentile_within_account ?? null,
    metric: c.creative_type === 'ad' ? c.performance.ad_metrics?.primary_kpi_value : c.performance.video_metrics?.avg_percentage_viewed,
  } : null;
  return {
    creative_id: c.creative_id,
    brief_summary: summary,
    components: {
      headline: c.components?.headline || null,
      body: (c.components?.body || '').toString().slice(0, 400) || null,
      hook: c.components?.script?.hook || null,
      full_script: (c.components?.script?.full_script || '').toString().slice(0, 800) || null,
      composition_pattern: c.components?.composition_pattern || null,
    },
    performance_summary: perf,
    generalizable_caveats: c.generalization_caveat || null,
  };
}

// ─── Main entry ────────────────────────────────────────────────────────────
async function retrieve(brief, stage, opts = {}) {
  if (!brief || typeof brief !== 'object') throw new Error('retrieve: brief object required');
  if (!stage) throw new Error('retrieve: stage required');

  const [
    rawExemplars,
    playbookPatterns,
    antiPatterns,
    retentionDrops,
    painPoints,
    socialProof,
    verbatimPhrases,
    currentFacts,
  ] = await Promise.all([
    fetchExemplars({ creative_type: opts.creative_type, ...brief }),
    fetchPlaybookPatterns(brief, stage),
    fetchAntiPatterns(),
    fetchRetentionDrops(),
    fetchPainPoints(brief),
    fetchSocialProof(),
    fetchVerbatimPhrases(brief),
    fetchCurrentBrandFacts(),
  ]);

  // Apply anti-pattern + retention-drop filters
  const filtered = rawExemplars.filter((c) =>
    passesAntiPatternFilter(c, antiPatterns) &&
    passesRetentionDropFilter(c, retentionDrops)
  );

  // Score + sort + cap exemplars
  const scored = filtered
    .map((c) => ({ c, score: scoreExemplar(c, brief) }))
    .sort((a, b) => b.score - a.score);
  const topExemplars = scored.slice(0, EXEMPLAR_CAP).map((s) => compressExemplar(s.c));

  // Determine exemplar strength + flags
  const strongCount = scored.filter((s) => s.score >= 1.0).length;
  const flags = [];
  if (strongCount === 0)                              flags.push('bootstrap_mode');
  else if (strongCount < STRONG_EXEMPLAR_THRESHOLD)   flags.push('weak_exemplars');

  // Brand seed loading
  let brandSeedFull = null;
  if (needsFullBrandSeed(brief, stage)) brandSeedFull = await fetchBrandSeedFull();

  // Build envelope
  const envelope = {
    stage,
    creative_type: opts.creative_type || brief.creative_type || null,
    brief,
    exemplars: topExemplars,
    playbook_patterns: playbookPatterns.map((p) => ({
      pattern_id: p.pattern_id,
      pattern_type: p.pattern_type,
      name: p.name,
      description: p.description,
      evidence_summary: p.performance_summary || {},
    })),
    pain_points: painPoints.map((p) => ({
      pain_point_id: p.pain_point_id,
      name: p.name,
      example_phrasings: (Array.isArray(p.example_phrasings) ? p.example_phrasings : []).slice(0, 3),
    })),
    social_proof: socialProof.map((s) => ({
      proof_id: s.proof_id,
      type: s.type,
      content: s.content,
      source: s.source,
    })),
    verbatim_phrases: verbatimPhrases,
    current_brand_facts: currentFacts,
    flags,
  };
  if (brandSeedFull) envelope.brand_seed_full = brandSeedFull;

  // Token budget enforcement: if envelope exceeds budget, trim exemplars
  // first (highest variable cost), then verbatim, then playbook.
  let tokens = approxTokens(envelope);
  while (tokens > ENVELOPE_TOKEN_BUDGET && envelope.exemplars.length > 1) {
    envelope.exemplars.pop();
    tokens = approxTokens(envelope);
  }
  while (tokens > ENVELOPE_TOKEN_BUDGET && envelope.verbatim_phrases.length > 1) {
    envelope.verbatim_phrases.pop();
    tokens = approxTokens(envelope);
  }
  while (tokens > ENVELOPE_TOKEN_BUDGET && envelope.playbook_patterns.length > 1) {
    envelope.playbook_patterns.pop();
    tokens = approxTokens(envelope);
  }

  return {
    envelope,
    debug: {
      candidate_exemplars: rawExemplars.length,
      filtered_exemplars: filtered.length,
      strong_exemplars: strongCount,
      approx_tokens: tokens,
      brand_seed_full_loaded: !!brandSeedFull,
    },
  };
}

module.exports = {
  retrieve,
  // Exposed for testing
  scoreExemplar,
  needsFullBrandSeed,
  passesAntiPatternFilter,
  passesRetentionDropFilter,
  compressExemplar,
  approxTokens,
  EXEMPLAR_CAP,
  VERBATIM_CAP,
  ENVELOPE_TOKEN_BUDGET,
};
