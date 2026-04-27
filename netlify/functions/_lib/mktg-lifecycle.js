/**
 * mktg-lifecycle.js — creative-agent state machine + required-by-status
 * invariants. Implements §6.1 (status lifecycle) and §3.1 (required fields)
 * of primalpantry_creative_agent_schema.md.
 *
 * App code never writes status directly to mktg_creatives — it goes through
 * `transition()` here, which:
 *   1. Asserts the from→to edge exists.
 *   2. Asserts the required-by-status invariants for the new status.
 *   3. Returns the patch object the caller writes via sbUpdate.
 *
 * The DB layer has belt-and-braces CHECK constraints that enforce the same
 * invariants for fields that must be non-null at insert time, but those
 * can't see prior state. The state-machine arrows live here.
 */

// Status machine. Each key is FROM, value is array of allowed TO states.
//
// Two main flows once an AI draft is approved:
//   user_approved -> shipped                (Curtis launches it himself)
//   user_approved -> submitted              (Curtis sends to assistant queue)
//                  -> in_production         (assistant claims)
//                  -> needs_approval        (assistant uploads asset)
//                  -> user_approved         (Curtis approves the produced asset)
//                  OR -> in_production      (Curtis requests changes)
//                  -> shipped -> performed
const ALLOWED_TRANSITIONS = {
  drafted:        ['user_approved', 'user_rejected'],
  user_approved:  ['shipped', 'submitted'],
  user_rejected:  [],                  // terminal
  submitted:      ['in_production'],
  in_production:  ['needs_approval'],
  needs_approval: ['user_approved', 'in_production'], // approved (back to ready) or send back for changes
  shipped:        ['performed'],
  performed:      [],                  // terminal — re-performed updates the same row in place
};

const VALID_STATUSES = new Set(Object.keys(ALLOWED_TRANSITIONS));

function isValidStatus(s) { return VALID_STATUSES.has(s); }

function canTransition(from, to) {
  if (!isValidStatus(from) || !isValidStatus(to)) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// ─── Required-by-status invariants (§3.1) ──────────────────────────────────
// Each function returns null if invariants pass, or a string error if not.
const INVARIANTS = {
  drafted(c) {
    if (!c.brief || typeof c.brief !== 'object')          return 'drafted requires brief';
    if (!c.components || typeof c.components !== 'object') return 'drafted requires components';
    if (!Array.isArray(c.exemplars_used))                  return 'drafted requires exemplars_used array';
    return null;
  },
  user_approved(c) {
    if (!c.approval_reason && !c.feedback_analysis) {
      return 'user_approved requires approval_reason or feedback_analysis';
    }
    return null;
  },
  user_rejected(c) {
    if (!c.feedback_analysis) return 'user_rejected requires feedback_analysis (why it was rejected)';
    return null;
  },
  submitted(c) {
    if (!c.submitted_at) return 'submitted requires submitted_at timestamp';
    return null;
  },
  in_production(c) {
    // No required fields beyond status -- assistant just claims the row.
    return null;
  },
  needs_approval(c) {
    // production_asset_url is the artifact for review, but the assistant might
    // upload notes only on a re-claim, so we accept either.
    return null;
  },
  shipped(c) {
    if (!c.shipped_at) return 'shipped requires shipped_at timestamp';
    return null;
  },
  performed(c) {
    if (!c.performance || typeof c.performance !== 'object') return 'performed requires performance object';
    const pct = c.performance?.percentile_within_account;
    if (pct === undefined || pct === null) return 'performed requires performance.percentile_within_account';
    if (typeof pct !== 'number' || pct < 0 || pct > 100) return 'performance.percentile_within_account must be 0-100';
    return null;
  },
};

/**
 * Validate a transition and produce the patch object to write.
 *
 * @param {object}  current     The creative row as it exists now (must include status).
 * @param {string}  toStatus    The target status.
 * @param {object} [extras]     Fields to merge into the patch (approval_reason,
 *                              feedback_analysis, performance, etc.). The
 *                              merged-in fields ARE used to evaluate
 *                              invariants, so the caller can pass new fields
 *                              that aren't yet on `current`.
 * @returns {{ patch: object }} Patch ready for sbUpdate (status + extras +
 *                              auto-stamped timestamps where relevant).
 * @throws {Error}              If the transition or invariants fail.
 */
function transition(current, toStatus, extras = {}) {
  if (!current || typeof current !== 'object') throw new Error('transition: current row required');
  const fromStatus = current.status;
  if (!isValidStatus(toStatus)) throw new Error(`transition: invalid target status "${toStatus}"`);
  if (!canTransition(fromStatus, toStatus)) {
    throw new Error(`transition: ${fromStatus} → ${toStatus} not allowed (allowed from ${fromStatus}: ${ALLOWED_TRANSITIONS[fromStatus]?.join(', ') || 'none'})`);
  }

  // Merge extras onto current for invariant evaluation; auto-stamp timestamps.
  const merged = { ...current, ...extras, status: toStatus };
  if (toStatus === 'shipped'   && !merged.shipped_at)   merged.shipped_at   = new Date().toISOString();
  if (toStatus === 'performed' && !merged.performed_at) merged.performed_at = new Date().toISOString();
  if (toStatus === 'submitted' && !merged.submitted_at) merged.submitted_at = new Date().toISOString();
  // Re-approval after needs_approval re-stamps approved_at; first user_approved
  // (from drafted) doesn't.
  if (toStatus === 'user_approved' && current.status === 'needs_approval' && !merged.approved_at) {
    merged.approved_at = new Date().toISOString();
  }

  const invariantErr = INVARIANTS[toStatus](merged);
  if (invariantErr) throw new Error(`transition: invariant violated — ${invariantErr}`);

  // Build the minimal patch (don't echo back unchanged fields).
  const patch = { status: toStatus, updated_at: new Date().toISOString() };
  for (const k of Object.keys(extras)) patch[k] = extras[k];
  if (toStatus === 'shipped'   && !patch.shipped_at)   patch.shipped_at   = merged.shipped_at;
  if (toStatus === 'performed' && !patch.performed_at) patch.performed_at = merged.performed_at;
  if (toStatus === 'submitted' && !patch.submitted_at) patch.submitted_at = merged.submitted_at;
  if (toStatus === 'user_approved' && current.status === 'needs_approval' && !patch.approved_at) {
    patch.approved_at = merged.approved_at;
  }
  return { patch };
}

/**
 * Validate a fresh row about to be inserted at status='drafted'. Used by the
 * agent service when a new creative is created from a brief.
 *
 * @returns {string|null} null if valid, or human-readable error.
 */
function validateDraftedInsert(row) {
  if (row.status && row.status !== 'drafted') {
    return `validateDraftedInsert: status must be drafted on insert, got "${row.status}"`;
  }
  return INVARIANTS.drafted(row);
}

module.exports = {
  ALLOWED_TRANSITIONS,
  VALID_STATUSES,
  isValidStatus,
  canTransition,
  transition,
  validateDraftedInsert,
  INVARIANTS,
};
