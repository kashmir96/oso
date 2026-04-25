import { useEffect, useState } from 'react';
import Header from '../components/Header.jsx';
import { call } from '../lib/api.js';
import { nzToday } from '../lib/format.js';

const CATEGORIES = ['personal','health','business','social','finance','marketing','other'];

export default function Today() {
  const [tasks, setTasks] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState('');
  const date = nzToday();

  async function load() {
    const r = await call('ckf-tasks', { action: 'today', date });
    setTasks(r.tasks);
  }
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [date]);

  async function setStatus(routineTaskId, status) {
    try {
      await call('ckf-tasks', { action: 'set_status', routine_task_id: routineTaskId, date, status });
      await load();
    } catch (e) { setErr(e.message); }
  }

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  if (!tasks) return <div className="app"><div className="loading">Loading…</div></div>;

  return (
    <div className="app">
      <Header title="Today" right={<button onClick={() => setAdding(true)}>+ Add</button>} />
      {adding && (
        <TaskForm
          onSaved={() => { setAdding(false); load(); }}
          onCancel={() => setAdding(false)}
        />
      )}
      {editing && (
        <TaskForm
          task={editing}
          onSaved={() => { setEditing(null); load(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {tasks.length === 0 ? (
        <div className="empty">No tasks today. Add a routine to start building consistency.</div>
      ) : (
        <div className="card">
          {tasks.map((t) => {
            const status = t.log?.status || 'not_started';
            return (
              <div key={t.id} className={`today-task ${status === 'done' ? 'done' : ''}`}>
                <div
                  className={`checkbox ${status === 'done' ? 'done' : status === 'skipped' ? 'skipped' : ''}`}
                  onClick={() => setStatus(t.id, status === 'done' ? 'not_started' : 'done')}
                  role="button"
                  tabIndex={0}
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
      if (isEdit) {
        await call('ckf-tasks', {
          action: 'update', id: task.id,
          title, category, recurrence_rule: recurrence,
          priority: Number(priority),
          estimated_minutes: estimated === '' ? null : Number(estimated),
          assigned_to: assignedTo || null,
        });
      } else {
        await call('ckf-tasks', {
          action: 'create',
          title, category, recurrence_rule: recurrence,
          priority: Number(priority),
          estimated_minutes: estimated === '' ? null : Number(estimated),
          assigned_to: assignedTo || null,
        });
      }
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
