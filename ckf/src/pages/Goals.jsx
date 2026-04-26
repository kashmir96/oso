import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header.jsx';
import GoalCard from '../components/GoalCard.jsx';
import { call, callCached, notifyChanged } from '../lib/api.js';
import { progressPct, formatGoalValue } from '../lib/format.js';

const CATEGORIES = ['personal','health','business','social','finance','marketing','other'];

export default function Goals() {
  const [goals, setGoals] = useState(null);
  const [adding, setAdding] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [err, setErr] = useState('');

  async function refresh() {
    const r = await callCached('ckf-goals', { action: 'list' });
    setGoals(r.goals);
  }
  useEffect(() => { refresh().catch((e) => setErr(e.message)); }, []);

  async function move(id, direction) {
    const active = goals.filter((g) => g.status === 'active');
    const idx = active.findIndex((g) => g.id === id);
    if (idx < 0) return;
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= active.length) return;
    const reordered = [...active];
    [reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]];
    // Optimistic update
    setGoals((prev) => [...reordered, ...prev.filter((g) => g.status !== 'active')]);
    try {
      await call('ckf-goals', { action: 'reorder', ordered_ids: reordered.map((g) => g.id) });
      notifyChanged();
    } catch (e) { setErr(e.message); refresh(); }
  }

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  if (!goals) return <div className="app"><div className="loading">Loading…</div></div>;

  const active = goals.filter((g) => g.status === 'active');
  const archived = goals.filter((g) => g.status === 'archived');

  return (
    <div className="app">
      <Header
        title="Goals"
        right={
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setReordering((v) => !v)} className={reordering ? 'primary' : ''}>
              {reordering ? 'Done' : 'Reorder'}
            </button>
            <button onClick={() => setAdding(true)}>+ Add</button>
          </div>
        }
      />
      {adding && <NewGoalForm onSaved={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />}

      {active.length === 0 ? (
        <div className="empty">No active goals.</div>
      ) : reordering ? (
        <div className="card" style={{ padding: 0 }}>
          {active.map((g, i) => (
            <div key={g.id} className="reorder-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {g.category} · {formatGoalValue(g.current_value, g.unit)}{g.target_value != null ? ` / ${formatGoalValue(g.target_value, g.unit)}` : ''}
                </div>
              </div>
              <button onClick={() => move(g.id, 'up')} disabled={i === 0} className="reorder-btn">↑</button>
              <button onClick={() => move(g.id, 'down')} disabled={i === active.length - 1} className="reorder-btn">↓</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="goal-grid">
          {active.map((g) => <GoalCard key={g.id} goal={g} />)}
        </div>
      )}

      {archived.length > 0 && (
        <>
          <div className="section-title">Archived</div>
          <div className="goal-grid">
            {archived.map((g) => <GoalCard key={g.id} goal={g} />)}
          </div>
        </>
      )}
    </div>
  );
}

function NewGoalForm({ onSaved, onCancel }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('personal');
  const [goalType, setGoalType] = useState('numeric');
  const [timeframe, setTimeframe] = useState('lifetime');
  const [aggregate, setAggregate] = useState('last');
  const [unit, setUnit] = useState('');
  const [direction, setDirection] = useState('higher_better');
  const [start, setStart] = useState('');
  const [current, setCurrent] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const payload = { action: 'create', name, category, goal_type: goalType };
      if (goalType === 'numeric') {
        payload.unit = unit;
        payload.direction = direction;
        payload.timeframe = timeframe;
        payload.aggregate = aggregate;
        payload.start_value = start === '' ? null : Number(start);
        payload.current_value = current === '' ? null : Number(current);
        payload.target_value = target === '' ? null : Number(target);
      } else {
        payload.target_value = target === '' ? null : Number(target);
      }
      await call('ckf-goals', payload);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 14 }}>
      <div className="field">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Plunge every day" />
      </div>
      <div className="field">
        <label>Type</label>
        <select value={goalType} onChange={(e) => setGoalType(e.target.value)}>
          <option value="numeric">Numeric — measured value (weight, %, $)</option>
          <option value="checkbox">Checkbox — daily yes/no, streak ticks up</option>
          <option value="restraint">Restraint — auto-ticks daily until I fail</option>
        </select>
      </div>
      <div className="field">
        <label>Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {goalType === 'numeric' && (
        <>
          <div className="row">
            <div className="field">
              <label>Timeframe</label>
              <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                <option value="lifetime">Lifetime — never resets</option>
                <option value="daily">Daily — resets at midnight</option>
                <option value="weekly">Weekly — resets Monday</option>
                <option value="monthly">Monthly — resets 1st</option>
              </select>
            </div>
            <div className="field">
              <label>How values combine</label>
              <select value={aggregate} onChange={(e) => setAggregate(e.target.value)}>
                <option value="last">Last (most recent log)</option>
                <option value="sum">Sum (e.g. calories)</option>
                <option value="count">Count (e.g. sessions)</option>
                <option value="avg">Average</option>
              </select>
            </div>
          </div>
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
          </div>
          <div className="row">
            <div className="field">
              <label>Start</label>
              <input type="number" step="any" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="field">
              <label>Current</label>
              <input type="number" step="any" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div className="field">
              <label>Target</label>
              <input type="number" step="any" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
          </div>
        </>
      )}

      {(goalType === 'checkbox' || goalType === 'restraint') && (
        <div className="field">
          <label>Streak target (days, optional)</label>
          <input type="number" step="1" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. 30" />
        </div>
      )}

      {err && <div className="error">{err}</div>}
      <div className="row">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
