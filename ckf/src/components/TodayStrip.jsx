import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { call, callCached, notifyChanged } from '../lib/api.js';
import { nzToday, fmtShortDate } from '../lib/format.js';

// One mixed horizontal pill strip — combines:
//   - open errands (filterable by 'business' / 'not_business')
//   - today's calendar events (in scope = 'all' only)
//   - upcoming business deadlines (in scope = 'all' or 'business')
//   - first few undone routine tasks (in scope = 'all')
//
// Sorted by `when` so timed items flow chronologically; routine tasks /
// untimed errands group at the end.
//
// Props:
//   title           — heading
//   scope           — 'all' (Home) | 'business' (Business)
//   defaultCategory — what to assign newly-added errands ("+" pill)
//   moreHref        — link target (header + non-errand pills)
export default function TodayStrip({ title = 'Today', scope = 'all', defaultCategory = 'personal', moreHref = '/today' }) {
  const [pills, setPills] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    const today = nzToday();
    const errandFilter = scope === 'business' ? 'business' : 'not_business';
    const [errR, calR, bizR, routR] = await Promise.all([
      callCached('ckf-errands', { action: 'list', status: 'open', category: errandFilter }).catch(() => ({ errands: [] })),
      scope === 'all'
        ? callCached('ckf-calendar', { action: 'list_today' }, 60_000).catch(() => ({ events: [] }))
        : Promise.resolve({ events: [] }),
      callCached('ckf-business', { action: 'list' }).catch(() => ({ tasks: [] })),
      scope === 'all'
        ? callCached('ckf-tasks', { action: 'today', date: today }).catch(() => ({ tasks: [] }))
        : Promise.resolve({ tasks: [] }),
    ]);

    const out = [];
    const now = Date.now();

    for (const e of (calR.events || [])) {
      if (!e.start) continue;
      if (!e.all_day && new Date(e.start).getTime() < now) continue;
      out.push({
        kind: 'cal', id: 'c-' + e.id,
        title: e.summary || '(no title)',
        meta: e.all_day
          ? 'all day'
          : new Date(e.start).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit' }),
        when: e.start,
      });
    }
    for (const t of (bizR.tasks || [])) {
      if (['done','cancelled'].includes(t.status)) continue;
      if (!t.due_date || t.due_date < today) continue;
      out.push({
        kind: 'biz', id: 'b-' + t.id,
        title: t.title,
        meta: t.due_date === today ? 'due today' : `due ${fmtShortDate(t.due_date)}`,
        when: `${t.due_date}T23:59:00`,
      });
    }
    for (const e of (errR.errands || [])) {
      out.push({
        kind: 'errand', id: 'e-' + e.id, errand_id: e.id,
        title: e.title,
        meta: e.due_date ? fmtShortDate(e.due_date) : (e.remind_at ? '⏰' : null),
        when: e.remind_at || (e.due_date ? `${e.due_date}T12:00:00` : null),
      });
    }
    const undone = (routR.tasks || []).filter((t) => (t.log?.status || 'not_started') !== 'done').slice(0, 4);
    for (const t of undone) {
      out.push({
        kind: 'routine', id: 'r-' + t.id,
        title: t.title,
        meta: 'routine',
        when: null,
      });
    }
    out.sort((a, b) => (a.when || 'z').localeCompare(b.when || 'z'));
    setPills(out);
  }

  useEffect(() => {
    load().catch((e) => setErr(e.message));
    const handler = () => load().catch(() => {});
    window.addEventListener('ckf-data-changed', handler);
    // Refresh when the tab regains focus (covers SMS reminders firing in background, etc.)
    const onVisible = () => { if (document.visibilityState === 'visible') load().catch(() => {}); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('ckf-data-changed', handler);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  async function quickAdd(e) {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await call('ckf-errands', { action: 'create', title: draft.trim(), category: defaultCategory });
      setDraft(''); setAdding(false); notifyChanged(); load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function completeErrand(errandId) {
    try { await call('ckf-errands', { action: 'complete', id: errandId }); notifyChanged(); load(); } catch {}
  }

  return (
    <div className="strip">
      <div className="strip-head">
        <Link to={moreHref} className="strip-title-link">
          <span className="home-title">{title}</span>
          {pills && pills.length > 0 && <span className="strip-count">{pills.length}</span>}
        </Link>
        <Link to={moreHref} className="home-manage">all</Link>
      </div>

      {adding && (
        <form className="errands-quick-form" onSubmit={quickAdd}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={defaultCategory === 'business' ? 'Add a job…' : 'Add an errand…'}
          />
          <button className="primary" type="submit" disabled={busy || !draft.trim()}>Add</button>
          <button type="button" onClick={() => { setAdding(false); setDraft(''); }}>×</button>
        </form>
      )}

      {err && <div className="error">{err}</div>}

      <div className="pill-strip">
        <button
          className="pill-add"
          onClick={() => setAdding((v) => !v)}
          aria-label={defaultCategory === 'business' ? 'Add a job' : 'Add an errand'}
          title={defaultCategory === 'business' ? 'Add a job' : 'Add an errand'}
        >+</button>

        {!pills ? (
          <div className="pill-skeleton" />
        ) : pills.length === 0 ? (
          <div className="pill-empty">Nothing on. Add one or ask the chat.</div>
        ) : pills.map((p) => (
          p.kind === 'errand' ? (
            <button
              key={p.id}
              className={`action-pill pill-${p.kind}`}
              onClick={() => completeErrand(p.errand_id)}
              title={`Mark "${p.title}" done`}
            >
              <span className="pill-tick">○</span>
              <span className="pill-title">{p.title}</span>
              {p.meta && <span className="pill-meta">{p.meta}</span>}
            </button>
          ) : (
            <Link
              key={p.id}
              to={moreHref}
              className={`action-pill pill-readonly pill-${p.kind}`}
            >
              <span className="pill-title">{p.title}</span>
              {p.meta && <span className="pill-meta">{p.meta}</span>}
            </Link>
          )
        ))}
      </div>
    </div>
  );
}
