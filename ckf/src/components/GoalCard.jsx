import { Link } from 'react-router-dom';
import { progressPct, formatGoalValue, fmtRelative } from '../lib/format.js';

export default function GoalCard({ goal }) {
  const pct = progressPct(goal);
  return (
    <Link to={`/goals/${goal.id}`} className="goal-card" style={{ color: 'inherit', textDecoration: 'none' }}>
      <div className="name">{goal.name}</div>
      <div className="value">{formatGoalValue(goal.current_value, goal.unit)}</div>
      <div className="target">→ {formatGoalValue(goal.target_value, goal.unit)}</div>
      <div className="bar"><div className="bar-fill" style={{ width: `${Math.round(pct * 100)}%` }} /></div>
      <div className="updated">{fmtRelative(goal.updated_at)}</div>
    </Link>
  );
}
