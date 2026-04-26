import { useEffect, useState } from 'react';
import Header from '../components/Header.jsx';
import GoalCard from '../components/GoalCard.jsx';
import { call } from '../lib/api.js';

const CATEGORIES = ['personal','health','business','social','finance','marketing','other'];

export default function Goals() {
  const [goals, setGoals] = useState(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');

  async function refresh() {
    const r = await call('ckf-goals', { action: 'list' });
    setGoals(r.goals);
  }
  useEffect(() => { refresh().catch((e) => setErr(e.message)); }, []);

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  if (!goals) return <div className="app"><div className="loading">Loading…</div></div>;

  const active = goals.filter((g) => g.status === 'active');
  const archived = goals.filter((g) => g.status === 'archived');

  return (
    <div className="app">
      <Header
        title="Goals"
        right={<button onClick={() => setAdding(true)}>+ Add</button>}
      />
      {adding && <NewGoalForm onSaved={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />}

      {active.length === 0 ? (
        <div className="empty">No active goals.</div>
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
