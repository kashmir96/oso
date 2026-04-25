/**
 * ckf-business.js — business_tasks CRUD.
 * Actions: list, create, update, delete.
 */
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  if (action === 'list') {
    const status = body.status; // optional filter
    const filter = status ? `&status=eq.${encodeURIComponent(status)}` : '';
    const rows = await sbSelect(
      'business_tasks',
      `user_id=eq.${user.id}${filter}&order=priority.asc,due_date.asc.nullslast&select=*`
    );
    return reply(200, { tasks: rows });
  }

  if (action === 'create') {
    const { title, description, objective, assigned_to, priority, status, due_date } = body;
    if (!title) return reply(400, { error: 'title required' });
    const row = await sbInsert('business_tasks', {
      user_id: user.id,
      title,
      description: description || null,
      objective: objective || null,
      assigned_to: assigned_to || null,
      priority: priority ?? 3,
      status: status || 'pending',
      due_date: due_date || null,
    });
    return reply(200, { task: row });
  }

  if (action === 'update') {
    const { id, ...patch } = body;
    if (!id) return reply(400, { error: 'id required' });
    delete patch.action;
    const rows = await sbUpdate('business_tasks', `id=eq.${id}&user_id=eq.${user.id}`, patch);
    return reply(200, { task: rows[0] });
  }

  if (action === 'delete') {
    if (!body.id) return reply(400, { error: 'id required' });
    await sbDelete('business_tasks', `id=eq.${body.id}&user_id=eq.${user.id}`);
    return reply(200, { success: true });
  }

  return reply(400, { error: 'Unknown action' });
});
