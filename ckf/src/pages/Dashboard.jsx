import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header.jsx';
import GoalCard from '../components/GoalCard.jsx';
import { call } from '../lib/api.js';
import { nzToday } from '../lib/format.js';

export default function Dashboard() {
  const [goals, setGoals] = useState(null);
  const [today, setToday] = useState(null);
  const [pending, setPending] = useState([]);
  const [err, setErr] = useState('');
  const date = nzToday();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [g, t, s] = await Promise.all([
          call('ckf-goals', { action: 'list' }),
          call('ckf-tasks', { action: 'today', date }),
          call('ckf-suggestions', { action: 'list', status: 'pending' }),
        ]);
        if (!alive) return;
        setGoals(g.goals.filter((x) => x.status === 'active'));
        setToday(t.tasks);
        setPending(s.suggestions);
      } catch (e) {
        if (alive) setErr(e.message);
      }
    })();
    return () => { alive = false; };
  }, [date]);

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  if (!goals || !today) return <div className="app"><div className="loading">Loading…</div></div>;

  const doneCount = today.filter((t) => t.log?.status === 'done').length;

  return (
    <div className="app">
      <Header
        title="Today"
        right={<Link to="/goals" style={{ fontSize: 13 }}>Manage</Link>}
      />

      {goals.length === 0 ? (
        <div className="empty">
          No goals yet. <Link to="/goals">Add one</Link>.
        </div>
      ) : (
        <div className="goal-grid">
          {goals.map((g) => <GoalCard key={g.id} goal={g} />)}
        </div>
      )}

      <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Today's routine</span>
        <span style={{ color: 'var(--text-muted)' }}>{doneCount}/{today.length}</span>
      </div>

      {today.length === 0 ? (
        <div className="empty">No routine tasks for today. <Link to="/today">Add one</Link>.</div>
      ) : (
        <div className="card">
          {today.slice(0, 6).map((t) => (
            <div key={t.id} className={`today-task ${t.log?.status === 'done' ? 'done' : ''}`}>
              <div className={`checkbox ${t.log?.status || ''}`}>{t.log?.status === 'done' ? '✓' : ''}</div>
              <div className="body">
                <div className="title">{t.title}</div>
                <div className="meta">{t.category}{t.estimated_minutes ? ` · ${t.estimated_minutes}m` : ''}</div>
              </div>
            </div>
          ))}
          <div style={{ textAlign: 'right', marginTop: 8 }}>
            <Link to="/today" style={{ fontSize: 13 }}>Open routine →</Link>
          </div>
        </div>
      )}

      <div className="section-title">Tonight</div>
      <div className="card">
        <div style={{ marginBottom: 10 }}>Talk it through — therapist by default, hat switches by context.</div>
        <Link to="/chat">
          <button className="primary" style={{ width: '100%' }}>Open chat</button>
        </Link>
      </div>

      {pending.length > 0 && (
        <>
          <div className="section-title">{pending.length} suggestion{pending.length === 1 ? '' : 's'} awaiting approval</div>
          <div className="card">
            {pending.slice(0, 3).map((s) => (
              <div key={s.id} className="suggestion" style={{ borderStyle: 'solid' }}>
                <div>{s.suggestion}</div>
                {s.reason && <div className="why">{s.reason}</div>}
              </div>
            ))}
            <div style={{ textAlign: 'right' }}>
              <Link to="/settings" style={{ fontSize: 13 }}>Review all →</Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
