import { useEffect, useState } from 'react';
import Header from '../components/Header.jsx';
import { call, callCached, notifyChanged } from '../lib/api.js';
import { fmtShortDate } from '../lib/format.js';

const STATUSES = ['pending','in_progress','done','blocked','cancelled'];

export default function BusinessTasks() {
  const [tasks, setTasks] = useState(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    // callCached: paint instantly from cache on tab return, refresh in bg.
    const r = await callCached('ckf-business', { action: 'list' });
    setTasks(r.tasks);
  }
  useEffect(() => {
    load().catch((e) => setErr(e.message));
    // Refresh when other components mutate (chat creates a task, etc).
    const handler = () => load().catch(() => {});
    window.addEventListener('ckf-data-changed', handler);
    return () => window.removeEventListener('ckf-data-changed', handler);
  }, []);

  async function setStatus(id, status) {
    await call('ckf-business', { action: 'update', id, status });
    notifyChanged();
    load();
  }
  async function del(id) {
    if (!confirm('Delete?')) return;
    await call('ckf-business', { action: 'delete', id });
    notifyChanged();
    load();
  }

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  if (!tasks) return <div className="app"><div className="loading">Loading…</div></div>;

  const open = tasks.filter((t) => !['done', 'cancelled'].includes(t.status));
  const closed = tasks.filter((t) => ['done', 'cancelled'].includes(t.status));

  return (
    <div className="app">
      <Header title="Business tasks" back right={<button onClick={() => setAdding(true)}>+ Task</button>} />
      {adding && <NewForm onSaved={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}
      {open.length === 0 ? <div className="empty">Nothing open.</div> : open.map((t) => (
        <div key={t.id} className="card" style={{ marginBottom: 8 }}>
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
            <select value={t.status} onChange={(e) => setStatus(t.id, e.target.value)} style={{ width: 120 }}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ textAlign: 'right', marginTop: 6 }}>
            <button onClick={() => del(t.id)} className="danger" style={{ padding: '4px 10px', fontSize: 12 }}>Delete</button>
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
    </div>
  );
}

function NewForm({ onSaved, onCancel }) {
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
      });
      notifyChanged();
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
