import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import { nzd, num, pct, STATUS_LABEL, statusPillClass } from './format.js';
import MarketingNav from './MarketingNav.jsx';

export default function ConceptDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    call('mktg-data', { action: 'get_concept', id })
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [id]);

  if (err) return (<div className="app"><Header title="Concept" back /><MarketingNav /><div className="error">{err}</div></div>);
  if (!data) return (<div className="app"><Header title="Concept" back /><MarketingNav /><div className="loading">Loading…</div></div>);
  if (!data.concept) return (<div className="app"><Header title="Not found" back /><MarketingNav /><div className="empty">No concept with id {id}.</div></div>);

  const c = data.concept;
  const perf = c.performance || {};

  return (
    <div className="app">
      <Header title={c.name} crumb={`Concept · ${c.campaign_id || '—'}`} back />
      <MarketingNav />

      <div className="card">
        <span className={statusPillClass(c.status)}>{STATUS_LABEL[c.status] || c.status}</span>
        {c.notes && <div style={{ marginTop: 10 }}>{c.notes}</div>}
      </div>

      {Object.keys(perf).length > 0 && (
        <>
          <div className="section-title"><span>Performance</span></div>
          <div className="stat-grid">
            <Stat label="Spend" value={perf.spend_nzd != null ? nzd(perf.spend_nzd) : '—'} />
            <Stat label="Sales" value={perf.results != null ? num(perf.results) : '—'} />
            <Stat label="CPR" value={perf.cpr_nzd != null ? nzd(perf.cpr_nzd) : '—'} />
            <Stat label="CTR" value={perf.ctr_link_pct != null ? pct(perf.ctr_link_pct) : '—'} />
          </div>
          {perf.notes && <div className="card" style={{ marginTop: 10 }}>{perf.notes}</div>}
        </>
      )}

      {data.copy_archetype && (
        <>
          <div className="section-title"><span>Copy archetype</span></div>
          <div className="card">
            <div className="title">{data.copy_archetype.name} <span className="dim" style={{ fontSize: 12 }}>· {data.copy_archetype.type_label}</span></div>
            {data.copy_archetype.description && <div className="sub" style={{ marginTop: 4 }}>{data.copy_archetype.description}</div>}
            {data.copy_archetype.structure && (
              <details style={{ marginTop: 10 }}>
                <summary className="dim" style={{ fontSize: 12 }}>Structure</summary>
                <div className="ad-body" style={{ marginTop: 6 }}>{data.copy_archetype.structure}</div>
              </details>
            )}
            {data.copy_archetype.example_body && (
              <details style={{ marginTop: 10 }}>
                <summary className="dim" style={{ fontSize: 12 }}>Example body</summary>
                <div className="ad-body" style={{ marginTop: 6 }}>{data.copy_archetype.example_body}</div>
              </details>
            )}
          </div>
        </>
      )}

      {data.visual_archetypes.length > 0 && (
        <>
          <div className="section-title"><span>Visual archetypes</span></div>
          <div className="row-list">
            {data.visual_archetypes.map((v) => (
              <div key={v.id} className="row-item">
                <div className="name">{v.id} · {v.name}</div>
                {v.description && <div className="meta">{v.description}</div>}
                {v.vibe && <div className="meta dim">{v.vibe}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {data.video_openers.length > 0 && (
        <>
          <div className="section-title"><span>Video openers</span></div>
          <div className="row-list">
            {data.video_openers.map((v) => (
              <div key={v.id} className="row-item">
                <div className="name">{v.id} · {v.name}</div>
                {v.description && <div className="meta">{v.description}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title"><span>Ads using this concept ({data.ads.length})</span></div>
      {data.ads.length === 0 && <div className="empty">No ads tagged to this concept.</div>}
      <div className="row-list">
        {data.ads.map((a) => (
          <Link key={a.ad_id} to={`/business/marketing/ads/${encodeURIComponent(a.ad_id)}`} className="row-item">
            <div className="name">{a.ad_name}</div>
            <div className="meta">
              {a.format && <span>{a.format}</span>}
              {a.performance?.spend_nzd != null && <span>spend <strong>{nzd(a.performance.spend_nzd)}</strong></span>}
              {a.performance?.results != null && <span>sales <strong>{num(a.performance.results)}</strong></span>}
              {a.performance?.cpr_nzd != null && <span>CPR <strong>{nzd(a.performance.cpr_nzd)}</strong></span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
