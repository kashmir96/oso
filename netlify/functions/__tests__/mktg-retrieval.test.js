// Retrieval-layer tests: scorer, filters, brand-seed gating, envelope shape.
// Run: node --test netlify/functions/__tests__/mktg-retrieval.test.js
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

// Stub out _lib/ckf-sb.js BEFORE the module under test pulls it in. Each test
// can override the per-table fixtures by mutating `fixtures`.
const fixtures = {
  mktg_creatives: [],
  mktg_playbook_patterns: [],
  mktg_pain_points: [],
  mktg_social_proof: [],
  mktg_reviews: [],
  mktg_brand_seed: [],
  mktg_current_brand_facts: [],
};

const realLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request.endsWith('ckf-sb.js') || request.endsWith('ckf-sb')) {
    return {
      sbSelect: async (table, q) => {
        const all = fixtures[table] || [];
        // Honour pattern_type=eq.X and active=eq.true filters minimally so
        // fetchAntiPatterns / fetchRetentionDrops queries get the right slice.
        const want = {};
        for (const part of (q || '').split('&')) {
          const m = part.match(/^([a-z_]+)=eq\.(.+)$/);
          if (m) want[m[1]] = decodeURIComponent(m[2]);
        }
        return all.filter((r) => {
          for (const [k, v] of Object.entries(want)) {
            if (r[k] === undefined) continue;
            if (String(r[k]) !== String(v === 'true' ? true : v === 'false' ? false : v)) return false;
          }
          return true;
        });
      },
      sbInsert: async () => ({}), sbUpdate: async () => [], sbDelete: async () => true,
      sbFetch: async () => ({}),
    };
  }
  return realLoad.call(this, request, parent, ...rest);
};

const {
  retrieve,
  scoreExemplar,
  needsFullBrandSeed,
  passesAntiPatternFilter,
  passesRetentionDropFilter,
  compressExemplar,
  approxTokens,
  EXEMPLAR_CAP,
  ENVELOPE_TOKEN_BUDGET,
} = require('../_lib/mktg-retrieval.js');

function reset() {
  for (const k of Object.keys(fixtures)) fixtures[k] = [];
  fixtures.mktg_current_brand_facts = [{ facts: { team_size: 23, customers_count: '100,000+ kiwis' } }];
}

// --- scoreExemplar ---------------------------------------------------------
test('scoreExemplar: same creative_type adds points', () => {
  const c = { creative_type: 'video_script', brief: { audience: '' }, status: 'drafted' };
  const brief = { creative_type: 'video_script' };
  assert.ok(scoreExemplar(c, brief) >= 0.5);
});

test('scoreExemplar: performed top-quartile beats user_approved', () => {
  const top = {
    creative_type: 'ad', brief: {}, status: 'performed',
    performance: { percentile_within_account: 90 },
  };
  const approved = { creative_type: 'ad', brief: {}, status: 'user_approved' };
  const brief = { creative_type: 'ad' };
  assert.ok(scoreExemplar(top, brief) > scoreExemplar(approved, brief));
});

test('scoreExemplar: performed bottom-quartile gets zero performance bonus', () => {
  const bot = {
    creative_type: 'ad', brief: {}, status: 'performed',
    performance: { percentile_within_account: 12 },
  };
  const top = {
    creative_type: 'ad', brief: {}, status: 'performed',
    performance: { percentile_within_account: 80 },
  };
  const brief = { creative_type: 'ad' };
  assert.ok(scoreExemplar(top, brief) > scoreExemplar(bot, brief));
});

test('scoreExemplar: audience overlap adds points', () => {
  const c = { creative_type: 'ad', brief: { audience: 'eczema mums new zealand' }, status: 'drafted' };
  const briefMatch = { creative_type: 'ad', audience: 'eczema mums kiwi' };
  const briefNo    = { creative_type: 'ad', audience: 'tradies south island' };
  assert.ok(scoreExemplar(c, briefMatch) > scoreExemplar(c, briefNo));
});

// --- needsFullBrandSeed -----------------------------------------------------
test('needsFullBrandSeed: triggers on brief mentioning founder story', () => {
  assert.strictEqual(needsFullBrandSeed({ objective: 'tell our founder story for new audience' }, 'strategy'), true);
  assert.strictEqual(needsFullBrandSeed({ objective: 'why we started this thing' }, 'strategy'), true);
  assert.strictEqual(needsFullBrandSeed({ objective: 'about us page' }, 'strategy'), true);
});

test('needsFullBrandSeed: triggers on playbook_extract stage', () => {
  assert.strictEqual(needsFullBrandSeed({ objective: 'whatever' }, 'playbook_extract'), true);
});

test('needsFullBrandSeed: false for routine ad strategy stage', () => {
  assert.strictEqual(needsFullBrandSeed({ objective: 'sell tallow balm to eczema mums' }, 'strategy'), false);
  assert.strictEqual(needsFullBrandSeed({ objective: 'winter promo Reviana' }, 'variants_ad'), false);
});

test('needsFullBrandSeed: outline/draft only when topic is the brand', () => {
  assert.strictEqual(needsFullBrandSeed({ objective: 'video about our origin story' }, 'outline'), true);
  assert.strictEqual(needsFullBrandSeed({ objective: 'video about pain relief' }, 'outline'), false);
});

// --- Anti-pattern filter ----------------------------------------------------
test('passesAntiPatternFilter: no anti-patterns -> always pass', () => {
  const c = { components: { headline: 'Anything' } };
  assert.ok(passesAntiPatternFilter(c, []));
});

test('passesAntiPatternFilter: matching phrase fails', () => {
  const c = { components: { headline: 'Indulge in luxury skincare today' } };
  const aps = [{ definition: { phrase: 'indulge in luxury' } }];
  assert.ok(!passesAntiPatternFilter(c, aps));
});

test('passesAntiPatternFilter: non-matching passes', () => {
  const c = { components: { headline: 'Whipped tallow for dry skin' } };
  const aps = [{ definition: { phrase: 'pamper yourself' } }];
  assert.ok(passesAntiPatternFilter(c, aps));
});

// --- Retention drop filter --------------------------------------------------
test('passesRetentionDropFilter: only applies to video_script', () => {
  const ad = { creative_type: 'ad' };
  const drops = [{ definition: { phrase: 'have you ever' } }];
  assert.ok(passesRetentionDropFilter(ad, drops), 'ads always pass');
});

test('passesRetentionDropFilter: video script with matching phrase fails', () => {
  const vid = { creative_type: 'video_script', components: { script: { full_script: 'Have you ever wondered about tallow' } } };
  const drops = [{ definition: { phrase: 'have you ever' } }];
  assert.ok(!passesRetentionDropFilter(vid, drops));
});

// --- compressExemplar ------------------------------------------------------
test('compressExemplar: shape matches spec envelope', () => {
  const c = {
    creative_id: 'abc',
    creative_type: 'ad',
    brief: { objective: 'sell stuff' },
    components: { headline: 'h', body: 'b'.repeat(500) },
    status: 'performed',
    performance: { percentile_within_account: 75, ad_metrics: { primary_kpi_value: 12 } },
  };
  const out = compressExemplar(c);
  assert.strictEqual(out.creative_id, 'abc');
  assert.strictEqual(out.brief_summary, 'sell stuff');
  assert.strictEqual(out.components.headline, 'h');
  assert.ok(out.components.body.length <= 400, 'body capped to 400 chars');
  assert.strictEqual(out.performance_summary.percentile, 75);
});

// --- End-to-end retrieve() with fixtures -----------------------------------
test('retrieve: empty corpus -> bootstrap_mode flag', async () => {
  reset();
  const { envelope } = await retrieve({ creative_type: 'ad', objective: 'x' }, 'strategy');
  assert.deepStrictEqual(envelope.exemplars, []);
  assert.ok(envelope.flags.includes('bootstrap_mode'));
  assert.deepStrictEqual(envelope.current_brand_facts, { team_size: 23, customers_count: '100,000+ kiwis' });
});

test('retrieve: 1-2 strong exemplars -> weak_exemplars flag', async () => {
  reset();
  fixtures.mktg_creatives = [
    {
      creative_id: 'c1', creative_type: 'ad', brief: {}, components: {}, status: 'performed',
      performance: { percentile_within_account: 90 },
    },
    {
      creative_id: 'c2', creative_type: 'ad', brief: {}, components: {}, status: 'performed',
      performance: { percentile_within_account: 88 },
    },
  ];
  const { envelope } = await retrieve({ creative_type: 'ad', objective: 'x' }, 'strategy');
  assert.strictEqual(envelope.exemplars.length, 2);
  assert.ok(envelope.flags.includes('weak_exemplars'));
});

test('retrieve: 3+ strong exemplars -> no weak/bootstrap flag', async () => {
  reset();
  fixtures.mktg_creatives = [1,2,3,4].map((i) => ({
    creative_id: `c${i}`, creative_type: 'ad', brief: {}, components: {}, status: 'performed',
    performance: { percentile_within_account: 85 },
  }));
  const { envelope } = await retrieve({ creative_type: 'ad', objective: 'x' }, 'strategy');
  assert.ok(!envelope.flags.includes('bootstrap_mode'));
  assert.ok(!envelope.flags.includes('weak_exemplars'));
});

test('retrieve: respects EXEMPLAR_CAP', async () => {
  reset();
  fixtures.mktg_creatives = Array.from({ length: 30 }).map((_, i) => ({
    creative_id: `c${i}`, creative_type: 'ad', brief: {}, components: {}, status: 'performed',
    performance: { percentile_within_account: 80 + (i % 20) },
  }));
  const { envelope } = await retrieve({ creative_type: 'ad', objective: 'x' }, 'strategy');
  assert.strictEqual(envelope.exemplars.length, EXEMPLAR_CAP);
});

test('retrieve: anti-pattern filter excludes matching exemplars', async () => {
  reset();
  fixtures.mktg_playbook_patterns = [
    { pattern_id: 'ap1', pattern_type: 'anti_pattern', active: true, name: 'Luxury register', definition: { phrase: 'indulge in luxury' } },
  ];
  fixtures.mktg_creatives = [
    { creative_id: 'good', creative_type: 'ad', brief: {}, components: { headline: 'Whipped tallow soothes' }, status: 'performed', performance: { percentile_within_account: 90 } },
    { creative_id: 'bad',  creative_type: 'ad', brief: {}, components: { headline: 'Indulge in luxury skincare' }, status: 'performed', performance: { percentile_within_account: 95 } },
  ];
  const { envelope, debug } = await retrieve({ creative_type: 'ad', objective: 'x' }, 'strategy');
  const ids = envelope.exemplars.map((e) => e.creative_id);
  assert.ok(ids.includes('good'));
  assert.ok(!ids.includes('bad'), 'anti-pattern match must be excluded');
  assert.strictEqual(debug.filtered_exemplars, 1);
});

test('retrieve: brand_seed_full loaded only when stage triggers it', async () => {
  reset();
  fixtures.mktg_brand_seed = [{ content_md: '# brand\nfull seed', version: 1 }];

  const noTrigger = await retrieve({ creative_type: 'ad', objective: 'sell stuff' }, 'strategy');
  assert.strictEqual(noTrigger.envelope.brand_seed_full, undefined);

  const trigger = await retrieve({ creative_type: 'video_script', objective: 'tell our founder story' }, 'strategy');
  assert.ok(trigger.envelope.brand_seed_full);
  assert.strictEqual(trigger.envelope.brand_seed_full.version, 1);
});

test('retrieve: token budget enforced (envelope <= ENVELOPE_TOKEN_BUDGET tokens)', async () => {
  reset();
  // Stuff briefs with ~3000 chars each. Even after compression the brief
  // stays embedded raw in the envelope, so total grows linearly with
  // exemplars. This forces the trimmer to kick in.
  fixtures.mktg_creatives = Array.from({ length: 10 }).map((_, i) => ({
    creative_id: `bloat${i}`, creative_type: 'ad',
    brief: { objective: 'x'.repeat(3000) },
    components: { headline: 'h' },
    status: 'performed', performance: { percentile_within_account: 80 },
  }));
  // Inflate the input brief too -- the envelope embeds it verbatim.
  const briefIn = { creative_type: 'ad', objective: 'sell ' + 'x'.repeat(2000) };
  const { envelope, debug } = await retrieve(briefIn, 'strategy');
  assert.ok(debug.approx_tokens <= ENVELOPE_TOKEN_BUDGET, `envelope ${debug.approx_tokens} tokens > ${ENVELOPE_TOKEN_BUDGET} budget`);
});

test('retrieve: current_brand_facts always included (even empty)', async () => {
  reset();
  fixtures.mktg_current_brand_facts = [{ facts: {} }];
  const { envelope } = await retrieve({ creative_type: 'ad', objective: 'x' }, 'strategy');
  assert.ok('current_brand_facts' in envelope, 'envelope must always include current_brand_facts');
});

test('retrieve: never includes generalizable=false rows (filter at PostgREST)', async () => {
  reset();
  // The fake sbSelect honours generalizable=eq.true, so a generalizable=false
  // row should be filtered out before scoring.
  fixtures.mktg_creatives = [
    { creative_id: 'gen', creative_type: 'ad', brief: {}, components: {}, status: 'performed', performance: { percentile_within_account: 90 }, generalizable: true },
    { creative_id: 'retail', creative_type: 'ad', brief: {}, components: {}, status: 'performed', performance: { percentile_within_account: 95 }, generalizable: false },
  ];
  const { envelope } = await retrieve({ creative_type: 'ad', objective: 'x' }, 'strategy');
  const ids = envelope.exemplars.map((e) => e.creative_id);
  assert.ok(ids.includes('gen'));
  assert.ok(!ids.includes('retail'), 'retail-era (generalizable=false) row must not appear');
});
