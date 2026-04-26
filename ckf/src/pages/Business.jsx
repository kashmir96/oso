import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GoalCard from '../components/GoalCard.jsx';
import TodayStrip from '../components/TodayStrip.jsx';
import { callCached } from '../lib/api.js';
import Chat from './Chat.jsx';

const BUSINESS_CATEGORIES = new Set(['business', 'marketing', 'finance']);

// Business: stripped to the essentials — business goals strip, jobs line,
// embedded chat. Mode switches (marketing / website / swipefile) all happen
// inside the chat by typing the trigger phrase. No floating buttons, no
// extra sections. Projects + website-improvements are still captured by
// the chat tools and viewable via /business/tasks (jobs strip → Tasks link).
export default function Business() {
  const [goals, setGoals] = useState(null);
  const [openTaskCount, setOpenTaskCount] = useState(0);
  const [err, setErr] = useState('');

  function refresh() {
    Promise.all([
      callCached('ckf-goals', { action: 'list' }),
      callCached('ckf-business', { action: 'list' }).catch(() => ({ tasks: [] })),
    ])
      .then(([g, b]) => {
        const filtered = g.goals.filter((x) =>
          x.status === 'active' && BUSINESS_CATEGORIES.has(x.category)
        );
        setGoals(filtered);
        setOpenTaskCount((b.tasks || []).filter((t) => !['done','cancelled'].includes(t.status)).length);
      })
      .catch((e) => setErr(e.message));
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className="home">
      <div className="home-goals">
        <div className="home-goals-head">
          <div className="home-title">Business goals</div>
          <Link to="/business/tasks" className="home-manage">
            Tasks{openTaskCount ? ` (${openTaskCount})` : ''}
          </Link>
        </div>
        {err && <div className="error">{err}</div>}
        {!goals ? (
          <div className="loading" style={{ padding: '8px 0' }}>Loading…</div>
        ) : goals.length === 0 ? (
          <div className="empty" style={{ padding: '6px 12px', textAlign: 'left' }}>
            No business goals yet. Tell the chat what business metric you want to track —
            revenue, weekly content output, CPA, conversion rate.
          </div>
        ) : (
          <div className="goal-grid home-goal-grid">
            {goals.map((g) => <GoalCard key={g.id} goal={g} onChanged={refresh} />)}
          </div>
        )}
      </div>

      <TodayStrip
        title="Jobs"
        scope="business"
        defaultCategory="business"
        moreHref="/business/tasks"
      />

      <div className="home-chat">
        <Chat embedded scope="business" />
      </div>
    </div>
  );
}
