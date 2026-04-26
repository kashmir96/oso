import { useEffect, useState } from 'react';
import Header from '../components/Header.jsx';
import { call, callCached, notifyChanged } from '../lib/api.js';
import { fmtShortDate } from '../lib/format.js';

export default function Weekly() {
  const [summaries, setSummaries] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    const r = await callCached('ckf-weekly', { action: 'list' });
    setSummaries(r.summaries);
  }
  useEffect(() => {
    load().catch((e) => setErr(e.message));
    const handler = () => load().catch(() => {});
    window.addEventListener('ckf-data-changed', handler);
    return () => window.removeEventListener('ckf-data-changed', handler);
  }, []);

  async function generate() {
    setBusy(true); setErr('');
    try { await call('ckf-weekly', { action: 'generate' }); notifyChanged(); await load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  if (!summaries) return <div className="app"><div className="loading">Loading…</div></div>;

  return (
    <div className="app">
      <Header
        title="Weekly"
        right={<button onClick={generate} className="primary" disabled={busy}>{busy ? 'Generating…' : 'Run this week'}</button>}
      />
      {summaries.length === 0 ? (
        <div className="empty">No weekly summaries yet. Tap "Run this week" once you have a few diary entries.</div>
      ) : summaries.map((s) => (
        <div key={s.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>
            {fmtShortDate(s.week_start)} → {fmtShortDate(s.week_end)}
          </div>
          {s.summary && <div style={{ marginBottom: 10 }}>{s.summary}</div>}
          {s.wins && <Section label="Wins"><Lines text={s.wins} /></Section>}
          {s.losses && <Section label="Losses"><Lines text={s.losses} /></Section>}
          {s.bottlenecks && <Section label="Bottlenecks"><Lines text={s.bottlenecks} /></Section>}
          {s.routine_suggestions && <Section label="Routine ideas"><Lines text={s.routine_suggestions} /></Section>}
          {s.business_summary && <Section label="Business"><Lines text={s.business_summary} /></Section>}
          {s.personal_summary && <Section label="Personal"><Lines text={s.personal_summary} /></Section>}
        </div>
      ))}
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
function Lines({ text }) {
  return <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{text}</div>;
}
