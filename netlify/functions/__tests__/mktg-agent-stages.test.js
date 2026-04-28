// Stage schema validation tests for the creative agent.
// Run: node --test netlify/functions/__tests__/mktg-agent-stages.test.js
const test = require('node:test');
const assert = require('node:assert');
const { validateStageOutput, STAGE_NAMES } = require('../_lib/mktg-agent-stages.js');

// --- Stage registry --------------------------------------------------------
test('STAGE_NAMES covers all 9 stages (8 spec + wrap_script fast-path)', () => {
  assert.deepStrictEqual(
    STAGE_NAMES.sort(),
    ['critique','draft','feedback','hooks','outline','playbook_extract','strategy','variants_ad','wrap_script']
  );
});

// --- wrap_script (fast path: script-first record bubble) ------------------
test('wrap_script: minimal valid passes', () => {
  const r = validateStageOutput('wrap_script', {
    preserved_script: "Hi I'm Curtis, founder of PrimalPantry.",
    hook: "Hi I'm Curtis, founder of PrimalPantry.",
    hook_type: 'founder-direct',
    estimated_runtime: '0:05',
    timeline: [
      { timestamp: '0:00-0:05', spoken_line: "Hi I'm Curtis, founder of PrimalPantry.", broll: 'founder face-cam' },
    ],
    broll_shots: ['founder face-cam'],
    cta_placement: '0:04 — text overlay shop now',
    notes_for_editor: 'Lift natural pause before "PrimalPantry" if too punchy.',
  });
  assert.strictEqual(r.ok, true);
});

test('wrap_script: empty timeline fails', () => {
  const r = validateStageOutput('wrap_script', {
    preserved_script: 'x', hook: 'x', hook_type: 'y', estimated_runtime: '0:01',
    timeline: [], broll_shots: ['a'], cta_placement: 'end', notes_for_editor: '',
  });
  assert.strictEqual(r.ok, false);
});

test('validateStageOutput: unknown stage rejected', () => {
  const r = validateStageOutput('not_a_stage', {});
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /unknown stage/);
});

// --- strategy --------------------------------------------------------------
test('strategy: minimal valid passes', () => {
  const r = validateStageOutput('strategy', {
    primary_angle: 'Eczema mums needing fast relief at bath time.',
    audience_message_fit: 'Match: pain-point led with credibility lever (EANZ).',
    alternatives_considered: [{ angle: 'family-of-creams range', why_rejected: 'Diluted message; the brief is one product.' }],
    citations: ['c-uuid-1', 'p-uuid-2'],
    exemplar_strength: 'moderate',
    flags: [],
  });
  assert.strictEqual(r.ok, true);
});

test('strategy: missing primary_angle fails', () => {
  const r = validateStageOutput('strategy', {
    audience_message_fit: 'x', alternatives_considered: [], citations: [],
    exemplar_strength: 'moderate', flags: [],
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /primary_angle/);
});

test('strategy: invalid exemplar_strength enum fails', () => {
  const r = validateStageOutput('strategy', {
    primary_angle: 'x', audience_message_fit: 'x', alternatives_considered: [],
    citations: [], exemplar_strength: 'medium', flags: [],
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /exemplar_strength/);
});

// --- variants_ad -----------------------------------------------------------
function makeVariant(id) {
  return {
    variant_id: id,
    axis_explored: 'visual register',
    composition_pattern: 'product-on-textured-surface',
    visual_style: { palette: ['warm-cream'], lighting: 'soft window', subject_treatment: 'centered' },
    headline: 'Whipped tallow that soaks in.',
    body: 'For NZ winter dry skin.',
    cta: 'Shop now',
    image_prompt: 'A jar of whipped tallow on a linen cloth, warm window light',
    reference_image_ids: [],
  };
}

test('variants_ad: 4 variants pass', () => {
  const r = validateStageOutput('variants_ad', {
    variants: [makeVariant('v1'), makeVariant('v2'), makeVariant('v3'), makeVariant('v4')],
  });
  assert.strictEqual(r.ok, true);
});

test('variants_ad: 3 variants fails (spec requires 4-6)', () => {
  const r = validateStageOutput('variants_ad', {
    variants: [makeVariant('v1'), makeVariant('v2'), makeVariant('v3')],
  });
  assert.strictEqual(r.ok, false);
});

test('variants_ad: 7 variants fails (spec requires 4-6)', () => {
  const seven = Array.from({ length: 7 }, (_, i) => makeVariant(`v${i}`));
  const r = validateStageOutput('variants_ad', { variants: seven });
  assert.strictEqual(r.ok, false);
});

test('variants_ad: image_prompt with embedded text fails (Hard Rule #1)', () => {
  const v = makeVariant('v1');
  v.image_prompt = 'Hero shot of jar with text "Buy now" overlaid';
  const r = validateStageOutput('variants_ad', { variants: [v, makeVariant('v2'), makeVariant('v3'), makeVariant('v4')] });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /image_prompt|never render text/);
});

// --- outline ---------------------------------------------------------------
test('outline: minimal valid passes', () => {
  const r = validateStageOutput('outline', {
    structure_template: 'pain -> reframe -> demo -> CTA',
    beats: [
      { timestamp: '0:00', beat: 'Pain hook', broll: 'cracked hands' },
      { timestamp: '0:08', beat: 'Reframe', broll: null },
    ],
    estimated_runtime: '0:30',
  });
  assert.strictEqual(r.ok, true);
});

test('outline: empty beats array fails', () => {
  const r = validateStageOutput('outline', {
    structure_template: 'x', beats: [], estimated_runtime: '0:10',
  });
  assert.strictEqual(r.ok, false);
});

// --- hooks -----------------------------------------------------------------
function makeHook(id) {
  return {
    variant_id: id,
    archetype: 'pain_callout',
    opening_lines_verbatim: 'My hands cracked open every winter.',
    first_visual: 'close-up cracked hands',
    rationale: 'Top-quartile pain-callout pattern from c-uuid-7',
    citations: ['c-uuid-7'],
  };
}
test('hooks: 5 hooks pass', () => {
  const r = validateStageOutput('hooks', {
    hook_variants: [makeHook('h1'), makeHook('h2'), makeHook('h3'), makeHook('h4'), makeHook('h5')],
  });
  assert.strictEqual(r.ok, true);
});

test('hooks: 3 hooks fails', () => {
  const r = validateStageOutput('hooks', {
    hook_variants: [makeHook('h1'), makeHook('h2'), makeHook('h3')],
  });
  assert.strictEqual(r.ok, false);
});

// --- critique --------------------------------------------------------------
test('critique: ship verdict with high scores passes', () => {
  const r = validateStageOutput('critique', {
    scores: { brief_fit: 4, pattern_adherence: 5, hook_strength: 4, brand_fit: 5,
              anti_pattern_check: 'pass', retention_drop_signature_check: 'pass' },
    rationale: 'Solid hook + on-brand register.',
    verdict: 'ship',
    repair_instructions: null,
  });
  assert.strictEqual(r.ok, true);
});

test('critique: brief_fit<=2 forces verdict=replace (spec rule)', () => {
  const r = validateStageOutput('critique', {
    scores: { brief_fit: 2, pattern_adherence: 5, hook_strength: 5, brand_fit: 5,
              anti_pattern_check: 'pass', retention_drop_signature_check: 'pass' },
    rationale: 'x',
    verdict: 'repair',           // wrong: spec says must be replace
    repair_instructions: 'try again',
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /verdict must be "replace"/);
});

test('critique: anti_pattern_check=fail forces verdict=replace', () => {
  const r = validateStageOutput('critique', {
    scores: { brief_fit: 5, pattern_adherence: 5, hook_strength: 5, brand_fit: 5,
              anti_pattern_check: 'fail', retention_drop_signature_check: 'pass' },
    rationale: 'x',
    verdict: 'ship',             // wrong: must be replace
    repair_instructions: null,
  });
  assert.strictEqual(r.ok, false);
});

test('critique: hook_strength<=2 forces verdict=replace', () => {
  const r = validateStageOutput('critique', {
    scores: { brief_fit: 5, pattern_adherence: 5, hook_strength: 1, brand_fit: 5,
              anti_pattern_check: 'pass', retention_drop_signature_check: 'pass' },
    rationale: 'x',
    verdict: 'repair',           // wrong: must be replace
    repair_instructions: 'fix hook',
  });
  assert.strictEqual(r.ok, false);
});

test('critique: score outside 1-5 fails', () => {
  const r = validateStageOutput('critique', {
    scores: { brief_fit: 6, pattern_adherence: 5, hook_strength: 5, brand_fit: 5,
              anti_pattern_check: 'pass', retention_drop_signature_check: 'pass' },
    rationale: 'x', verdict: 'ship', repair_instructions: null,
  });
  assert.strictEqual(r.ok, false);
});

// --- feedback --------------------------------------------------------------
test('feedback: minimal valid passes', () => {
  const r = validateStageOutput('feedback', {
    diffs: [],
    edit_analysis: [],
    top_hypotheses: [],
    candidate_reasons_for_user_confirmation: [],
    user_note_reconciliation: null,
    generalizable: false,
    generalization_caveat: null,
    pattern_tags: [],
    confidence: 'low',
  });
  assert.strictEqual(r.ok, true);
});

test('feedback: invalid edit category fails', () => {
  const r = validateStageOutput('feedback', {
    diffs: [], edit_analysis: [{ category: 'banana', before: 'x', after: 'y', lesson: 'z' }],
    top_hypotheses: [], candidate_reasons_for_user_confirmation: [],
    user_note_reconciliation: null, generalizable: false, generalization_caveat: null,
    pattern_tags: [], confidence: 'low',
  });
  assert.strictEqual(r.ok, false);
});

test('feedback: invalid confidence fails', () => {
  const r = validateStageOutput('feedback', {
    diffs: [], edit_analysis: [],
    top_hypotheses: [], candidate_reasons_for_user_confirmation: [],
    user_note_reconciliation: null, generalizable: false, generalization_caveat: null,
    pattern_tags: [], confidence: 'meh',
  });
  assert.strictEqual(r.ok, false);
});

// --- playbook_extract ------------------------------------------------------
test('playbook_extract: minimal valid passes', () => {
  const r = validateStageOutput('playbook_extract', {
    proposed_patterns: [{
      pattern_type: 'hook_archetype',
      name: 'Pain callout opener',
      description: 'Opens with the customer\'s exact pain phrasing.',
      definition: { phrase_pattern: 'My X cracked open' },
      evidence_creative_ids: ['c1','c2','c3'],
    }],
    patterns_to_deprecate: [],
    proposed_anti_patterns: [],
    notes_for_operator: 'Three top-quartile records share this opener.',
  });
  assert.strictEqual(r.ok, true);
});

test('playbook_extract: pattern with <3 evidence fails (generalisation gate)', () => {
  const r = validateStageOutput('playbook_extract', {
    proposed_patterns: [{
      pattern_type: 'hook_archetype', name: 'x', description: 'y',
      definition: {}, evidence_creative_ids: ['c1','c2'],
    }],
    patterns_to_deprecate: [], proposed_anti_patterns: [], notes_for_operator: '',
  });
  assert.strictEqual(r.ok, false);
});

test('playbook_extract: invalid pattern_type fails', () => {
  const r = validateStageOutput('playbook_extract', {
    proposed_patterns: [{
      pattern_type: 'vibe_check', name: 'x', description: 'y',
      definition: {}, evidence_creative_ids: ['c1','c2','c3'],
    }],
    patterns_to_deprecate: [], proposed_anti_patterns: [], notes_for_operator: '',
  });
  assert.strictEqual(r.ok, false);
});
