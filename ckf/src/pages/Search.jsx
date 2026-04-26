import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header.jsx';
import { call } from '../lib/api.js';
import { fmtRelative, fmtShortDate } from '../lib/format.js';

// One search box across diary, memory, swipefile, goals, errands, meals,
// business tasks, and chat messages. Debounced; results grouped by source.
export default function Search() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [err, setErr] = useState('');
  const debounce = useRef(null);

  useEffect(() => {
    if (!q.trim()) { setResults(null); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setBusy(true); setErr('');
      try {
        const r = await call('ckf-search', { action: 'search', q, limit_per: 10 });
        setResults(r.results);
      } catch (e) { setErr(e.message); } finally { setBusy(false); }
    }, 220);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q]);

  function totalHits(r) {
    if (!r) return 0;
    return Object.values(r).reduce((s, arr) => s + (arr?.length || 0), 0);
  }

  return (
    <div className="app">
      <Header title="Search" back />
      <div className="card" style={{ marginBottom: 12 }}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search everything — diary, memory, swipefile, goals, meals…"
        />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          {q.trim() === '' ? 'Type to search.' : busy ? 'Searching…' : results ? `${totalHits(results)} hit${totalHits(results) === 1 ? '' : 's'}` : ''}
        </div>
      </div>

      {err && <div className="error">{err}</div>}

      {results && (
        <>
          <Section title="Diary entries" items={results.diary} render={(d) => (
            <Link to="/chat" className="search-row" key={d.id}>
              <div className="search-meta">{fmtShortDate(d.date)}</div>
              <div className="search-title">{d.ai_summary || d.unfiltered || d.personal_bad || d.bottlenecks || '(see entry)'}</div>
            </Link>
          )} />

          <Section title="Memory facts" items={results.memory} render={(m) => (
            <div className="search-row" key={m.id}>
              <div className="search-meta">{m.topic || 'memory'} · ★{m.importance}</div>
              <div className="search-title">{m.fact}</div>
            </div>
          )} />

          <Section title="Swipefile" items={results.swipefile} render={(s) => (
            <Link to="/swipefile" className="search-row" key={s.id}>
              <div className="search-meta">{s.kind} · {s.category}{s.author ? ` · ${s.author}` : ''}</div>
              <div className="search-title">{s.title || s.source_url || '(untitled)'}</div>
              {s.why_it_matters && <div className="search-sub">{s.why_it_matters}</div>}
            </Link>
          )} />

          <Section title="Goals" items={results.goals} render={(g) => (
            <Link to={`/goals/${g.id}`} className="search-row" key={g.id}>
              <div className="search-meta">{g.category} · {g.goal_type}{g.status === 'archived' ? ' · archived' : ''}</div>
              <div className="search-title">{g.name}</div>
              <div className="search-sub">{g.current_value ?? '—'} → {g.target_value ?? '—'} {g.unit || ''}</div>
            </Link>
          )} />

          <Section title="Errands" items={results.errands} render={(e) => (
            <Link to="/errands" className="search-row" key={e.id}>
              <div className="search-meta">{e.status} · {e.category}{e.due_date ? ` · due ${fmtShortDate(e.due_date)}` : ''}</div>
              <div className="search-title">{e.title}</div>
              {e.description && <div className="search-sub">{e.description}</div>}
            </Link>
          )} />

          <Section title="Meals" items={results.meals} render={(m) => (
            <Link to="/meals" className="search-row" key={m.id} style={{ display: 'flex', gap: 8 }}>
              {m.image_url && <img src={m.image_url} alt="" style={{ width: 50, height: 50, borderRadius: 6, objectFit: 'cover' }} />}
              <div style={{ flex: 1 }}>
                <div className="search-meta">{fmtShortDate(m.meal_date)}</div>
                <div className="search-title">{m.manual_label || m.ai_label || 'Meal'}</div>
                <div className="search-sub">{(m.manual_calories ?? m.ai_calories) || '—'} cal</div>
              </div>
            </Link>
          )} />

          <Section title="Business tasks" items={results.business_tasks} render={(t) => (
            <Link to="/business/tasks" className="search-row" key={t.id}>
              <div className="search-meta">{t.status}{t.due_date ? ` · due ${fmtShortDate(t.due_date)}` : ''} · P{t.priority || 3}</div>
              <div className="search-title">{t.title}</div>
              {t.objective && <div className="search-sub">{t.objective}</div>}
            </Link>
          )} />

          <Section title="Chat" items={results.messages} render={(msg) => (
            <Link to={`/chat/${msg.conversation_id}`} className="search-row" key={msg.id}>
              <div className="search-meta">{msg.role} · {fmtRelative(msg.created_at)}</div>
              <div className="search-title">{(msg.content_text || '').slice(0, 200)}</div>
            </Link>
          )} />
        </>
      )}
    </div>
  );
}

function Section({ title, items, render }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{title}</span>
        <span style={{ color: 'var(--text-muted)' }}>{items.length}</span>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {items.map((it) => render(it))}
      </div>
    </div>
  );
}
