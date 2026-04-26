import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import { nzd, nzdPrecise, num, pct } from './format.js';
import MarketingNav from './MarketingNav.jsx';

export default function AdDetail() {
  const { ad_id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    call('mktg-data', { action: 'get_ad', ad_id })
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [ad_id]);

  if (err) return (<div className="app"><Header title="Ad" back /><MarketingNav /><div className="error">{err}</div></div>);
  if (!data) return (<div className="app"><Header title="Ad" back /><MarketingNav /><div className="loading">Loading…</div></div>);
  if (!data.ad) return (<div className="app"><Header title="Not found" back /><MarketingNav /><div className="empty">No ad with id {ad_id}.</div></div>);

  const a = data.ad;
  const p = a.performance || {};

  return (
    <div className="app">
      <Header title={a.ad_name} crumb={`Ad · ${a.format || a.creative_type || ''}`} back />
      <MarketingNav />

      <dl className="kv">
        {a.campaign_id && (<><dt>Campaign</dt><dd><Link to={`/business/marketing/campaigns/${a.campaign_id}`}>{a.campaign_id}</Link></dd></>)}
        {a.concept_id && (<><dt>Concept</dt><dd><Link to={`/business/marketing/concepts/${a.concept_id}`}>{a.concept_id}</Link></dd></>)}
        {a.creative_type && (<><dt>Creative type</dt><dd>{a.creative_type}</dd></>)}
        {a.call_to_action && (<><dt>CTA</dt><dd>{a.call_to_action}</dd></>)}
        {a.call_to_action_link && (<><dt>Link</dt><dd>{a.call_to_action_link}</dd></>)}
        <dt>Ad ID</dt><dd className="dim" style={{ fontSize: 12 }}>{a.ad_id}</dd>
      </dl>

      {a.title && (
        <div className="detail-block">
          <h2>Headline</h2>
          <div className="ad-body">{a.title}</div>
        </div>
      )}

      {a.body && (
        <div className="detail-block">
          <h2>Primary text</h2>
          <div className="ad-body">{a.body}</div>
        </div>
      )}

      {Object.keys(p).length > 0 && (
        <div className="detail-block">
          <h2>Performance {p.reporting_start && <span className="dim" style={{ fontSize: 11 }}>· {p.reporting_start} → {p.reporting_end}</span>}</h2>
          <div className="stat-grid">
            <Stat label="Spend"   value={p.spend_nzd != null ? nzd(p.spend_nzd) : '—'} />
            <Stat label="Sales"   value={p.results != null ? num(p.results) : '—'} />
            <Stat label="CPR"     value={p.cpr_nzd != null ? nzdPrecise(p.cpr_nzd) : '—'} />
            <Stat label="CTR"     value={p.ctr_link_pct != null ? pct(p.ctr_link_pct) : '—'} />
            <Stat label="Impressions" value={num(p.impressions)} />
            <Stat label="Reach"   value={num(p.reach)} />
            <Stat label="Clicks"  value={num(p.link_clicks)} />
            <Stat label="LPV"     value={num(p.landing_page_views)} />
          </div>
          {a.perf_synced_at && (
            <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>Last synced {new Date(a.perf_synced_at).toLocaleString()}</div>
          )}
        </div>
      )}
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
