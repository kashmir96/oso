import { useEffect, useState } from 'react';
import Header from '../components/Header.jsx';
import { call } from '../lib/api.js';
import { nzToday, fmtShortDate } from '../lib/format.js';

const CATEGORIES = ['personal','health','business','social','finance','marketing','other'];

// Routine page: today's checklist on top, then upcoming (later this week,
// business tasks with due_dates, planned items from the latest diary).
//
// Calendar events from connected providers (Google Calendar etc.) will be
// merged into both sections once the OAuth + sync function lands. The
// rendering already uses a normalised `Item` shape so plugging them in
// later is one map() call.
export default function Today() {
  const [today, setToday] = useState(null);
  const [later, setLater] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState('');
  const date = nzToday();

  async function load() {
    try {
      const [todayRoutine, business, lastDiary] = await Promise.all([
        call('ckf-tasks', { action: 'today', date }),
        call('ckf-business', { action: 'list' }),
        call('ckf-diary', { action: 'recent', limit: 1 }),
      ]);
      setToday(todayRoutine.tasks);

      // Build "Later" list: business tasks with due_date today/upcoming,
      // and tomorrow_*_tasks from yesterday's/today's diary if present.
      const businessUpcoming = (business.tasks || [])
        .filter((t) => !['done','cancelled'].includes(t.status))
        .filter((t) => t.due_date && t.due_date >= date);

      const recent = (lastDiary.entries || [])[0];
      const plannedTomorrow = recent
        ? [
            ...((recent.tomorrow_personal_tasks || []).map((t, i) => ({
              id: `dpers-${recent.id}-${i}`,
              title: t.task || t.title || '',
              category: 'personal',
              meta: 'planned for tomorrow',
              source: 'diary',
              due_date: null,
            }))),
            ...((recent.tomorrow_business_tasks || []).map((t, i) => ({
              id: `dbiz-${recent.id}-${i}`,
              title: t.task || t.title || '',
              category: 'business',
              meta: 'planned for tomorrow',
              source: 'diary',
              due_date: null,
            }))),
          ].filter((x) => x.title)
        : [];

      const businessItems = businessUpcoming.map((t) => ({
        id: `b-${t.id}`,
        original: t,
        title: t.title,
        category: 'business',
        meta: `${t.due_date ? `due ${fmtShortDate(t.due_date)}` : ''}${t.assigned_to ? ` · ${t.assigned_to}` : ''}`,
        source: 'business',
        due_date: t.due_date,
      }));

      setLater([...businessItems, ...plannedTomorrow]);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [date]);

  async function setStatus(routineTaskId, status) {
    try {
      await call('ckf-tasks', { action: 'set_status', routine_task_id: routineTaskId, date, status });
      load();
    } catch (e) { setErr(e.message); }
  }

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  if (!today) return <div className="app"><div className="loading">Loading…</div></div>;

  return (
    <div className="app">
      <Header title="Routine" right={<button onClick={() => setAdding(true)}>+ Add</button>} />
      {adding && <TaskForm onSaved={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}
      {editing && <TaskForm task={editing} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />}

      <div className="section-title">Today · {fmtShortDate(date)}</div>
      {today.length === 0 ? (
        <div className="empty">No routine tasks today. Tell the chat what you want, or tap "+ Add".</div>
      ) : (
        <div className="card">
          {today.map((t) => {
            const status = t.log?.status || 'not_started';
            return (
              <div key={t.id} className={`today-task ${status === 'done' ? 'done' : ''}`}>
                <div
                  className={`checkbox ${status === 'done' ? 'done' : status === 'skipped' ? 'skipped' : ''}`}
                  onClick={() => setStatus(t.id, status === 'done' ? 'not_started' : 'done')}
                  role="button" tabIndex={0}
                >
                  {status === 'done' ? '✓' : status === 'skipped' ? '–' : ''}
                </div>
                <div className="body">
                  <div className="title" onClick={() => setEditing(t)} style={{ cursor: 'pointer' }}>
                    {t.title}
                  </div>
                  <div className="meta">
                    {t.category}{t.estimated_minutes ? ` · ${t.estimated_minutes}m` : ''}{t.assigned_to ? ` · ${t.assigned_to}` : ''}
                  </div>
                </div>
                {status !== 'skipped' && status !== 'done' && (
                  <button className="skip" onClick={() => setStatus(t.id, 'skipped')}>skip</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="section-title">Later</div>
      {!later || later.length === 0 ? (
        <div className="empty">Nothing scheduled later. Calendar sync coming soon.</div>
      ) : (
        <div className="card">
          {later.map((it) => (
            <div key={it.id} className="today-task">
              <div className="checkbox" style={{ borderStyle: 'dashed' }} aria-hidden="true" />
              <div className="body">
                <div className="title">{it.title}</div>
                <div className="meta">
                  {it.category}{it.meta ? ` · ${it.meta}` : ''}
                  {it.source === 'business' && <span className="pill" style={{ marginLeft: 6 }}>business</span>}
                  {it.source === 'diary' && <span className="pill" style={{ marginLeft: 6 }}>diary</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskForm({ task, onSaved, onCancel }) {
  const [title, setTitle] = useState(task?.title || '');
  const [category, setCategory] = useState(task?.category || 'personal');
  const [recurrence, setRecurrence] = useState(task?.recurrence_rule || 'daily');
  const [priority, setPriority] = useState(task?.priority ?? 3);
  const [estimated, setEstimated] = useState(task?.estimated_minutes ?? '');
  const [assignedTo, setAssignedTo] = useState(task?.assigned_to || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isEdit = !!task;

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const action = isEdit ? 'update' : 'create';
      await call('ckf-tasks', {
        action, ...(isEdit ? { id: task.id } : {}),
        title, category, recurrence_rule: recurrence,
        priority: Number(priority),
        estimated_minutes: estimated === '' ? null : Number(estimated),
        assigned_to: assignedTo || null,
      });
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function onDelete() {
    if (!confirm('Delete this task?')) return;
    await call('ckf-tasks', { action: 'delete', id: task.id });
    onSaved();
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 14 }}>
      <div className="field">
        <label>Task</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="row">
        <div className="field">
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            {[1,2,3,4,5].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Recurrence</label>
        <input value={recurrence} onChange={(e) => setRecurrence(e.target.value)} placeholder="daily, weekly, mon,wed,fri" />
      </div>
      <div className="row">
        <div className="field">
          <label>Estimated min</label>
          <input type="number" value={estimated} onChange={(e) => setEstimated(e.target.value)} />
        </div>
        <div className="field">
          <label>Assigned to</label>
          <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="optional" />
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="row">
        {isEdit && <button type="button" className="danger" onClick={onDelete}>Delete</button>}
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
