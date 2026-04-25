/**
 * ckf-tasks.js — routine_tasks + daily_task_logs.
 * Actions: list, create, update, delete, today, set_status.
 */
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

// ── recurrence helpers ──
const DOW = ['sun','mon','tue','wed','thu','fri','sat'];

function isTaskDueOn(task, dateStr) {
  if (!task.active) return false;
  const rule = (task.recurrence_rule || 'daily').toLowerCase().trim();
  if (rule === 'daily' || rule === 'every_day') return true;
  if (rule.startsWith('weekly')) return true; // weekly tasks show every day until completed once that week
  // CSV of day codes: e.g. "mon,wed,fri"
  const days = rule.split(',').map((s) => s.trim()).filter(Boolean);
  const dayOfWeek = DOW[new Date(dateStr + 'T12:00:00Z').getUTCDay()];
  return days.includes(dayOfWeek);
}

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  if (action === 'list') {
    const includeInactive = body.include_inactive === true;
    const filter = includeInactive ? '' : '&active=eq.true';
    const rows = await sbSelect(
      'routine_tasks',
      `user_id=eq.${user.id}${filter}&order=priority.asc,created_at.asc&select=*`
    );
    return reply(200, { tasks: rows });
  }

  if (action === 'create') {
    const { title, description, category, linked_goal_id, recurrence_rule, priority, estimated_minutes, assigned_to } = body;
    if (!title) return reply(400, { error: 'title required' });
    const row = await sbInsert('routine_tasks', {
      user_id: user.id,
      title,
      description: description || null,
      category: category || 'personal',
      linked_goal_id: linked_goal_id || null,
      recurrence_rule: recurrence_rule || 'daily',
      priority: priority ?? 3,
      estimated_minutes: estimated_minutes ?? null,
      assigned_to: assigned_to || null,
    });
    return reply(200, { task: row });
  }

  if (action === 'update') {
    const { id, ...patch } = body;
    if (!id) return reply(400, { error: 'id required' });
    delete patch.action;
    const rows = await sbUpdate('routine_tasks', `id=eq.${id}&user_id=eq.${user.id}`, patch);
    return reply(200, { task: rows[0] });
  }

  if (action === 'delete') {
    if (!body.id) return reply(400, { error: 'id required' });
    await sbDelete('routine_tasks', `id=eq.${body.id}&user_id=eq.${user.id}`);
    return reply(200, { success: true });
  }

  if (action === 'today') {
    const { date } = body;
    if (!date) return reply(400, { error: 'date required (YYYY-MM-DD)' });
    const tasks = await sbSelect(
      'routine_tasks',
      `user_id=eq.${user.id}&active=eq.true&order=priority.asc,created_at.asc&select=*`
    );
    const due = tasks.filter((t) => isTaskDueOn(t, date));
    const logs = await sbSelect(
      'daily_task_logs',
      `user_id=eq.${user.id}&date=eq.${date}&select=*`
    );
    const logByTask = Object.fromEntries(logs.map((l) => [l.routine_task_id, l]));
    const merged = due.map((t) => ({ ...t, log: logByTask[t.id] || null }));
    return reply(200, { date, tasks: merged });
  }

  if (action === 'set_status') {
    const { routine_task_id, date, status, note } = body;
    if (!routine_task_id || !date || !status) return reply(400, { error: 'routine_task_id, date, status required' });
    if (!['not_started','done','skipped'].includes(status)) return reply(400, { error: 'bad status' });
    const existing = await sbSelect(
      'daily_task_logs',
      `user_id=eq.${user.id}&routine_task_id=eq.${routine_task_id}&date=eq.${date}&select=*&limit=1`
    );
    const completedAt = status === 'done' ? new Date().toISOString() : null;
    if (existing?.[0]) {
      const rows = await sbUpdate(
        'daily_task_logs',
        `id=eq.${existing[0].id}&user_id=eq.${user.id}`,
        { status, note: note ?? existing[0].note, completed_at: completedAt }
      );
      return reply(200, { log: rows[0] });
    }
    const log = await sbInsert('daily_task_logs', {
      user_id: user.id, routine_task_id, date, status, note: note || null, completed_at: completedAt,
    });
    return reply(200, { log });
  }

  return reply(400, { error: 'Unknown action' });
});
