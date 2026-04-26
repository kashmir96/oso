/**
 * ckf-business.js — business_tasks + business_projects.
 *
 * Task actions:
 *   list                { status?, project_id? }
 *   create              { title, description?, objective?, assigned_to?, priority?, status?, due_date?, project_id? }
 *   update              { id, ...patch }
 *   delete              { id }
 *
 * Project actions:
 *   list_projects       { status? }     -> [{...project, task_count, done_count, open_count}]
 *   get_project         { id }          -> { project, tasks }
 *   create_project      { title, description?, status?, target_date?, notes? }
 *   update_project      { id, ...patch }
 *   delete_project      { id }          -> tasks become standalone (project_id → NULL)
 */
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

const TASK_PATCH_KEYS = [
  'title','description','objective','assigned_to','priority','status','due_date','project_id',
];
const PROJECT_PATCH_KEYS = [
  'title','description','status','target_date','notes',
];

function pickPatch(body, keys) {
  const patch = {};
  for (const k of keys) if (body[k] !== undefined) patch[k] = body[k];
  return patch;
}

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  // ── Tasks ──
  if (action === 'list') {
    const filters = [`user_id=eq.${user.id}`, 'select=*'];
    if (body.status)     filters.push(`status=eq.${encodeURIComponent(body.status)}`);
    if (body.project_id) filters.push(`project_id=eq.${encodeURIComponent(body.project_id)}`);
    filters.push('order=priority.asc,due_date.asc.nullslast');
    return reply(200, { tasks: await sbSelect('business_tasks', filters.join('&')) });
  }

  if (action === 'create') {
    const { title } = body;
    if (!title) return reply(400, { error: 'title required' });
    // Only include project_id when explicitly set, otherwise the column may
    // not exist yet (supabase-business-projects.sql migration is opt-in).
    const insert = {
      user_id:     user.id,
      title,
      description: body.description || null,
      objective:   body.objective || null,
      assigned_to: body.assigned_to || null,
      priority:    body.priority ?? 3,
      status:      body.status || 'pending',
      due_date:    body.due_date || null,
    };
    if (body.project_id) insert.project_id = body.project_id;
    const row = await sbInsert('business_tasks', insert);
    return reply(200, { task: row });
  }

  if (action === 'update') {
    const { id } = body;
    if (!id) return reply(400, { error: 'id required' });
    const patch = pickPatch(body, TASK_PATCH_KEYS);
    const rows = await sbUpdate('business_tasks', `id=eq.${id}&user_id=eq.${user.id}`, patch);
    return reply(200, { task: Array.isArray(rows) ? rows[0] : rows });
  }

  if (action === 'delete') {
    if (!body.id) return reply(400, { error: 'id required' });
    await sbDelete('business_tasks', `id=eq.${body.id}&user_id=eq.${user.id}`);
    return reply(200, { success: true });
  }

  // ── Projects ──
  if (action === 'list_projects') {
    const filter = body.status ? `&status=eq.${encodeURIComponent(body.status)}` : '';
    const projects = await sbSelect(
      'business_projects',
      `user_id=eq.${user.id}${filter}&order=updated_at.desc&select=*`
    );
    if (projects.length === 0) return reply(200, { projects: [] });
    // Bulk-fetch tasks once and roll up counts client-side to keep it cheap.
    const ids = projects.map((p) => p.id);
    const tasks = await sbSelect(
      'business_tasks',
      `user_id=eq.${user.id}&project_id=in.(${ids.map(encodeURIComponent).join(',')})&select=project_id,status`
    );
    const counts = {};
    for (const t of tasks) {
      const k = t.project_id;
      counts[k] = counts[k] || { task_count: 0, done_count: 0, open_count: 0 };
      counts[k].task_count++;
      if (t.status === 'done' || t.status === 'cancelled') counts[k].done_count++;
      else                                                  counts[k].open_count++;
    }
    return reply(200, {
      projects: projects.map((p) => ({
        ...p,
        task_count: counts[p.id]?.task_count || 0,
        done_count: counts[p.id]?.done_count || 0,
        open_count: counts[p.id]?.open_count || 0,
      })),
    });
  }

  if (action === 'get_project') {
    if (!body.id) return reply(400, { error: 'id required' });
    const enc = encodeURIComponent(body.id);
    const [projects, tasks] = await Promise.all([
      sbSelect('business_projects', `id=eq.${enc}&user_id=eq.${user.id}&select=*&limit=1`),
      sbSelect('business_tasks', `project_id=eq.${enc}&user_id=eq.${user.id}&order=priority.asc,due_date.asc.nullslast&select=*`),
    ]);
    return reply(200, { project: projects[0] || null, tasks });
  }

  if (action === 'create_project') {
    if (!body.title) return reply(400, { error: 'title required' });
    const row = await sbInsert('business_projects', {
      user_id:     user.id,
      title:       body.title,
      description: body.description || null,
      status:      body.status || 'active',
      target_date: body.target_date || null,
      notes:       body.notes || null,
    });
    return reply(200, { project: row });
  }

  if (action === 'update_project') {
    if (!body.id) return reply(400, { error: 'id required' });
    const patch = pickPatch(body, PROJECT_PATCH_KEYS);
    const rows = await sbUpdate('business_projects', `id=eq.${body.id}&user_id=eq.${user.id}`, patch);
    return reply(200, { project: Array.isArray(rows) ? rows[0] : rows });
  }

  if (action === 'delete_project') {
    if (!body.id) return reply(400, { error: 'id required' });
    // FK is ON DELETE SET NULL — tasks become standalone, not deleted.
    await sbDelete('business_projects', `id=eq.${body.id}&user_id=eq.${user.id}`);
    return reply(200, { success: true });
  }

  // ── Website tasks (Claude Code queue) ──
  if (action === 'list_website') {
    const filters = [`user_id=eq.${user.id}`, 'select=*', 'order=status.asc,priority.asc,created_at.desc'];
    if (body.status) filters.push(`status=eq.${encodeURIComponent(body.status)}`);
    if (body.repo)   filters.push(`repo=eq.${encodeURIComponent(body.repo)}`);
    const rows = await sbSelect('website_tasks', filters.join('&'));
    return reply(200, { website_tasks: rows });
  }

  if (action === 'create_website') {
    if (!body.title) return reply(400, { error: 'title required' });
    const insert = {
      user_id:     user.id,
      title:       body.title,
      description: body.description || null,
      priority:    body.priority ?? 3,
      status:      body.status || 'queued',
    };
    // Default to oso-ckf for backwards compat with existing manual entries.
    if (body.repo) insert.repo = body.repo;
    const row = await sbInsert('website_tasks', insert);
    return reply(200, { website_task: row });
  }

  if (action === 'update_website') {
    if (!body.id) return reply(400, { error: 'id required' });
    const allowed = ['title','description','status','priority','notes','pr_url','completed_at','repo'];
    const patch = {};
    for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
    // Auto-set completed_at when transitioning to done.
    if (patch.status === 'done' && body.completed_at === undefined) {
      patch.completed_at = new Date().toISOString();
    }
    const rows = await sbUpdate('website_tasks', `id=eq.${body.id}&user_id=eq.${user.id}`, patch);
    return reply(200, { website_task: Array.isArray(rows) ? rows[0] : rows });
  }

  if (action === 'delete_website') {
    if (!body.id) return reply(400, { error: 'id required' });
    await sbDelete('website_tasks', `id=eq.${body.id}&user_id=eq.${user.id}`);
    return reply(200, { success: true });
  }

  return reply(400, { error: 'Unknown action' });
});
