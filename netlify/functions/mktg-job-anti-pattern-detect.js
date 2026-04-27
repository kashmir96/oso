/**
 * mktg-job-anti-pattern-detect — flag patterns appearing in bottom-quartile
 * records 3+ times.
 *
 * Trigger (per spec §6.3): weekly.
 *
 * Approach: read all performed creatives, compute account-level percentile,
 * pull the bottom quartile, count pattern_tags occurrences. Any tag that
 * appears 3+ times in the bottom and rarely in the top becomes a proposal.
 * No agent call -- pure pattern stats.
 */
const { sbSelect } = require('./_lib/ckf-sb.js');
const { propose, writeMemo, withRunLog } = require('./_lib/mktg-jobs.js');

const JOB = 'anti_pattern_detect';
const MIN_BOTTOM_OCCURRENCES = 3;
const MAX_TOP_OCCURRENCES = 1;     // appearing once in top is ok; 2+ means it sometimes works

exports.handler = withRunLog(JOB, async () => {
  const rows = await sbSelect(
    'mktg_creatives',
    `status=eq.performed&select=creative_id,pattern_tags,performance&limit=400`
  );
  const scored = rows
    .filter((c) => typeof c.performance?.percentile_within_account === 'number')
    .sort((a, b) => b.performance.percentile_within_account - a.performance.percentile_within_account);
  if (scored.length < 8) {
    return { skipped: true, reason: `only ${scored.length} performed records; need 8+ for quartile analysis` };
  }
  const q = Math.max(2, Math.floor(scored.length / 4));
  const top = scored.slice(0, q);
  const bottom = scored.slice(-q);

  function tally(arr) {
    const counts = new Map();
    for (const c of arr) for (const t of (c.pattern_tags || [])) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    return counts;
  }
  const topCounts = tally(top);
  const botCounts = tally(bottom);

  let proposals_n = 0;
  const flagged = [];
  for (const [tag, n] of botCounts.entries()) {
    if (n < MIN_BOTTOM_OCCURRENCES) continue;
    if ((topCounts.get(tag) || 0) > MAX_TOP_OCCURRENCES) continue; // not always bad
    flagged.push({ tag, bottom: n, top: topCounts.get(tag) || 0 });
    await propose({
      job: JOB, type: 'anti_pattern',
      payload: {
        pattern_type: 'anti_pattern',
        name: `Anti-pattern: ${tag}`,
        description: `Tag "${tag}" appears in ${n} bottom-quartile records and only ${topCounts.get(tag) || 0} top-quartile -- likely an anti-pattern.`,
        definition: { phrase: tag },
        evidence_creative_ids: bottom.filter((c) => (c.pattern_tags || []).includes(tag)).map((c) => c.creative_id),
        audience_segments: [],
      },
      rationale: `${n} bottom-quartile vs ${topCounts.get(tag) || 0} top-quartile occurrences over ${scored.length} performed records.`,
    });
    proposals_n++;
  }

  const memo_id = await writeMemo({
    kind: 'anti_pattern_detect',
    content_md: `Analysed ${scored.length} performed records (${q}/quartile). Flagged ${flagged.length} anti-pattern candidates.\n\n${flagged.map((f) => `- ${f.tag}: ${f.bottom} bottom / ${f.top} top`).join('\n')}`,
    signals: { performed_n: scored.length, flagged_n: flagged.length },
  });
  return { skipped: false, reason: `${flagged.length} anti-pattern candidates`, proposals_n, memo_id };
});
