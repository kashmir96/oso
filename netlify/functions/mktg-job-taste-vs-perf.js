/**
 * mktg-job-taste-vs-perf — taste-vs-performance audit.
 *
 * Trigger (per spec §6.3): every 25 new `performed` records.
 *
 * Of `user_approved` creatives that later became `performed`, what % landed
 * in the top quartile? If <40%, surface to operator: "the agent's taste is
 * diverging from market -- review weight on user_approved signal."
 *
 * Bootstrap-friendly: surfaces low-confidence early signal too (per §8) but
 * marks it as such.
 */
const { sbSelect } = require('./_lib/ckf-sb.js');
const { lastSuccessfulRun, countSince, propose, writeMemo, withRunLog } = require('./_lib/mktg-jobs.js');

const JOB = 'taste_vs_performance';
const NEW_RECORDS_THRESHOLD = 25;
const DIVERGENCE_THRESHOLD_PCT = 40;
const HIGH_CONFIDENCE_N = 25;

exports.handler = withRunLog(JOB, async () => {
  const lastRun = await lastSuccessfulRun(JOB);
  const newPerformed = await countSince('mktg_creatives', lastRun, 'status=eq.performed');
  if (newPerformed < NEW_RECORDS_THRESHOLD) {
    return { skipped: true, reason: `${newPerformed} new performed < ${NEW_RECORDS_THRESHOLD}` };
  }

  const performed = await sbSelect(
    'mktg_creatives',
    `status=eq.performed&select=creative_id,approval_reason,feedback_analysis,performance&limit=400`
  );
  // Heuristic: every performed creative passed through user_approved at
  // some point -- approval_reason or feedback_analysis is non-null.
  const approved = performed.filter((c) => c.approval_reason || c.feedback_analysis);
  if (approved.length === 0) {
    return { skipped: true, reason: 'no user_approved -> performed creatives yet' };
  }
  const topQ = approved.filter((c) => (c.performance?.percentile_within_account ?? 0) >= 75);
  const pctTop = (topQ.length / approved.length) * 100;
  const lowConfidence = approved.length < HIGH_CONFIDENCE_N;

  let proposals_n = 0;
  let action = 'no action -- taste matches market';
  if (pctTop < DIVERGENCE_THRESHOLD_PCT) {
    action = `taste diverging: only ${pctTop.toFixed(0)}% of approved creatives landed in top quartile (threshold ${DIVERGENCE_THRESHOLD_PCT}%)`;
    await propose({
      job: JOB, type: 'taste_audit_action',
      payload: {
        approved_n: approved.length,
        top_quartile_n: topQ.length,
        pct_top_quartile: pctTop,
        low_confidence: lowConfidence,
      },
      rationale: `Of ${approved.length} approved-then-performed creatives, only ${topQ.length} (${pctTop.toFixed(0)}%) landed in top quartile. ${lowConfidence ? 'Low N (<25) -- treat as early signal.' : ''} Review weight on user_approved signal in retrieval scoring.`,
    });
    proposals_n++;
  }

  const memo_id = await writeMemo({
    kind: 'taste_vs_performance',
    content_md: `Approved-and-performed: ${approved.length}. Top-quartile: ${topQ.length} (${pctTop.toFixed(0)}%). ${lowConfidence ? '\n\nLow-confidence early signal (N < 25).' : ''}\n\n**${action}**`,
    signals: { approved_n: approved.length, top_quartile_n: topQ.length, pct_top_quartile: pctTop, low_confidence: lowConfidence, divergence: pctTop < DIVERGENCE_THRESHOLD_PCT },
  });
  return { skipped: false, reason: action, proposals_n, memo_id };
});
