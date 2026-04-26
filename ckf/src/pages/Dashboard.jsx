import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import GoalCard from '../components/GoalCard.jsx';
import { call } from '../lib/api.js';
import { nzToday, fmtShortDate } from '../lib/format.js';
import Chat from './Chat.jsx';

// Home: goals strip → Coming up one-liner → embedded chat.
export default function Dashboard() {
  const [goals, setGoals] = useState(null);
  const [next, setNext] = useState(null);
  const [err, setErr] = useState('');
  const today = nzToday();

  function refresh() {
    call('ckf-goals', { action: 'list' })
      .then((r) => setGoals(r.goals.filter((g) => g.status === 'active')))
      .catch((e) => setErr(e.message));

    // Compute next coming-up item: earliest of today's calendar events,
    // today's business deadlines, today's first incomplete routine task.
    Promise.all([
      call('ckf-calendar', { action: 'list_today' }).catch(() => ({ events: [] })),
      call('ckf-tasks', { action: 'today', date: today }),
      call('ckf-business', { action: 'list' }).catch(() => ({ tasks: [] })),
    ]).then(([cal, routine, biz]) => {
      const candidates = [];
      const now = new Date();
      for (const e of (cal?.events || [])) {
        if (!e.start) continue;
        const startTs = new Date(e.start).getTime();
        if (!e.all_day && startTs < now.getTime()) continue;
        candidates.push({
          when: e.start,
          title: e.summary || '(no title)',
          meta: e.all_day
            ? 'all day'
            : new Date(e.start).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit' }),
          source: 'calendar',
        });
      }
      for (const t of (biz?.tasks || [])) {
        if (['done','cancelled'].includes(t.status)) continue;
        if (!t.due_date) continue;
        if (t.due_date < today) continue;
        candidates.push({
          when: `${t.due_date}T23:59:00`,
          title: t.title,
          meta: t.due_date === today ? 'due today' : `due ${fmtShortDate(t.due_date)}`,
          source: 'business',
        });
      }
      const firstUndoneRoutine = (routine?.tasks || []).find((t) => (t.log?.status || 'not_started') !== 'done');
      if (firstUndoneRoutine) {
        candidates.push({
          when: null, // no specific time — comes after timed events
          title: firstUndoneRoutine.title,
          meta: 'routine',
          source: 'routine',
        });
      }
      candidates.sort((a, b) => (a.when || 'z').localeCompare(b.when || 'z'));
      setNext(candidates[0] || null);
    }).catch(() => setNext(null));
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

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

      <Link to="/today" className="coming-up" aria-label="Open routine">
        <span className="coming-up-label">Coming up</span>
        {next ? (
          <span className="coming-up-body">
            <span className="coming-up-title">{next.title}</span>
            <span className="coming-up-meta">{next.meta}</span>
          </span>
        ) : (
          <span className="coming-up-body coming-up-empty">Nothing scheduled</span>
        )}
        <span className="coming-up-arrow">›</span>
      </Link>

      <div className="home-chat">
        <Chat embedded />
      </div>
    </div>
  );
}
