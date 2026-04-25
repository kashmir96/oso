import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { progressPct, formatGoalValue, fmtRelative, nzToday } from '../lib/format.js';
import { call } from '../lib/api.js';

// Three goal_type variants, all rendered to fit the same compact 3-per-row grid.
// - numeric: tap → /goals/:id (existing detail page).
// - checkbox: tap → mark today done. Streak displayed.
// - restraint: tap → "log fail" confirm. Streak displayed.
export default function GoalCard({ goal, onChanged }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const today = nzToday();
  const type = goal.goal_type || 'numeric';

  if (type === 'checkbox') {
    const doneToday = goal.last_completed_at === today;
    async function tick(e) {
      e.preventDefault();
      if (busy || doneToday) { nav(`/goals/${goal.id}`); return; }
      setBusy(true);
      try {
        await call('ckf-goals', { action: 'mark_done', goal_id: goal.id });
        onChanged && onChanged();
      } finally { setBusy(false); }
    }
    return (
      <div className={`goal-card goal-checkbox ${doneToday ? 'done' : ''}`} onClick={tick} role="button">
        <div className="name">{goal.name}</div>
        <div className="value">
          {doneToday ? '✓' : '○'} <span style={{ fontSize: 18 }}>{Number(goal.current_value || 0)}</span>
        </div>
        <div className="target">{doneToday ? 'done today' : 'tap to tick'}</div>
        <div className="updated">{Number(goal.current_value || 0)} day streak</div>
      </div>
    );
  }

  if (type === 'restraint') {
    async function fail(e) {
      e.preventDefault();
      if (!confirm(`Log a fail for "${goal.name}"? Streak will reset to 0.`)) return;
      setBusy(true);
      try {
        await call('ckf-goals', { action: 'mark_fail', goal_id: goal.id });
        onChanged && onChanged();
      } finally { setBusy(false); }
    }
    return (
      <div className="goal-card goal-restraint" onClick={fail} role="button">
        <div className="name">{goal.name}</div>
        <div className="value">🛡 <span style={{ fontSize: 18 }}>{Number(goal.current_value || 0)}</span></div>
        <div className="target">days clean</div>
        <div className="updated" style={{ color: 'var(--text-muted)' }}>tap if you slipped</div>
      </div>
    );
  }

  // numeric (default)
  const pct = progressPct(goal);
  const linked = goal.data_source && goal.data_source !== 'manual';
  return (
    <Link to={`/goals/${goal.id}`} className="goal-card" style={{ color: 'inherit', textDecoration: 'none' }}>
      <div className="name">
        {goal.name}
        {linked && <span className="src-badge" title={`auto-synced from ${goal.data_source} ${goal.data_source_field || ''}`}>↻</span>}
      </div>
      <div className="value">{formatGoalValue(goal.current_value, goal.unit)}</div>
      <div className="target">→ {formatGoalValue(goal.target_value, goal.unit)}</div>
      <div className="bar"><div className="bar-fill" style={{ width: `${Math.round(pct * 100)}%` }} /></div>
      <div className="updated">{linked ? `whoop · ${fmtRelative(goal.updated_at)}` : fmtRelative(goal.updated_at)}</div>
    </Link>
  );
}
