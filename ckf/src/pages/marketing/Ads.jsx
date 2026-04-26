import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import { nzd, num } from './format.js';
import MarketingNav from './MarketingNav.jsx';

const SORTS = [
  { value: 'spend',   label: 'Top spend' },
  { value: 'results', label: 'Top sales' },
  { value: 'cpr',     label: 'Best CPR' },
  { value: 'name',    label: 'Name' },
];

export default function Ads() {
  const [params, setParams] = useSearchParams();
  const campaign_id = params.get('campaign_id') || '';
  const sort = params.get('sort') || 'spend';

  const [campaigns, setCampaigns] = useState([]);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    call('mktg-data', { action: 'list_campaigns' })
      .then((r) => setCampaigns(r.campaigns))
      .catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    setRows(null);
    const args = { action: 'list_ads', sort };
    if (campaign_id) args.campaign_id = campaign_id;
    call('mktg-data', args)
      .then((r) => setRows(r.ads))
      .catch((e) => setErr(e.message));
  }, [campaign_id, sort]);

  function update(k, v) {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  }

  return (
    <div className="app">
      <Header title="Ads" back />
      <MarketingNav />

      <div className="filterbar">
        <select value={campaign_id} onChange={(e) => update('campaign_id', e.target.value)}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sort} onChange={(e) => update('sort', e.target.value)}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <div className="spacer" />
        {rows && <span className="dim" style={{ fontSize: 12, alignSelf: 'center' }}>{rows.length} ads</span>}
      </div>

      {err && <div className="error">{err}</div>}
      {!rows && !err && <div className="loading">Loading…</div>}
      {rows && rows.length === 0 && <div className="empty">No ads.</div>}

      <div className="row-list">
        {rows && rows.map((a) => (
          <Link key={a.ad_id} to={`/business/marketing/ads/${encodeURIComponent(a.ad_id)}`} className="row-item">
            <div className="name">{a.ad_name}</div>
            <div className="meta">
              {a.format && <span>{a.format}</span>}
              {a.campaign_id && <span>{a.campaign_id}</span>}
              {a.performance?.spend_nzd != null && <span>spend <strong>{nzd(a.performance.spend_nzd)}</strong></span>}
              {a.performance?.results != null && <span>sales <strong>{num(a.performance.results)}</strong></span>}
              {a.performance?.cpr_nzd != null && <span>CPR <strong>{nzd(a.performance.cpr_nzd)}</strong></span>}
            </div>
            {a.body && <div className="body clip">{a.body}</div>}
          </Link>
        ))}
      </div>
    </div>
  );
}
