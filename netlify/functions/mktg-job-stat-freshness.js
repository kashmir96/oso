/**
 * mktg-job-stat-freshness — quarterly re-verification surface.
 *
 * Trigger (per spec §6.3): quarterly. Surfaces every social_proof entry
 * with type='stat' AND every current_brand_facts field for the operator
 * to re-verify. No agent call -- pure listing.
 *
 * Schedule: 1st of every 3rd month at 09:00.
 */
const { sbSelect } = require('./_lib/ckf-sb.js');
const { propose, writeMemo, withRunLog } = require('./_lib/mktg-jobs.js');

const JOB = 'stat_freshness';

exports.handler = withRunLog(JOB, async () => {
  const stats = await sbSelect(
    'mktg_social_proof',
    `type=eq.stat&current=eq.true&select=proof_id,content,source,captured_at&limit=200`
  );
  const facts = await sbSelect('mktg_current_brand_facts', 'id=eq.singleton&select=facts,updated_at&limit=1');
  const factRow = facts?.[0];

  let proposals_n = 0;
  for (const s of stats) {
    await propose({
      job: JOB, type: 'stat_check',
      payload: { proof_id: s.proof_id, content: s.content, source: s.source, captured_at: s.captured_at },
      rationale: 'Quarterly re-verification: confirm this stat is still accurate or update with current value.',
    });
    proposals_n++;
  }
  // Single proposal for the brand_facts singleton, listing every key.
  if (factRow?.facts && Object.keys(factRow.facts).length > 0) {
    await propose({
      job: JOB, type: 'stat_check',
      payload: {
        kind: 'current_brand_facts', facts: factRow.facts, last_updated: factRow.updated_at,
      },
      rationale: 'Quarterly: re-verify customer count, team size, location, EANZ commitment, etc.',
    });
    proposals_n++;
  }

  const memo_id = await writeMemo({
    kind: 'stat_freshness',
    content_md: `Surfaced ${stats.length} social_proof stats + ${factRow?.facts ? Object.keys(factRow.facts).length : 0} current_brand_facts fields for re-verification.`,
    signals: { stats_n: stats.length, facts_n: factRow?.facts ? Object.keys(factRow.facts).length : 0 },
  });

  return { skipped: false, reason: 'stat-freshness proposals queued', proposals_n, memo_id };
});
