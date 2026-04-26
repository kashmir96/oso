import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GoalCard from '../components/GoalCard.jsx';
import TodayStrip from '../components/TodayStrip.jsx';
import { call } from '../lib/api.js';
import Chat from './Chat.jsx';

// Home: goals strip → mixed Today strip (errands + calendar + biz + routine) → chat.
export default function Dashboard() {
  const [goals, setGoals] = useState(null);
  const [err, setErr] = useState('');

  function refresh() {
    call('ckf-goals', { action: 'list' })
      .then((r) => setGoals(r.goals.filter((g) => g.status === 'active')))
      .catch((e) => setErr(e.message));
  }
  useEffect(() => { refresh(); }, []);

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
          <div className="empty" style={{ padding: '6px 12px', textAlign: 'left' }}>
            No goals yet. Tell the chat what you want to track, or <Link to="/goals">add one</Link>.
          </div>
        ) : (
          <div className="goal-grid home-goal-grid">
            {goals.map((g) => <GoalCard key={g.id} goal={g} onChanged={refresh} />)}
          </div>
        )}
      </div>

      <TodayStrip
        title="Today"
        scope="all"
        defaultCategory="personal"
        moreHref="/today"
      />

      <div className="home-chat">
        <Chat embedded scope="personal" />
      </div>
    </div>
  );
}
