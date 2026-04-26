import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import Header from '../components/Header.jsx';
import { call } from '../lib/api.js';
import { fmtShortDate } from '../lib/format.js';

const STATUSES = ['pending','in_progress','done','blocked','cancelled'];
const PROJECT_STATUSES = ['active','paused','done','cancelled'];

export default function ProjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);

  async function load() {
    try {
      const r = await call('ckf-business', { action: 'get_project', id });
      setProject(r.project);
      setTasks(r.tasks);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [id]);

  async function setTaskStatus(taskId, status) {
    await call('ckf-business', { action: 'update', id: taskId, status });
    load();
  }
  async function delTask(taskId) {
    if (!confirm('Delete?')) return;
    await call('ckf-business', { action: 'delete', id: taskId });
    load();
  }
  async function setProjectStatus(status) {
    await call('ckf-business', { action: 'update_project', id, status });
    load();
  }
  async function delProject() {
    if (!confirm('Delete project? Its tasks become standalone, not deleted.')) return;
    await call('ckf-business', { action: 'delete_project', id });
    nav('/business', { replace: true });
  }

  if (err) return (<div className="app"><Header title="Project" back /><div className="error">{err}</div></div>);
  if (!project || !tasks) return (<div className="app"><Header title="Project" back /><div className="loading">Loading…</div></div>);
  if (!project) return (<div className="app"><Header title="Not found" back /><div className="empty">No project with id {id}.</div></div>);

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done' || t.status === 'cancelled').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const open = tasks.filter((t) => !['done','cancelled'].includes(t.status));
  const closed = tasks.filter((t) => ['done','cancelled'].includes(t.status));

  return (
    <div className="app">
      <Header
        title={project.title}
        crumb="Project"
        back
        right={<button onClick={() => setAdding(true)} style={{ fontSize: 12, padding: '6px 10px' }}>+ Task</button>}
      />

      <div className="card" style={{ marginBottom: 12 }}>
        {project.description && <div style={{ marginBottom: 8 }}>{project.description}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-dim)' }}>
          <div>
            {total === 0 ? 'no tasks yet' : `${done}/${total} done`}
            {project.target_date ? ` · target ${fmtShortDate(project.target_date)}` : ''}
          </div>
          <div style={{ fontWeight: 600 }}>{pct}%</div>
        </div>
        <div className="bar" style={{ marginTop: 6 }}>
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="row" style={{ marginTop: 10, alignItems: 'center', gap: 8 }}>
          <select value={project.status} onChange={(e) => setProjectStatus(e.target.value)}>
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => setEditingMeta((v) => !v)}>{editingMeta ? 'Close' : 'Edit'}</button>
          <button onClick={delProject} className="danger">Delete</button>
        </div>
        {editingMeta && (
          <EditProjectMeta project={project} onSaved={() => { setEditingMeta(false); load(); }} />
        )}
      </div>

      {adding && <NewTaskForm projectId={id} onSaved={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}

      {open.length === 0 && closed.length === 0 && (
        <div className="empty">No tasks. Hit "+ Task" to add the first job.</div>
      )}

      {open.map((t) => (
        <div key={t.id} className="card" style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{t.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                {t.objective ? `${t.objective} · ` : ''}
                {t.assigned_to ? `${t.assigned_to} · ` : ''}
                {t.due_date ? `due ${fmtShortDate(t.due_date)} · ` : ''}
                P{t.priority}
              </div>
              {t.description && <div style={{ fontSize: 13, marginTop: 4 }}>{t.description}</div>}
            </div>
            <select value={t.status} onChange={(e) => setTaskStatus(t.id, e.target.value)} style={{ width: 120 }}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ textAlign: 'right', marginTop: 6 }}>
            <button onClick={() => delTask(t.id)} className="danger" style={{ padding: '4px 10px', fontSize: 12 }}>Delete</button>
          </div>
        </div>
      ))}

      {closed.length > 0 && (
        <>
          <div className="section-title">Done / Cancelled</div>
          {closed.map((t) => (
            <div key={t.id} className="card" style={{ marginBottom: 6, opacity: .6 }}>
              <span className="pill">{t.status}</span> {t.title}
            </div>
          ))}
        </>
      )}

      <div style={{ marginTop: 18, textAlign: 'center' }}>
        <Link to="/business" className="dim" style={{ fontSize: 12 }}>← Back to Business</Link>
      </div>
    </div>
  );
}

function EditProjectMeta({ project, onSaved }) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description || '');
  const [targetDate, setTargetDate] = useState(project.target_date || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setBusy(true); setErr('');
    try {
      await call('ckf-business', {
        action: 'update_project',
        id: project.id,
        title,
        description,
        target_date: targetDate || null,
      });
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div className="field"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="field"><label>Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
      <div className="field"><label>Target date</label><input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></div>
      {err && <div className="error">{err}</div>}
      <button onClick={save} className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

function NewTaskForm({ projectId, onSaved, onCancel }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [objective, setObjective] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [priority, setPriority] = useState(3);
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await call('ckf-business', {
        action: 'create',
        title, description, objective,
        assigned_to: assignedTo || null,
        priority: Number(priority),
        due_date: due || null,
        project_id: projectId,
      });
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 14 }}>
      <div className="field"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
      <div className="field"><label>Objective</label><input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What outcome?" /></div>
      <div className="field"><label>Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="row">
        <div className="field"><label>Assigned to</label><input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="me / Linda / …" /></div>
        <div className="field"><label>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>{[1,2,3,4,5].map((p) => <option key={p} value={p}>{p}</option>)}</select>
        </div>
        <div className="field"><label>Due</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="row">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
