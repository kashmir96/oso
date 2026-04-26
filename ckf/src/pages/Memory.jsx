import { useEffect, useState } from 'react';
import Header from '../components/Header.jsx';
import { call, callCached, notifyChanged } from '../lib/api.js';
import { fmtRelative } from '../lib/format.js';

// Read-only view of long-term memory facts the AI has accumulated. You can
// archive any fact that's outdated or wrong.
export default function Memory() {
  const [facts, setFacts] = useState(null);
  const [topic, setTopic] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    const r = await callCached('ckf-chat', { action: 'list_memory', topic: topic || undefined });
    setFacts(r.facts);
  }
  useEffect(() => {
    load().catch((e) => setErr(e.message));
    const handler = () => load().catch(() => {});
    window.addEventListener('ckf-data-changed', handler);
    return () => window.removeEventListener('ckf-data-changed', handler);
    /* eslint-disable-next-line */
  }, [topic]);

  async function archive(id) {
    if (!confirm('Archive this memory?')) return;
    await call('ckf-chat', { action: 'archive_memory', id });
    notifyChanged();
    load();
  }

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  if (!facts) return <div className="app"><div className="loading">Loading…</div></div>;

  // Group by topic for skim
  const byTopic = facts.reduce((acc, f) => {
    const k = f.topic || '—';
    acc[k] = acc[k] || [];
    acc[k].push(f);
    return acc;
  }, {});
  const topics = Object.keys(byTopic).sort();

  return (
    <div className="app">
      <Header title="Memory" back />
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field">
          <label>Filter by topic</label>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="leave blank for all" />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {facts.length} active fact{facts.length === 1 ? '' : 's'}.
        </div>
      </div>

      {facts.length === 0 ? (
        <div className="empty">Nothing remembered yet. Talk to the AI and it'll start building context.</div>
      ) : topics.map((t) => (
        <div key={t} style={{ marginBottom: 14 }}>
          <div className="section-title">{t}</div>
          {byTopic[t].map((f) => (
            <div key={f.id} className="card" style={{ marginBottom: 6, padding: '10px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div>{f.fact}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    importance {f.importance} · {fmtRelative(f.created_at)}
                  </div>
                </div>
                <button onClick={() => archive(f.id)} className="danger" style={{ padding: '4px 10px', fontSize: 12 }}>Archive</button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
