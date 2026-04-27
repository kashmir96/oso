/**
 * mktg-job-playbook-extract — proposes new patterns + flags retiring ones.
 *
 * Trigger (per spec §6.3): every 25 new `performed` records OR monthly,
 * whichever first. Proposed patterns require operator approval before
 * going active (generalisation gate, Hard Req #7).
 *
 * Schedule: daily at 03:00 NZST. Threshold gate inside the function gates
 * actual execution.
 */
const { sbSelect } = require('./_lib/ckf-sb.js');
const { runStage } = require('./_lib/mktg-agent.js');
const { lastSuccessfulRun, countSince, propose, writeMemo, withRunLog } = require('./_lib/mktg-jobs.js');

const JOB = 'playbook_extract';
const NEW_RECORDS_THRESHOLD = 25;
const MONTHLY_FALLBACK_DAYS = 30;

exports.handler = withRunLog(JOB, async () => {
  const lastRun = await lastSuccessfulRun(JOB);
  const newPerformed = await countSince('mktg_creatives', lastRun, 'status=eq.performed');
  const ageDays = lastRun ? (Date.now() - new Date(lastRun).getTime()) / 86_400_000 : Infinity;

  if (newPerformed < NEW_RECORDS_THRESHOLD && ageDays < MONTHLY_FALLBACK_DAYS) {
    return { skipped: true, reason: `${newPerformed} new performed; ${ageDays.toFixed(1)}d since last run` };
  }

  // Pull top + bottom quartile of recent performed records as the corpus_sample.
  const recent = await sbSelect(
    'mktg_creatives',
    `status=eq.performed&order=performed_at.desc&limit=80&select=creative_id,creative_type,brief,components,pattern_tags,performance,generalizable`
  );
  const sorted = recent
    .filter((c) => typeof c.performance?.percentile_within_account === 'number')
    .sort((a, b) => b.performance.percentile_within_account - a.performance.percentile_within_account);
  const q = Math.max(3, Math.floor(sorted.length / 4));
  const top = sorted.slice(0, q);
  const bottom = sorted.slice(-q);
  const sample = [...top, ...bottom].map((c) => ({
    creative_id: c.creative_id, creative_type: c.creative_type,
    pattern_tags: c.pattern_tags, percentile: c.performance.percentile_within_account,
    components: c.components,
  }));

  if (sample.length === 0) {
    const memo_id = await writeMemo({
      kind: 'playbook_extract',
      content_md: 'No performed records with percentile_within_account yet -- nothing to extract.',
      signals: { sample_n: 0 },
    });
    return { skipped: true, reason: 'no performed records to sample', memo_id };
  }

  const result = await runStage({
    user_id: null, creative_id: null,
    stage: 'playbook_extract',
    brief: { objective: 'extract patterns from recent performed corpus', creative_type: 'ad' },
    opts: { extra: { corpus_sample: sample } },
  });

  if (!result.ok) {
    return { skipped: false, reason: `agent failed: ${result.validation_error || result.error}`, proposals_n: 0 };
  }

  const out = result.parsed;
  let proposals_n = 0;

  for (const p of (out.proposed_patterns || [])) {
    await propose({ job: JOB, type: 'pattern', payload: p, rationale: out.notes_for_operator || null });
    proposals_n++;
  }
  for (const a of (out.proposed_anti_patterns || [])) {
    await propose({ job: JOB, type: 'anti_pattern', payload: a, rationale: out.notes_for_operator || null });
    proposals_n++;
  }
  for (const d of (out.patterns_to_deprecate || [])) {
    await propose({ job: JOB, type: 'pattern_deprecate', payload: d, rationale: d.reason || null });
    proposals_n++;
  }

  const memo_id = await writeMemo({
    kind: 'playbook_extract',
    content_md: `Sampled ${sample.length} (top + bottom quartile of ${sorted.length}). Proposed ${out.proposed_patterns?.length || 0} patterns, ${out.proposed_anti_patterns?.length || 0} anti-patterns, ${out.patterns_to_deprecate?.length || 0} deprecations.\n\n${out.notes_for_operator || ''}`,
    signals: { sample_n: sample.length, proposals_n, retried: result.retried, cost_usd: result.cost_usd },
  });

  return { skipped: false, reason: 'proposals generated', proposals_n, memo_id };
});
