/**
 * ckf-goals.js — goals + goal_logs.
 * Actions: list, create, update, archive, delete, log_value, history.
 */
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  if (action === 'list') {
    const rows = await sbSelect(
      'goals',
      `user_id=eq.${user.id}&order=created_at.desc&select=*`
    );
    return reply(200, { goals: rows });
  }

  if (action === 'create') {
    const { name, category, current_value, start_value, target_value, unit, direction } = body;
    if (!name || !category) return reply(400, { error: 'name and category required' });
    const row = await sbInsert('goals', {
      user_id: user.id,
      name, category,
      current_value: current_value ?? null,
      start_value: start_value ?? current_value ?? null,
      target_value: target_value ?? null,
      unit: unit || null,
      direction: direction || 'higher_better',
    });
    if (current_value != null) {
      await sbInsert('goal_logs', { goal_id: row.id, user_id: user.id, value: current_value, note: 'initial' });
    }
    return reply(200, { goal: row });
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
