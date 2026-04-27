// Lifecycle state-machine + invariant tests for the creative-agent.
// Covers 6.1 transitions and 3.1 required-by-status invariants.
// Run: node --test netlify/functions/__tests__/mktg-lifecycle.test.js
const test = require('node:test');
const assert = require('node:assert');
const {
  ALLOWED_TRANSITIONS,
  isValidStatus,
  canTransition,
  transition,
  validateDraftedInsert,
} = require('../_lib/mktg-lifecycle.js');

// --- Status enum -----------------------------------------------------------
test('isValidStatus: known statuses pass, unknown fail', () => {
  for (const s of ['drafted','user_approved','user_rejected','shipped','performed']) {
    assert.strictEqual(isValidStatus(s), true, `${s} should be valid`);
  }
  for (const s of ['', 'live', 'approved', 'unknown', null, undefined]) {
    assert.strictEqual(isValidStatus(s), false, `${s} should be invalid`);
  }
});

// --- Allowed transitions (the state machine) -------------------------------
test('canTransition: spec 6.1 arrows are the only valid edges', () => {
  // Valid edges from spec
  assert.ok(canTransition('drafted', 'user_approved'));
  assert.ok(canTransition('drafted', 'user_rejected'));
  assert.ok(canTransition('user_approved', 'shipped'));
  assert.ok(canTransition('shipped', 'performed'));

  // Invalid: skipping states
  assert.ok(!canTransition('drafted', 'shipped'),   'drafted -> shipped must skip user_approved');
  assert.ok(!canTransition('drafted', 'performed'), 'drafted -> performed must skip everything');
  assert.ok(!canTransition('user_approved', 'performed'), 'must ship before performing');

  // Invalid: terminal states have no outgoing edges
  assert.deepStrictEqual(ALLOWED_TRANSITIONS.user_rejected, []);
  assert.deepStrictEqual(ALLOWED_TRANSITIONS.performed, []);

  // Invalid: backwards
  assert.ok(!canTransition('user_approved', 'drafted'),  'no rewinds');
  assert.ok(!canTransition('shipped', 'user_approved'),  'no rewinds');
  assert.ok(!canTransition('performed', 'shipped'),      'no rewinds');

  // Invalid: cross-branch (rejected -> approved etc.)
  assert.ok(!canTransition('user_rejected', 'user_approved'));
  assert.ok(!canTransition('user_rejected', 'shipped'));
});

// --- transition() -- happy paths --------------------------------------------
test('transition: drafted -> user_approved with approval_reason', () => {
  const current = { status: 'drafted', brief: {}, components: {} };
  const { patch } = transition(current, 'user_approved', { approval_reason: 'Hits the eczema mum directly.' });
  assert.strictEqual(patch.status, 'user_approved');
  assert.strictEqual(patch.approval_reason, 'Hits the eczema mum directly.');
  assert.ok(patch.updated_at);
});

test('transition: drafted -> user_approved with feedback_analysis instead of approval_reason', () => {
  const current = { status: 'drafted' };
  const { patch } = transition(current, 'user_approved', {
    feedback_analysis: { diffs: [], confidence: 'medium' },
  });
  assert.strictEqual(patch.status, 'user_approved');
  assert.ok(patch.feedback_analysis);
});

test('transition: drafted -> user_rejected with feedback_analysis', () => {
  const current = { status: 'drafted' };
  const { patch } = transition(current, 'user_rejected', {
    feedback_analysis: { diffs: [{ dimension: 'hook', chosen_trait: 'x', rejected_trait: 'y', rejected_variant_ids: ['v1'], hypothesis: 'h' }] },
  });
  assert.strictEqual(patch.status, 'user_rejected');
});

test('transition: user_approved -> shipped auto-stamps shipped_at', () => {
  const current = { status: 'user_approved', approval_reason: 'r' };
  const { patch } = transition(current, 'shipped');
  assert.strictEqual(patch.status, 'shipped');
  assert.ok(patch.shipped_at, 'shipped_at must be auto-stamped');
});

test('transition: shipped -> performed requires performance + percentile', () => {
  const current = { status: 'shipped', shipped_at: '2026-04-01T00:00:00Z' };
  const { patch } = transition(current, 'performed', {
    performance: { percentile_within_account: 78, ad_metrics: { impressions: 1000, ctr: 0.025 } },
  });
  assert.strictEqual(patch.status, 'performed');
  assert.ok(patch.performed_at);
  assert.strictEqual(patch.performance.percentile_within_account, 78);
});

// --- transition() -- invariant failures -------------------------------------
test('transition: user_approved without approval_reason OR feedback_analysis throws', () => {
  const current = { status: 'drafted' };
  assert.throws(() => transition(current, 'user_approved'), /requires approval_reason or feedback_analysis/);
});

test('transition: user_rejected without feedback_analysis throws', () => {
  const current = { status: 'drafted' };
  assert.throws(() => transition(current, 'user_rejected'), /requires feedback_analysis/);
});

test('transition: performed without performance throws', () => {
  const current = { status: 'shipped', shipped_at: '2026-04-01T00:00:00Z' };
  assert.throws(() => transition(current, 'performed'), /requires performance object/);
});

test('transition: performed without percentile throws', () => {
  const current = { status: 'shipped', shipped_at: '2026-04-01T00:00:00Z' };
  assert.throws(
    () => transition(current, 'performed', { performance: { ad_metrics: {} } }),
    /requires performance.percentile_within_account/
  );
});

test('transition: percentile out of 0-100 range throws', () => {
  const current = { status: 'shipped', shipped_at: '2026-04-01T00:00:00Z' };
  assert.throws(
    () => transition(current, 'performed', { performance: { percentile_within_account: 150 } }),
    /must be 0-100/
  );
});

// --- transition() -- illegal edges ------------------------------------------
test('transition: drafted -> shipped throws (must approve first)', () => {
  const current = { status: 'drafted', brief: {}, components: {} };
  assert.throws(() => transition(current, 'shipped'), /not allowed/);
});

test('transition: performed -> shipped throws (terminal)', () => {
  const current = { status: 'performed', performance: { percentile_within_account: 50 } };
  assert.throws(() => transition(current, 'shipped'), /not allowed/);
});

test('transition: user_rejected has no outgoing edges', () => {
  const current = { status: 'user_rejected', feedback_analysis: {} };
  for (const target of ['user_approved','shipped','performed','drafted']) {
    assert.throws(() => transition(current, target), /not allowed/);
  }
});

test('transition: invalid target status throws', () => {
  const current = { status: 'drafted' };
  assert.throws(() => transition(current, 'live'), /invalid target status/);
});

// --- validateDraftedInsert() -----------------------------------------------
test('validateDraftedInsert: valid drafted row passes', () => {
  const row = {
    brief: { objective: 'eczema mums' },
    components: { headline: 'Soothe it' },
    exemplars_used: [],
  };
  assert.strictEqual(validateDraftedInsert(row), null);
});

test('validateDraftedInsert: missing brief fails', () => {
  const row = { components: {}, exemplars_used: [] };
  assert.match(validateDraftedInsert(row), /requires brief/);
});

test('validateDraftedInsert: missing components fails', () => {
  const row = { brief: {}, exemplars_used: [] };
  assert.match(validateDraftedInsert(row), /requires components/);
});

test('validateDraftedInsert: missing exemplars_used array fails', () => {
  const row = { brief: {}, components: {} };
  assert.match(validateDraftedInsert(row), /requires exemplars_used array/);
});

test('validateDraftedInsert: status other than drafted on insert fails', () => {
  const row = { status: 'shipped', brief: {}, components: {}, exemplars_used: [] };
  assert.match(validateDraftedInsert(row), /must be drafted on insert/);
});
