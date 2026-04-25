/**
 * ckf-suggestions.js — routine_suggestions: approve / reject.
 * Approving creates a routine_tasks row and links it back via applied_routine_task_id.
 * Rejecting just flips status. Nothing changes the active routine without explicit approval.
 *
 * Actions: list, approve, reject.
 */
const { sbSelect, sbInsert, sbUpdate } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  if (action === 'list') {
    const status = body.status || 'pending';
    const rows = await sbSelect(
      'routine_suggestions',
      `user_id=eq.${user.id}&status=eq.${status}&order=created_at.desc&limit=100&select=*`
    );
    return reply(200, { suggestions: rows });
  }

  if (action === 'approve') {
    const { id, category, recurrence_rule, priority, estimated_minutes, linked_goal_id } = body;
    if (!id) return reply(400, { error: 'id required' });

    const sugg = (await sbSelect('routine_suggestions', `id=eq.${id}&user_id=eq.${user.id}&select=*&limit=1`))?.[0];
    if (!sugg) return reply(404, { error: 'suggestion not found' });
    if (sugg.status !== 'pending') return reply(400, { error: 'suggestion already decided' });

    const task = await sbInsert('routine_tasks', {
      user_id: user.id,
      title: sugg.suggestion,
      description: sugg.reason || null,
      category: category || 'personal',
      linked_goal_id: linked_goal_id || null,
      recurrence_rule: recurrence_rule || 'daily',
      priority: priority ?? 3,
      estimated_minutes: estimated_minutes || null,
    });

    await sbUpdate('routine_suggestions', `id=eq.${id}&user_id=eq.${user.id}`, {
      status: 'approved',
      decided_at: new Date().toISOString(),
      applied_routine_task_id: task.id,
    });

    return reply(200, { task, suggestion_id: id });
  }

  if (action === 'reject') {
    if (!body.id) return reply(400, { error: 'id required' });
    await sbUpdate('routine_suggestions', `id=eq.${body.id}&user_id=eq.${user.id}`, {
      status: 'rejected',
      decided_at: new Date().toISOString(),
    });
    return reply(200, { success: true });
  }

  return reply(400, { error: 'Unknown action' });
});
