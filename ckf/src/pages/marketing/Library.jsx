import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import { STATUS_LABEL, statusPillClass } from './format.js';
import MarketingNav from './MarketingNav.jsx';

const SECTIONS = [
  { key: 'copy',     label: 'Copy archetypes' },
  { key: 'visual',   label: 'Visual archetypes' },
  { key: 'video',    label: 'Video openers' },
  { key: 'offers',   label: 'Offers' },
  { key: 'hooks',    label: 'Hooks' },
  { key: 'symptoms', label: 'Symptoms' },
  { key: 'trust',    label: 'Trust signals' },
  { key: 'locked',   label: 'Locked decisions' },
  { key: 'weekly',   label: 'Weekly batches' },
  { key: 'scripts',  label: 'Production scripts' },
];

export default function Library() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'copy';

  return (
    <div className="app">
      <Header title="Library" back />
      <MarketingNav />

      <div className="filterbar" style={{ overflowX: 'auto' }}>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            className={tab === s.key ? 'primary' : ''}
            style={{ fontSize: 12, padding: '6px 10px' }}
            onClick={() => setParams({ tab: s.key }, { replace: true })}
          >
            {s.label}
          </button>
        ))}
      </div>

      <Section tab={tab} />
    </div>
  );
}

function Section({ tab }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setRows(null); setErr('');
    let p;
    switch (tab) {
      case 'copy':    p = call('mktg-data', { action: 'list_archetypes', kind: 'copy' }).then((r) => r.archetypes); break;
      case 'visual':  p = call('mktg-data', { action: 'list_archetypes', kind: 'visual' }).then((r) => r.archetypes); break;
      case 'video':   p = call('mktg-data', { action: 'list_archetypes', kind: 'video' }).then((r) => r.archetypes); break;
      case 'offers':  p = call('mktg-data', { action: 'list_offers' }).then((r) => r.offers); break;
      case 'hooks':   p = call('mktg-data', { action: 'list_hooks' }).then((r) => r.hooks); break;
      case 'symptoms':p = call('mktg-data', { action: 'list_symptoms' }).then((r) => r.symptoms); break;
      case 'trust':   p = call('mktg-data', { action: 'list_trust_signals' }).then((r) => r.trust_signals); break;
      case 'locked':  p = call('mktg-data', { action: 'list_locked_decisions' }).then((r) => r.locked_decisions); break;
      case 'weekly':  p = call('mktg-data', { action: 'list_weekly_batches' }).then((r) => r.weekly_batches); break;
      case 'scripts': p = call('mktg-data', { action: 'list_scripts' }).then((r) => r.scripts); break;
      default:        p = Promise.resolve([]);
    }
    p.then(setRows).catch((e) => setErr(e.message));
  }, [tab]);

  if (err) return <div className="error">{err}</div>;
  if (!rows) return <div className="loading">Loading…</div>;
  if (rows.length === 0) return <div className="empty">No rows.</div>;

  switch (tab) {
    case 'copy':     return <CopyList rows={rows} />;
    case 'visual':   return <VisualList rows={rows} />;
    case 'video':    return <VideoList rows={rows} />;
    case 'offers':   return <OffersList rows={rows} />;
    case 'hooks':    return <HooksList rows={rows} />;
    case 'symptoms': return <SymptomsList rows={rows} />;
    case 'trust':    return <TrustList rows={rows} />;
    case 'locked':   return <LockedList rows={rows} />;
    case 'weekly':   return <WeeklyList rows={rows} />;
    case 'scripts':  return <ScriptsList rows={rows} />;
    default:         return null;
  }
}

function CopyList({ rows }) {
  return (
    <div className="row-list">
      {rows.map((r) => (
        <div key={r.id} className="row-item">
          <div className="name">
            {r.name} <span className="dim" style={{ fontSize: 12 }}>· {r.type_label} · {r.campaign_id}</span>
            <span className={statusPillClass(r.status)} style={{ marginLeft: 8 }}>{STATUS_LABEL[r.status] || r.status}</span>
          </div>
          {r.description && <div className="meta">{r.description}</div>}
        </div>
      ))}
    </div>
  );
}

function VisualList({ rows }) {
  return (
    <div className="row-list">
      {rows.map((r) => (
        <div key={r.id} className="row-item">
          <div className="name">{r.id} · {r.name}</div>
          {r.description && <div className="meta">{r.description}</div>}
          {r.vibe && <div className="meta dim">{r.vibe}</div>}
        </div>
      ))}
    </div>
  );
}

function VideoList({ rows }) {
  return (
    <div className="row-list">
      {rows.map((r) => (
        <div key={r.id} className="row-item">
          <div className="name">{r.id} · {r.name}</div>
          {r.description && <div className="meta">{r.description}</div>}
          {r.structure && <div className="body clip">{r.structure}</div>}
        </div>
      ))}
    </div>
  );
}

function OffersList({ rows }) {
  return (
    <div className="row-list">
      {rows.map((r) => (
        <div key={r.id} className="row-item">
          <div className="name">{r.name}</div>
          {r.mechanic && <div className="meta">{r.mechanic}</div>}
          {r.example_copy && <div className="body clip">{r.example_copy}</div>}
        </div>
      ))}
    </div>
  );
}

function HooksList({ rows }) {
  return (
    <div className="row-list">
      {rows.map((r) => (
        <div key={r.id} className="row-item">
          <div className="name">{r.text}</div>
          <div className="meta">
            {r.use && <span>{r.use}</span>}
            {r.opener_style && <span>{r.opener_style}</span>}
            {r.campaign_ids?.length > 0 && <span>{r.campaign_ids.join(', ')}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function SymptomsList({ rows }) {
  return (
    <div className="row-list">
      {rows.map((r) => (
        <div key={r.id} className="row-item">
          <div className="name">{r.text}</div>
          <div className="meta">
            <span>{r.category}</span>
            {r.applies_to?.length > 0 && <span>{r.applies_to.join(', ')}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function TrustList({ rows }) {
  return (
    <div className="row-list">
      {rows.map((r) => (
        <div key={r.id} className="row-item">
          <div className="name">{r.label}</div>
          {r.details && <div className="meta">{r.details}</div>}
          {r.applies_to?.length > 0 && <div className="meta dim">applies to {r.applies_to.join(', ')}</div>}
        </div>
      ))}
    </div>
  );
}

function LockedList({ rows }) {
  return (
    <div className="row-list">
      {rows.map((r) => (
        <div key={r.key} className="row-item">
          <div className="name">{r.key} <span className="dim" style={{ fontSize: 12 }}>· {r.resolved_date}</span></div>
          <div className="meta"><strong>{r.value}</strong></div>
          {r.notes && <div className="body">{r.notes}</div>}
        </div>
      ))}
    </div>
  );
}

function WeeklyList({ rows }) {
  return (
    <div className="row-list">
      {rows.map((w) => (
        <div key={w.week_starting} className="row-item">
          <div className="name">Week of {w.week_starting}</div>
          {w.briefing?.launches?.length > 0 && <div className="meta"><strong>Launches:</strong> {w.briefing.launches.join(', ')}</div>}
          {w.topical_layers?.length > 0 && <div className="meta dim">{w.topical_layers.join(' · ')}</div>}
          {w.ad_slots?.length > 0 && <div className="meta">{w.ad_slots.length} ad slots</div>}
        </div>
      ))}
    </div>
  );
}

function ScriptsList({ rows }) {
  return (
    <div className="row-list">
      {rows.map((s) => (
        <Link key={s.id} to={`/business/marketing/scripts/${s.id}`} className="row-item">
          <div className="name">
            {s.name}{' '}
            <span className={statusPillClass(s.status)} style={{ marginLeft: 6 }}>{STATUS_LABEL[s.status] || s.status}</span>
          </div>
          <div className="meta">
            {s.campaign_id && <span>{s.campaign_id}</span>}
            {s.length_words != null && <span>{s.length_words} words</span>}
          </div>
        </Link>
      ))}
    </div>
  );
}
