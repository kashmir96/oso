/**
 * ckf-ninety-day.js — ninety_day_goals + monthly_milestones + weekly_actions.
 * Actions: list, get, create, update, delete, breakdown.
 *
 * `breakdown` calls the AI to produce monthly milestones, weekly actions,
 * and daily routine suggestions. The milestones and actions are inserted as
 * pending rows. Routine suggestions are inserted into routine_suggestions
 * for explicit approval.
 */
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');
const { breakdownNinetyDay } = require('./_lib/ckf-ai.js');

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  if (action === 'list') {
    const rows = await sbSelect(
      'ninety_day_goals',
      `user_id=eq.${user.id}&order=created_at.desc&select=*`
    );
    return reply(200, { goals: rows });
  }

  if (action === 'get') {
    if (!body.id) return reply(400, { error: 'id required' });
    const goal = (await sbSelect('ninety_day_goals', `id=eq.${body.id}&user_id=eq.${user.id}&select=*&limit=1`))?.[0];
    if (!goal) return reply(404, { error: 'not found' });
    const milestones = await sbSelect('monthly_milestones', `ninety_day_goal_id=eq.${body.id}&user_id=eq.${user.id}&order=month_number.asc&select=*`);
    const actions = await sbSelect('weekly_actions', `ninety_day_goal_id=eq.${body.id}&user_id=eq.${user.id}&order=week_number.asc&select=*`);
    return reply(200, { goal, milestones, actions });
  }

  if (action === 'create') {
    const { title, description, category, start_date, end_date, target_outcome } = body;
    if (!title || !category || !start_date || !end_date) return reply(400, { error: 'title, category, start_date, end_date required' });
    const row = await sbInsert('ninety_day_goals', {
      user_id: user.id,
      title, description: description || null, category,
      start_date, end_date, target_outcome: target_outcome || null,
    });
    return reply(200, { goal: row });
  }

  if (action === 'update') {
    const { id, ...patch } = body;
    if (!id) return reply(400, { error: 'id required' });
    delete patch.action;
    const rows = await sbUpdate('ninety_day_goals', `id=eq.${id}&user_id=eq.${user.id}`, patch);
    return reply(200, { goal: rows[0] });
  }

  if (action === 'delete') {
    if (!body.id) return reply(400, { error: 'id required' });
    await sbDelete('ninety_day_goals', `id=eq.${body.id}&user_id=eq.${user.id}`);
    return reply(200, { success: true });
  }

  if (action === 'breakdown') {
    const { id } = body;
    if (!id) return reply(400, { error: 'id required' });
    const goal = (await sbSelect('ninety_day_goals', `id=eq.${id}&user_id=eq.${user.id}&select=*&limit=1`))?.[0];
    if (!goal) return reply(404, { error: 'not found' });

    const ai = await breakdownNinetyDay({ goal });

    const milestoneRows = [];
    for (const m of (ai.monthly_milestones || [])) {
      if (!m?.title || !m?.month_number) continue;
      milestoneRows.push({
        ninety_day_goal_id: id,
        user_id: user.id,
        month_number: m.month_number,
        title: m.title,
        target: m.target || null,
      });
    }
    const insertedMilestones = milestoneRows.length
      ? await Promise.all(milestoneRows.map((r) => sbInsert('monthly_milestones', r)))
      : [];

    const actionRows = [];
    for (const a of (ai.weekly_actions || [])) {
      if (!a?.title || !a?.week_number) continue;
      const milestone = insertedMilestones.find((m) => Math.ceil(a.week_number / 4.34) === m.month_number) || insertedMilestones[0];
      actionRows.push({
        ninety_day_goal_id: id,
        monthly_milestone_id: milestone?.id || null,
        user_id: user.id,
        week_number: a.week_number,
        title: a.title,
        description: a.description || null,
      });
    }
    const insertedActions = actionRows.length
      ? await Promise.all(actionRows.map((r) => sbInsert('weekly_actions', r)))
      : [];

    // Routine suggestions go through approval gate
    for (const s of (ai.daily_routine_suggestions || [])) {
      if (!s?.suggestion) continue;
      await sbInsert('routine_suggestions', {
        user_id: user.id,
        source_type: 'ninety_day',
        source_id: id,
        suggestion: s.suggestion,
        reason: s.reason || null,
      });
    }

    return reply(200, {
      milestones: insertedMilestones,
      actions: insertedActions,
      suggestions_created: (ai.daily_routine_suggestions || []).length,
    });
  }

  return reply(400, { error: 'Unknown action' });
});
