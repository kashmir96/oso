/**
 * mktg-job-self-audit — monthly agent self-audit (spec §7.3).
 *
 * The agent reviews its own outputs:
 *   - Are guardrails being respected? (random sample of recent creatives)
 *   - Are citations load-bearing or decorative?
 *   - Critic kill rate over time -- killing too few = rubber-stamping;
 *     killing everything = uncalibrated.
 *   - Is generalizable=false getting used appropriately or as escape hatch?
 *
 * Output: a one-page memo into mktg_audit_memos. Operator reads on dashboard.
 *
 * Schedule: monthly, 1st of month at 04:00.
 */
const { sbSelect } = require('./_lib/ckf-sb.js');
const { runStage } = require('./_lib/mktg-agent.js');
const { writeMemo, withRunLog } = require('./_lib/mktg-jobs.js');

const JOB = 'self_audit';

exports.handler = withRunLog(JOB, async () => {
  // Pull recent agent calls + a sample of recent creatives.
  const [calls, creatives] = await Promise.all([
    sbSelect('mktg_agent_calls', 'select=stage,validation_status,parsed_output,model,latency_ms,input_tokens,output_tokens,cost_usd&order=created_at.desc&limit=200'),
    sbSelect('mktg_creatives', 'select=creative_id,creative_type,status,brief,components,generalizable,generalization_caveat,exemplars_used&order=updated_at.desc&limit=40'),
  ]);

  if (calls.length < 5) {
    return { skipped: true, reason: `only ${calls.length} agent calls in window; need 5+` };
  }

  // Compute the deterministic signals first; the agent's job is to look at
  // them + the sample and write the memo.
  const stageCounts = {};
  let totalCostUsd = 0, totalIn = 0, totalOut = 0;
  let critiquesShipping = 0, critiquesReplacing = 0, critiquesRepairing = 0, critiquesTotal = 0;
  let validationFailures = 0;
  for (const c of calls) {
    stageCounts[c.stage] = (stageCounts[c.stage] || 0) + 1;
    totalCostUsd += Number(c.cost_usd || 0);
    totalIn += c.input_tokens || 0;
    totalOut += c.output_tokens || 0;
    if (c.validation_status === 'failed') validationFailures++;
    if (c.stage === 'critique' && c.parsed_output?.verdict) {
      critiquesTotal++;
      if (c.parsed_output.verdict === 'ship') critiquesShipping++;
      else if (c.parsed_output.verdict === 'replace') critiquesReplacing++;
      else critiquesRepairing++;
    }
  }
  const generalizableFalseN = creatives.filter((c) => c.generalizable === false).length;

  const signals = {
    calls_window_n: calls.length,
    stage_counts: stageCounts,
    total_cost_usd: Number(totalCostUsd.toFixed(4)),
    total_input_tokens: totalIn,
    total_output_tokens: totalOut,
    validation_failure_n: validationFailures,
    validation_failure_rate: calls.length ? validationFailures / calls.length : 0,
    critic_total: critiquesTotal,
    critic_kill_rate: critiquesTotal ? critiquesReplacing / critiquesTotal : null,
    critic_repair_rate: critiquesTotal ? critiquesRepairing / critiquesTotal : null,
    critic_ship_rate: critiquesTotal ? critiquesShipping / critiquesTotal : null,
    creatives_sampled: creatives.length,
    generalizable_false_n: generalizableFalseN,
  };

  // Use the playbook_extract stage shape -- it's the closest to "review the
  // corpus and write a memo". We don't expect proposed_patterns to be
  // useful here; we'll lift notes_for_operator as the memo body.
  const result = await runStage({
    user_id: null,
    stage: 'playbook_extract',
    brief: { objective: 'agent self-audit', creative_type: 'ad' },
    opts: {
      extra: {
        instruction: 'Self-audit only. Review the supplied signals + recent creatives and write a one-page operator memo in notes_for_operator. Cover: guardrail respect, citation load-bearing-ness, critic calibration vs ship/repair/replace distribution, generalizable=false usage as escape hatch vs legitimate, anything broken with concrete examples. Use proposed_patterns / proposed_anti_patterns / patterns_to_deprecate only if you find something concrete worth proposing.',
        signals,
        recent_creatives_sample: creatives.slice(0, 12),
      },
    },
  });

  let memo_body;
  if (result.ok) {
    memo_body = result.parsed.notes_for_operator || '(no notes_for_operator returned)';
  } else {
    memo_body = `Self-audit agent call failed: ${result.validation_error || result.error}\n\nFalling back to deterministic signals only.`;
  }

  const memo_id = await writeMemo({
    kind: 'self_audit',
    content_md:
      `# Self-audit memo\n\n` +
      `Window: ${calls.length} agent calls. Cost: $${signals.total_cost_usd}. Tokens: ${totalIn}+${totalOut}.\n\n` +
      `Validation failures: ${validationFailures}/${calls.length} (${(signals.validation_failure_rate * 100).toFixed(1)}%).\n\n` +
      `Critic distribution (n=${critiquesTotal}): ship ${critiquesShipping} / repair ${critiquesRepairing} / replace ${critiquesReplacing}.\n\n` +
      `generalizable=false usage: ${generalizableFalseN}/${creatives.length} of recent sample.\n\n` +
      `## Agent memo\n\n${memo_body}`,
    signals,
  });

  return { skipped: false, reason: 'memo written', memo_id };
});
