/**
 * mktg-jobs.js — shared utilities for the lifecycle background jobs.
 *
 * - lastSuccessfulRun(job)   -> ISO timestamp of last 'ok' run, or null
 * - countSince(table, ts)    -> count of rows created since timestamp
 * - logRun({...})            -> insert mktg_job_runs row, returns the run_id
 * - propose({...})           -> insert mktg_pending_proposals row
 * - writeMemo({...})         -> insert mktg_audit_memos row
 * - withRunLog(job, fn)      -> wraps a job: stamps start, logs outcome.
 *
 * Each job function receives { ctx } with helpers + does its own threshold
 * check at the top (so cron + threshold both gate execution).
 */
const { sbSelect, sbInsert } = require('./ckf-sb.js');

async function lastSuccessfulRun(job) {
  const rows = await sbSelect(
    'mktg_job_runs',
    `job=eq.${encodeURIComponent(job)}&outcome=eq.ok&order=ran_at.desc&limit=1&select=ran_at`
  );
  return rows?.[0]?.ran_at || null;
}

async function countSince(table, isoTimestamp, extraFilter = '') {
  const filter = isoTimestamp
    ? `created_at=gte.${encodeURIComponent(isoTimestamp)}${extraFilter ? `&${extraFilter}` : ''}`
    : extraFilter || '';
  // PostgREST exact count: HEAD with Prefer count=exact would be cleaner but
  // sbSelect doesn't expose that. Fall back to a small select + length.
  // For threshold gates a few hundred is fine.
  const rows = await sbSelect(table, `select=created_at&${filter}&limit=1000`);
  return rows.length;
}

async function logRun({ job, outcome, reason, proposals_n = 0, memo_id = null, started_at }) {
  const duration_ms = started_at ? Date.now() - started_at : null;
  const row = await sbInsert('mktg_job_runs', {
    job, outcome, reason, proposals_n, memo_id, duration_ms,
  });
  return Array.isArray(row) ? row[0]?.run_id : row?.run_id;
}

async function propose({ job, type, payload, rationale = null }) {
  const row = await sbInsert('mktg_pending_proposals', {
    job, type, payload, rationale,
  });
  return Array.isArray(row) ? row[0]?.proposal_id : row?.proposal_id;
}

async function writeMemo({ kind, content_md, signals = null }) {
  const row = await sbInsert('mktg_audit_memos', { kind, content_md, signals });
  return Array.isArray(row) ? row[0]?.memo_id : row?.memo_id;
}

/**
 * withRunLog — wrap a job function so its outcome always lands in
 * mktg_job_runs. Catches errors so a failure doesn't crash the netlify
 * scheduled invocation (which would otherwise auto-retry).
 *
 * The wrapped function should return:
 *   { skipped, reason, proposals_n, memo_id }
 * or throw.
 */
function withRunLog(job, fn) {
  return async () => {
    const started_at = Date.now();
    try {
      const r = await fn();
      const outcome = r?.skipped ? 'skipped_threshold' : 'ok';
      await logRun({
        job, outcome,
        reason: r?.reason || null,
        proposals_n: r?.proposals_n || 0,
        memo_id: r?.memo_id || null,
        started_at,
      });
      return { statusCode: 200, body: JSON.stringify({ job, outcome, ...r }) };
    } catch (e) {
      console.error(`[mktg-job ${job}]`, e);
      try { await logRun({ job, outcome: 'error', reason: String(e?.message || e).slice(0, 500), started_at }); } catch (_) {}
      return { statusCode: 500, body: JSON.stringify({ job, error: e?.message || 'job failed' }) };
    }
  };
}

module.exports = {
  lastSuccessfulRun,
  countSince,
  logRun,
  propose,
  writeMemo,
  withRunLog,
};
