import { useEffect, useState } from 'react';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import { fmtRelative } from '../../lib/format.js';
import MarketingNav from './MarketingNav.jsx';

export default function Memory() {
  const [facts, setFacts] = useState(null);
  const [err, setErr] = useState('');

  async function load() {
    try {
      const r = await call('mktg-chat', { action: 'list_memory' });
      setFacts(r.facts);
    } catch (e) {
      setErr(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function archive(id) {
    if (!confirm('Archive this fact?')) return;
    await call('mktg-chat', { action: 'archive_memory', id });
    load();
  }

  return (
    <div className="app">
      <Header title="Marketing memory" back />
      <MarketingNav />

      {err && <div className="error">{err}</div>}
      {!facts && !err && <div className="loading">Loading…</div>}
      {facts && facts.length === 0 && <div className="empty">No durable memory yet — Claude will save facts as you talk.</div>}

      <div className="row-list">
        {facts && facts.map((f) => (
          <div key={f.id} className="row-item">
            <div className="name">
              <span className="dim" style={{ fontSize: 11, marginRight: 6 }}>[{f.importance}]</span>
              {f.fact}
            </div>
            <div className="meta">
              {f.topic && <span>{f.topic}</span>}
              <span className="dim">{fmtRelative(f.created_at)}</span>
              <span className="spacer" />
              <button
                onClick={() => archive(f.id)}
                className="danger"
                style={{ fontSize: 11, padding: '4px 10px' }}
              >Archive</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
