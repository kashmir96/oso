import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../lib/api.js';
import { nzToday, fmtShortDate } from '../lib/format.js';

// Horizontal-scroll pills of upcoming items: today's calendar events + business
// deadlines >= today + tomorrow's diary plans + first incomplete routine task.
// Tap any pill → /today.
export default function ComingUpStrip() {
  const [pills, setPills] = useState([]);

  useEffect(() => {
    const today = nzToday();
    Promise.all([
      call('ckf-calendar', { action: 'list_today' }).catch(() => ({ events: [] })),
      call('ckf-tasks', { action: 'today', date: today }),
      call('ckf-business', { action: 'list' }).catch(() => ({ tasks: [] })),
    ])
      .then(([cal, routine, biz]) => {
        const items = [];
        const now = new Date();
        for (const e of (cal?.events || [])) {
          if (!e.start) continue;
          if (!e.all_day && new Date(e.start).getTime() < now.getTime()) continue;
          items.push({
            when: e.start,
            title: e.summary || '(no title)',
            meta: e.all_day
              ? 'all day'
              : new Date(e.start).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit' }),
            kind: 'cal',
          });
        }
        for (const t of (biz?.tasks || [])) {
          if (['done','cancelled'].includes(t.status)) continue;
          if (!t.due_date || t.due_date < today) continue;
          items.push({
            when: `${t.due_date}T23:59:00`,
            title: t.title,
            meta: t.due_date === today ? 'due today' : `due ${fmtShortDate(t.due_date)}`,
            kind: 'biz',
          });
        }
        const undone = (routine?.tasks || []).filter((t) => (t.log?.status || 'not_started') !== 'done').slice(0, 3);
        for (const t of undone) {
          items.push({
            when: null,
            title: t.title,
            meta: 'routine',
            kind: 'routine',
          });
        }
        items.sort((a, b) => (a.when || 'z').localeCompare(b.when || 'z'));
        setPills(items.slice(0, 12));
      })
      .catch(() => setPills([]));
  }, []);

  return (
    <div className="strip">
      <div className="strip-head">
        <Link to="/today" className="strip-title-link">
          <span className="home-title">Coming up</span>
          {pills.length > 0 && <span className="strip-count">{pills.length}</span>}
        </Link>
        <Link to="/today" className="home-manage">all</Link>
      </div>
      <div className="pill-strip">
        {pills.length === 0 ? (
          <div className="pill-empty">Nothing scheduled.</div>
        ) : pills.map((p, i) => (
          <Link key={i} to="/today" className={`action-pill pill-readonly pill-${p.kind}`}>
            <span className="pill-title">{p.title}</span>
            <span className="pill-meta">{p.meta}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
