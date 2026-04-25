/**
 * ckf-goals.js — goals + goal_logs.
 * Actions: list, create, update, archive, delete, log_value, history,
 *          mark_done (checkbox), mark_fail (restraint reset).
 */
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

function nzToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
}

function daysBetween(fromDateStr, toDateStr) {
  if (!fromDateStr || !toDateStr) return 0;
  const a = Date.UTC(...fromDateStr.split('-').map(Number).map((v, i) => i === 1 ? v - 1 : v));
  const b = Date.UTC(...toDateStr.split('-').map(Number).map((v, i) => i === 1 ? v - 1 : v));
  return Math.round((b - a) / 86400000);
}

// For restraint goals, recompute current_value on read so the streak ticks up
// automatically. Persists the new value if it changed.
async function refreshRestraintValue(goal) {
  if (goal.goal_type !== 'restraint' || !goal.streak_started_at) return goal;
  const today = nzToday();
  const days = Math.max(0, daysBetween(goal.streak_started_at, today));
  if (Number(goal.current_value) !== days) {
    await sbUpdate('goals', `id=eq.${goal.id}`, { current_value: days });
    goal.current_value = days;
  }
  return goal;
}

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  if (action === 'list') {
    const rows = await sbSelect(
      'goals',
      `user_id=eq.${user.id}&order=created_at.desc&select=*`
    );
    // Auto-tick restraint goals so the streak count reflects today.
    for (const g of rows) await refreshRestraintValue(g);
    return reply(200, { goals: rows });
  }

  if (action === 'create') {
    const { name, category, current_value, start_value, target_value, unit, direction, goal_type } = body;
    if (!name || !category) return reply(400, { error: 'name and category required' });
    const type = goal_type || 'numeric';
    const today = nzToday();

    let row;
    if (type === 'checkbox') {
      row = await sbInsert('goals', {
        user_id: user.id,
        name, category, goal_type: 'checkbox',
        current_value: 0, start_value: 0,
        target_value: target_value ?? null,
        unit: unit || 'days',
        direction: 'higher_better',
        last_completed_at: null,
      });
    } else if (type === 'restraint') {
      row = await sbInsert('goals', {
        user_id: user.id,
        name, category, goal_type: 'restraint',
        current_value: 0, start_value: 0,
        target_value: target_value ?? null,
        unit: unit || 'days',
        direction: 'higher_better',
        streak_started_at: today,
      });
    } else {
      row = await sbInsert('goals', {
        user_id: user.id,
        name, category, goal_type: 'numeric',
        current_value: current_value ?? null,
        start_value: start_value ?? current_value ?? null,
        target_value: target_value ?? null,
        unit: unit || null,
        direction: direction || 'higher_better',
      });
      if (current_value != null) {
        await sbInsert('goal_logs', { goal_id: row.id, user_id: user.id, value: current_value, note: 'initial' });
      }
    }
    return reply(200, { goal: row });
  }

  // Checkbox goals: tap to mark today done. Idempotent for the same day.
  if (action === 'mark_done') {
    const { goal_id } = body;
    if (!goal_id) return reply(400, { error: 'goal_id required' });
    const goal = (await sbSelect('goals', `id=eq.${goal_id}&user_id=eq.${user.id}&select=*&limit=1`))?.[0];
    if (!goal) return reply(404, { error: 'goal not found' });
    if (goal.goal_type !== 'checkbox') return reply(400, { error: 'mark_done is for checkbox goals only' });

    const today = nzToday();
    if (goal.last_completed_at === today) {
      return reply(200, { goal, already_done_today: true });
    }
    const wasYesterday = goal.last_completed_at && daysBetween(goal.last_completed_at, today) === 1;
    const newStreak = wasYesterday ? (Number(goal.current_value) || 0) + 1 : 1;

    const rows = await sbUpdate('goals', `id=eq.${goal_id}&user_id=eq.${user.id}`, {
      current_value: newStreak,
      last_completed_at: today,
    });
    await sbInsert('goal_logs', { goal_id, user_id: user.id, value: newStreak, note: 'checkbox tick' });
    return reply(200, { goal: rows?.[0] });
  }

  // Restraint goals: log a fail; resets the streak to 0 from today.
  if (action === 'mark_fail') {
    const { goal_id, note } = body;
    if (!goal_id) return reply(400, { error: 'goal_id required' });
    const goal = (await sbSelect('goals', `id=eq.${goal_id}&user_id=eq.${user.id}&select=*&limit=1`))?.[0];
    if (!goal) return reply(404, { error: 'goal not found' });
    if (goal.goal_type !== 'restraint') return reply(400, { error: 'mark_fail is for restraint goals only' });
    const today = nzToday();
    const rows = await sbUpdate('goals', `id=eq.${goal_id}&user_id=eq.${user.id}`, {
      current_value: 0,
      streak_started_at: today,
    });
    await sbInsert('goal_logs', { goal_id, user_id: user.id, value: 0, note: note || 'fail — streak reset' });
    return reply(200, { goal: rows?.[0] });
  }

  if (action === 'update') {
    const { id, ...patch } = body;
    if (!id) return reply(400, { error: 'id required' });
    delete patch.action;
    const rows = await sbUpdate('goals', `id=eq.${id}&user_id=eq.${user.id}`, patch);
    return reply(200, { goal: rows[0] });
  }

  if (action === 'archive') {
    if (!body.id) return reply(400, { error: 'id required' });
    const rows = await sbUpdate('goals', `id=eq.${body.id}&user_id=eq.${user.id}`, { status: 'archived' });
    return reply(200, { goal: rows[0] });
  }

  if (action === 'delete') {
    if (!body.id) return reply(400, { error: 'id required' });
    await sbDelete('goals', `id=eq.${body.id}&user_id=eq.${user.id}`);
    return reply(200, { success: true });
  }

  if (action === 'log_value') {
    const { goal_id, value, note } = body;
    if (!goal_id || value == null) return reply(400, { error: 'goal_id and value required' });
    const log = await sbInsert('goal_logs', { goal_id, user_id: user.id, value, note: note || null });
    await sbUpdate('goals', `id=eq.${goal_id}&user_id=eq.${user.id}`, { current_value: value });
    return reply(200, { log });
  }

  if (action === 'history') {
    const { goal_id, limit } = body;
    if (!goal_id) return reply(400, { error: 'goal_id required' });
    const lim = Math.min(Number(limit) || 60, 365);
    const rows = await sbSelect(
      'goal_logs',
      `goal_id=eq.${goal_id}&user_id=eq.${user.id}&order=created_at.desc&limit=${lim}&select=*`
    );
    return reply(200, { logs: rows });
  }

  return reply(400, { error: 'Unknown action' });
});
