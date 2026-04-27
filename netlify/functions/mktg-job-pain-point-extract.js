/**
 * mktg-job-pain-point-extract — re-cluster review verbatims into pain points.
 *
 * Trigger (per spec §6.3): every 50 new reviews. Re-extracts pain points,
 * proposes new ones, deprecates ones with no recent references.
 *
 * Schedule: daily at 03:30 NZST. Threshold gate inside.
 */
const { sbSelect } = require('./_lib/ckf-sb.js');
const { runStage } = require('./_lib/mktg-agent.js');
const { lastSuccessfulRun, countSince, propose, writeMemo, withRunLog } = require('./_lib/mktg-jobs.js');

const JOB = 'pain_point_extract';
const NEW_REVIEWS_THRESHOLD = 50;

exports.handler = withRunLog(JOB, async () => {
  const lastRun = await lastSuccessfulRun(JOB);
  const newReviews = await countSince('mktg_reviews', lastRun);
  if (newReviews < NEW_REVIEWS_THRESHOLD) {
    return { skipped: true, reason: `${newReviews} new reviews < ${NEW_REVIEWS_THRESHOLD} threshold` };
  }

  // Pull recent verbatims + raw text. Cap so we don't blow the token budget.
  const reviews = await sbSelect(
    'mktg_reviews',
    `select=review_id,verbatim_phrases,raw_text,rating&order=captured_at.desc&limit=200`
  );
  const existing = await sbSelect('mktg_pain_points', 'select=pain_point_id,name,description,active&active=eq.true&limit=100');

  // Use playbook_extract stage as the closest match -- it's the spec's
  // pattern-proposal mechanism. We frame pain-point extraction as
  // "structural patterns over review verbatims". The model returns
  // proposed_patterns; we re-route them to mktg_pending_proposals as
  // type='pain_point'.
  const sample = reviews
    .map((r) => ({
      review_id: r.review_id, rating: r.rating,
      verbatims: Array.isArray(r.verbatim_phrases) ? r.verbatim_phrases.slice(0, 4) : [],
      snippet: (r.raw_text || '').slice(0, 220),
    })).slice(0, 80);

  const result = await runStage({
    user_id: null,
    stage: 'playbook_extract',
    brief: { objective: 'cluster review verbatims into pain_point candidates', creative_type: 'ad' },
    opts: {
      extra: {
        corpus_sample: sample,
        existing_pain_points: existing.map((p) => ({ id: p.pain_point_id, name: p.name })),
        instruction: 'Treat each proposed_pattern as a pain_point candidate: name = pain summary, description = symptom/trigger language, definition = { example_phrasings: [3-5 verbatim snippets] }. Treat patterns_to_deprecate as pain_point_ids that no longer appear in recent reviews.',
      },
    },
  });

  if (!result.ok) {
    return { skipped: false, reason: `agent failed: ${result.validation_error || result.error}` };
  }

  let proposals_n = 0;
  for (const p of (result.parsed.proposed_patterns || [])) {
    await propose({ job: JOB, type: 'pain_point', payload: p, rationale: result.parsed.notes_for_operator || null });
    proposals_n++;
  }
  for (const d of (result.parsed.patterns_to_deprecate || [])) {
    await propose({ job: JOB, type: 'pain_point_deprecate', payload: d, rationale: d.reason || null });
    proposals_n++;
  }

  const memo_id = await writeMemo({
    kind: 'pain_point_extract',
    content_md: `Reviewed ${sample.length} recent reviews. Proposed ${result.parsed.proposed_patterns?.length || 0} pain points; ${result.parsed.patterns_to_deprecate?.length || 0} deprecations.\n\n${result.parsed.notes_for_operator || ''}`,
    signals: { reviews_sampled: sample.length, proposals_n, cost_usd: result.cost_usd },
  });
  return { skipped: false, reason: 'pain-point proposals generated', proposals_n, memo_id };
});
