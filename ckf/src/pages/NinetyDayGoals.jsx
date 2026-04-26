import { useEffect, useState } from 'react';
import Header from '../components/Header.jsx';
import { call, callCached, notifyChanged } from '../lib/api.js';
import { fmtShortDate } from '../lib/format.js';

const CATEGORIES = ['personal','health','business','social','finance','marketing','other'];

export default function NinetyDayGoals() {
  const [goals, setGoals] = useState(null);
  const [open, setOpen] = useState(null); // detail object { goal, milestones, actions }
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    const r = await callCached('ckf-ninety-day', { action: 'list' });
    setGoals(r.goals);
  }
  useEffect(() => {
    load().catch((e) => setErr(e.message));
    const handler = () => load().catch(() => {});
    window.addEventListener('ckf-data-changed', handler);
    return () => window.removeEventListener('ckf-data-changed', handler);
  }, []);

  async function openGoal(g) {
    const r = await callCached('ckf-ninety-day', { action: 'get', id: g.id });
    setOpen(r);
  }

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  if (!goals) return <div className="app"><div className="loading">Loading…</div></div>;

  if (open) return <Detail data={open} onBack={() => { setOpen(null); load(); }} />;

  return (
    <div className="app">
      <Header title="90-day goals" right={<button onClick={() => setAdding(true)}>+ Add</button>} />
      {adding && <NewForm onSaved={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}
      {goals.length === 0 ? (
        <div className="empty">No 90-day goals yet.</div>
      ) : goals.map((g) => (
        <div key={g.id} className="card" style={{ marginBottom: 10, cursor: 'pointer' }} onClick={() => openGoal(g)}>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{g.category} · {fmtShortDate(g.start_date)} → {fmtShortDate(g.end_date)}</div>
          <div style={{ fontWeight: 600 }}>{g.title}</div>
          {g.target_outcome && <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>{g.target_outcome}</div>}
        </div>
      ))}
    </div>
  );
}

function NewForm({ onSaved, onCancel }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('business');
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [end, setEnd] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 90); return d.toISOString().slice(0, 10);
  });
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await call('ckf-ninety-day', {
        action: 'create',
        title, description, category,
        start_date: start, end_date: end,
        target_outcome: target,
      });
      // Auto-trigger AI breakdown
      try { await call('ckf-ninety-day', { action: 'breakdown', id: r.goal.id }); } catch (e) { console.warn('breakdown failed', e); }
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 14 }}>
      <div className="field"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
      <div className="field"><label>Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="row">
        <div className="field"><label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field"><label>Start</label><input type="date" value={start} onChange={(e) => setStart(e.target.value)} required /></div>
        <div className="field"><label>End</label><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} required /></div>
      </div>
      <div className="field"><label>Target outcome</label><input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="What does success look like?" /></div>
      {err && <div className="error">{err}</div>}
      <div className="row">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Creating + planning…' : 'Create + AI breakdown'}</button>
      </div>
    </form>
  );
}

function Detail({ data, onBack }) {
  const { goal, milestones, actions } = data;
  return (
    <div className="app">
      <Header title={goal.title} back right={<button onClick={onBack} style={{ fontSize: 13 }}>All</button>} />
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{goal.category} · {fmtShortDate(goal.start_date)} → {fmtShortDate(goal.end_date)}</div>
        {goal.description && <div style={{ marginTop: 6 }}>{goal.description}</div>}
        {goal.target_outcome && <div style={{ marginTop: 6, color: 'var(--text-dim)' }}>{goal.target_outcome}</div>}
      </div>

      <div className="section-title">Monthly milestones</div>
      {milestones.length === 0 ? <div className="empty">No milestones yet.</div> :
        milestones.map((m) => (
          <div key={m.id} className="card" style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Month {m.month_number}</div>
            <div style={{ fontWeight: 600 }}>{m.title}</div>
            {m.target && <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>{m.target}</div>}
          </div>
        ))}

      <div className="section-title">Weekly actions</div>
      {actions.length === 0 ? <div className="empty">No actions yet.</div> :
        actions.map((a) => (
          <div key={a.id} className="card" style={{ marginBottom: 6, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Week {a.week_number}</div>
            <div>{a.title}</div>
            {a.description && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{a.description}</div>}
          </div>
        ))}
    </div>
  );
}
