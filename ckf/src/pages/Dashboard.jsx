import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GoalCard from '../components/GoalCard.jsx';
import ErrandsCard from '../components/ErrandsCard.jsx';
import ComingUpStrip from '../components/ComingUpStrip.jsx';
import { call } from '../lib/api.js';
import Chat from './Chat.jsx';

// Home: goals strip → Coming up pills → Errands pills → embedded chat.
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

      <ComingUpStrip />

      <ErrandsCard
        title="Errands"
        filter="not_business"
        defaultCategory="personal"
        moreHref="/errands"
      />

      <div className="home-chat">
        <Chat embedded />
      </div>
    </div>
  );
}
