import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../components/Header.jsx';
import { call } from '../lib/api.js';
import { progressPct, formatGoalValue, fmtRelative } from '../lib/format.js';

export default function GoalDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [goal, setGoal] = useState(null);
  const [logs, setLogs] = useState([]);
  const [val, setVal] = useState('');
  const [note, setNote] = useState('');
  const [forDate, setForDate] = useState(() =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date())
  );
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const [g, h] = await Promise.all([
      call('ckf-goals', { action: 'list' }),
      call('ckf-goals', { action: 'history', goal_id: id, limit: 60 }),
    ]);
    setGoal(g.goals.find((x) => x.id === id) || null);
    setLogs(h.logs);
  }
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [id]);

  async function logValue(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await call('ckf-goals', {
        action: 'log_value', goal_id: id, value: Number(val), note,
        for_date: forDate || undefined,
      });
      setVal(''); setNote('');
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function archive() {
    if (!confirm('Archive this goal?')) return;
    await call('ckf-goals', { action: 'archive', id });
    nav('/goals');
  }

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  if (!goal) return <div className="app"><div className="loading">Loading…</div></div>;

  const pct = Math.round(progressPct(goal) * 100);

  return (
    <div className="app">
      <Header title={goal.name} back right={<button onClick={archive} className="danger">Archive</button>} />

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 4 }}>
          {goal.category} · {goal.direction === 'lower_better' ? 'lower is better' : 'higher is better'}
        </div>
        <div style={{ fontSize: 28, fontWeight: 600 }}>
          {formatGoalValue(goal.current_value, goal.unit)}
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          start {formatGoalValue(goal.start_value, goal.unit)} → target {formatGoalValue(goal.target_value, goal.unit)} · {pct}%
        </div>
        <div className="bar" style={{ marginTop: 8, height: 6 }}>
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <form className="card" onSubmit={logValue} style={{ marginBottom: 12 }}>
        <div className="row">
          <div className="field">
            <label>Value</label>
            <input type="number" step="any" value={val} onChange={(e) => setVal(e.target.value)} required />
          </div>
          <div className="field">
            <label>For date</label>
            <input type="date" value={forDate} onChange={(e) => setForDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button className="primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Log value'}</button>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          Backdating is fine — set "For date" to the day this measurement was for.
        </div>
      </form>

      <div className="section-title">History</div>
      {logs.length === 0 ? <div className="empty">No logs yet.</div> : (
        <div className="card">
          {logs.map((l) => (
            <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div>{formatGoalValue(l.value, goal.unit)}</div>
                {l.note && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{l.note}</div>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtRelative(l.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
