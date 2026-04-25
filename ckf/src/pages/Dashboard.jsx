import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GoalCard from '../components/GoalCard.jsx';
import { call } from '../lib/api.js';
import Chat from './Chat.jsx';

// Home: goals widgets at the top, chat directly below.
// Bottom nav (Home / Business / Daily Routine / Settings) overlays at the bottom.
export default function Dashboard() {
  const [goals, setGoals] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    call('ckf-goals', { action: 'list' })
      .then((r) => { if (alive) setGoals(r.goals.filter((g) => g.status === 'active')); })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="home">
      <div className="home-goals">
        <div className="home-goals-head">
          <div className="home-title">Goals</div>
          <Link to="/goals" className="home-manage">Manage</Link>
        </div>
        {err && <div className="error">{err}</div>}
        {!goals ? (
          <div className="loading" style={{ padding: '8px 0' }}>Loading…</div>
        ) : goals.length === 0 ? (
          <div className="empty" style={{ padding: '6px 0', textAlign: 'left' }}>
            No goals yet. Tell the chat what you want to track, or <Link to="/goals">add one</Link>.
          </div>
        ) : (
          <div className="goal-grid home-goal-grid">
            {goals.map((g) => <GoalCard key={g.id} goal={g} />)}
          </div>
        )}
      </div>
      <div className="home-chat">
        <Chat embedded />
      </div>
    </div>
  );
}
