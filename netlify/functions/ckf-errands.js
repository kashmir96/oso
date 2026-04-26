/**
 * ckf-errands.js — quick to-dos with optional reminders.
 *
 * Actions:
 *   list                 -> all errands (filter by status optional)
 *   list_due_modals      -> open errands with remind_at <= now AND shown_at IS NULL
 *                           — used by the modal-on-open
 *   mark_modal_shown     -> set shown_at = now() for one or many ids
 *   create               -> { errand }
 *   update               -> { errand }
 *   complete             -> mark status=done, completed_at=now
 *   reopen               -> mark status=open
 *   delete               -> hard delete
 */
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  if (action === 'list') {
    const status = body.status; // optional filter
    const category = body.category; // optional filter — single category or 'business' / 'not_business'
    let filter = '';
    if (status) filter += `&status=eq.${encodeURIComponent(status)}`;
    if (category === 'not_business') filter += `&category=neq.business`;
    else if (category) filter += `&category=eq.${encodeURIComponent(category)}`;
    const rows = await sbSelect(
      'ckf_errands',
      `user_id=eq.${user.id}${filter}&order=status.asc,due_date.asc.nullslast,created_at.desc&select=*`
    );
    return reply(200, { errands: rows });
  }

  if (action === 'list_due_modals') {
    const now = new Date().toISOString();
    const rows = await sbSelect(
      'ckf_errands',
      `user_id=eq.${user.id}&status=eq.open&remind_at=lte.${encodeURIComponent(now)}&shown_at=is.null&order=remind_at.asc&select=id,title,description,remind_at,due_date`
    );
    return reply(200, { errands: rows });
  }

  if (action === 'mark_modal_shown') {
    const { ids } = body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return reply(400, { error: 'ids[] required' });
    const idList = ids.map((i) => `"${i}"`).join(',');
    await sbUpdate('ckf_errands', `id=in.(${idList})&user_id=eq.${user.id}`, { shown_at: new Date().toISOString() });
    return reply(200, { marked: ids.length });
  }

  if (action === 'create') {
    const { title, description, due_date, remind_at, sms_remind, priority, category } = body;
    if (!title || !title.trim()) return reply(400, { error: 'title required' });
    const row = await sbInsert('ckf_errands', {
      user_id: user.id,
      title: title.trim(),
      description: description || null,
      due_date: due_date || null,
      remind_at: remind_at || null,
      sms_remind: !!sms_remind,
      priority: priority ?? 3,
      category: category || 'personal',
    });
    return reply(200, { errand: row });
  }

  if (action === 'update') {
    const { id, ...patch } = body;
    if (!id) return reply(400, { error: 'id required' });
    delete patch.action;
    // If remind_at changes, clear shown_at + sms_sent_at so the new time fires fresh.
    if (Object.prototype.hasOwnProperty.call(patch, 'remind_at')) {
      patch.shown_at = null;
      patch.sms_sent_at = null;
    }
    const rows = await sbUpdate('ckf_errands', `id=eq.${id}&user_id=eq.${user.id}`, patch);
    return reply(200, { errand: rows?.[0] });
  }

  if (action === 'complete') {
    if (!body.id) return reply(400, { error: 'id required' });
    const rows = await sbUpdate('ckf_errands', `id=eq.${body.id}&user_id=eq.${user.id}`, {
      status: 'done', completed_at: new Date().toISOString(),
    });
    return reply(200, { errand: rows?.[0] });
  }

  if (action === 'reopen') {
    if (!body.id) return reply(400, { error: 'id required' });
    const rows = await sbUpdate('ckf_errands', `id=eq.${body.id}&user_id=eq.${user.id}`, {
      status: 'open', completed_at: null,
    });
    return reply(200, { errand: rows?.[0] });
  }

  if (action === 'delete') {
    if (!body.id) return reply(400, { error: 'id required' });
    await sbDelete('ckf_errands', `id=eq.${body.id}&user_id=eq.${user.id}`);
    return reply(200, { success: true });
  }

  return reply(400, { error: 'Unknown action' });
});
