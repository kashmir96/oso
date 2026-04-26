import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../components/Header.jsx';
import Sparkline from '../components/Sparkline.jsx';
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
  const [editing, setEditing] = useState(false);
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
      <Header
        title={goal.name}
        back
        right={
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setEditing((v) => !v)}>{editing ? 'Cancel' : 'Edit'}</button>
            <button onClick={archive} className="danger">Archive</button>
          </div>
        }
      />

      {editing && (
        <EditGoalForm
          goal={goal}
          onSaved={async () => { setEditing(false); await load(); }}
          onCancel={() => setEditing(false)}
        />
      )}

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

      {logs.length >= 2 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <Sparkline
            width={320}
            height={90}
            direction={goal.direction}
            points={logs.slice().reverse().map((l) => ({
              x: new Date(l.for_date || l.created_at).getTime(),
              y: Number(l.value),
            }))}
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {logs.length} log{logs.length === 1 ? '' : 's'} · oldest {fmtRelative(logs[logs.length - 1].created_at)}
          </div>
        </div>
      )}

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

const CATEGORIES = ['personal','health','business','social','finance','marketing','other'];

function EditGoalForm({ goal, onSaved, onCancel }) {
  const [name, setName] = useState(goal.name || '');
  const [category, setCategory] = useState(goal.category || 'personal');
  const [unit, setUnit] = useState(goal.unit || '');
  const [direction, setDirection] = useState(goal.direction || 'higher_better');
  const [target, setTarget] = useState(goal.target_value ?? '');
  const [start, setStart] = useState(goal.start_value ?? '');
  const [timeframe, setTimeframe] = useState(goal.timeframe || 'lifetime');
  const [aggregate, setAggregate] = useState(goal.aggregate || 'last');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const isCheckbox = goal.goal_type === 'checkbox';
  const isRestraint = goal.goal_type === 'restraint';
  const isNumeric = !isCheckbox && !isRestraint;

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const patch = { action: 'update', id: goal.id, name, category };
      if (isNumeric) {
        patch.unit = unit || null;
        patch.direction = direction;
        patch.target_value = target === '' ? null : Number(target);
        patch.start_value = start === '' ? null : Number(start);
        patch.timeframe = timeframe;
        patch.aggregate = aggregate;
      } else {
        patch.target_value = target === '' ? null : Number(target);
      }
      await call('ckf-goals', patch);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 12 }}>
      <div className="field">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="row">
        <div className="field">
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Target</label>
          <input type="number" step="any" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
      </div>
      {isNumeric && (
        <>
          <div className="row">
            <div className="field">
              <label>Unit</label>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="%, kg, $, cal" />
            </div>
            <div className="field">
              <label>Direction</label>
              <select value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="higher_better">Higher is better</option>
                <option value="lower_better">Lower is better</option>
              </select>
            </div>
            <div className="field">
              <label>Start</label>
              <input type="number" step="any" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Timeframe</label>
              <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                <option value="lifetime">Lifetime</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="field">
              <label>Aggregate</label>
              <select value={aggregate} onChange={(e) => setAggregate(e.target.value)}>
                <option value="last">Last</option>
                <option value="sum">Sum</option>
                <option value="count">Count</option>
                <option value="avg">Average</option>
              </select>
            </div>
          </div>
        </>
      )}
      {goal.data_source && goal.data_source !== 'manual' && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
          Auto-synced from {goal.data_source}{goal.data_source_field ? ` (${goal.data_source_field})` : ''}.
          Tell the chat "unlink this goal" to switch back to manual.
        </div>
      )}
      {err && <div className="error">{err}</div>}
      <div className="row">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  );
}
