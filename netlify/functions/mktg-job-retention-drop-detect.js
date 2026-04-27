/**
 * mktg-job-retention-drop-detect — cluster retention drops by script-line
 * characteristics, propose new retention_drop_signature patterns when 3+
 * drops match.
 *
 * Trigger (per spec §6.3): weekly. Video only.
 *
 * Approach: pull all performed video_scripts with retention_drops in the
 * performance JSON. Group by classification (the field comes pre-classified
 * from the platform when present, otherwise by line characteristics).
 * Any classification with 3+ matches becomes a proposal.
 */
const { sbSelect } = require('./_lib/ckf-sb.js');
const { propose, writeMemo, withRunLog } = require('./_lib/mktg-jobs.js');

const JOB = 'retention_drop_detect';
const MIN_MATCHES = 3;

exports.handler = withRunLog(JOB, async () => {
  const rows = await sbSelect(
    'mktg_creatives',
    `creative_type=eq.video_script&status=eq.performed&select=creative_id,performance&limit=200`
  );

  const buckets = new Map(); // key -> { lines: [], creative_ids: Set }
  let totalDrops = 0;
  for (const c of rows) {
    const drops = c.performance?.video_metrics?.retention_drops || [];
    for (const d of drops) {
      totalDrops++;
      const key = (d.classification || classifyByLine(d.line)).toLowerCase();
      if (!buckets.has(key)) buckets.set(key, { lines: [], creative_ids: new Set() });
      const b = buckets.get(key);
      b.lines.push(d.line);
      b.creative_ids.add(c.creative_id);
    }
  }

  let proposals_n = 0;
  const proposed = [];
  for (const [key, b] of buckets.entries()) {
    if (b.creative_ids.size < MIN_MATCHES) continue;
    proposed.push({ key, n: b.creative_ids.size });
    await propose({
      job: JOB, type: 'retention_drop_signature',
      payload: {
        pattern_type: 'retention_drop_signature',
        name: `Retention drop: ${key}`,
        description: `Retention drops classified as "${key}" appear in ${b.creative_ids.size} performed video scripts.`,
        definition: { phrase: key, sample_lines: b.lines.slice(0, 4) },
        evidence_creative_ids: [...b.creative_ids],
        audience_segments: [],
      },
      rationale: `${b.creative_ids.size} matches across ${totalDrops} total drops in ${rows.length} performed videos.`,
    });
    proposals_n++;
  }

  const memo_id = await writeMemo({
    kind: 'retention_drop_detect',
    content_md: `Analysed ${rows.length} performed videos containing ${totalDrops} retention drops in ${buckets.size} clusters. Proposed ${proposed.length} new retention_drop_signature patterns (>= ${MIN_MATCHES} matches).\n\n${proposed.map((p) => `- ${p.key}: ${p.n} matches`).join('\n')}`,
    signals: { videos_n: rows.length, drops_n: totalDrops, clusters_n: buckets.size, proposals_n },
  });
  return { skipped: false, reason: 'retention-drop clusters scanned', proposals_n, memo_id };
});

// Cheap fallback classifier for drops that arrive without a platform-given label.
function classifyByLine(line) {
  if (!line) return 'unknown';
  const l = String(line).toLowerCase();
  if (/(\bhey\b|\bwhat'?s up\b|welcome back)/.test(l)) return 'channel_intro';
  if (/(have you ever|imagine if|did you know)/.test(l)) return 'generic_question_hook';
  if (/(buy now|shop now|click the link|order today)/.test(l)) return 'early_cta';
  if (/(let me explain|in this video|today i'?ll)/.test(l)) return 'definitional_preamble';
  if (/(actually|so basically|um|uh)/.test(l)) return 'filler_word';
  return 'misc';
}
