import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import { nzd, num, STATUS_LABEL, statusPillClass } from './format.js';
import MarketingNav from './MarketingNav.jsx';

const STATUSES = ['workhorse','top_revenue','efficient','tested','new','gap','retired'];

export default function Concepts() {
  const [params, setParams] = useSearchParams();
  const campaign_id = params.get('campaign_id') || '';
  const status = params.get('status') || '';

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
    const args = { action: 'list_concepts' };
    if (campaign_id) args.campaign_id = campaign_id;
    if (status) args.status = status;
    call('mktg-data', args)
      .then((r) => setRows(r.concepts))
      .catch((e) => setErr(e.message));
  }, [campaign_id, status]);

  function update(k, v) {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  }

  const grouped = useMemo(() => {
    const m = {};
    (rows || []).forEach((r) => { (m[r.status] = m[r.status] || []).push(r); });
    return STATUSES.map((s) => ({ status: s, items: m[s] || [] })).filter((g) => g.items.length > 0);
  }, [rows]);

  return (
    <div className="app">
      <Header title="Concepts" back />
      <MarketingNav />

      <div className="filterbar">
        <select value={campaign_id} onChange={(e) => update('campaign_id', e.target.value)}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={status} onChange={(e) => update('status', e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>

      {err && <div className="error">{err}</div>}
      {!rows && !err && <div className="loading">Loading…</div>}
      {rows && rows.length === 0 && <div className="empty">No concepts match.</div>}

      {grouped.map((g) => (
        <div key={g.status}>
          <div className="section-title"><span>{STATUS_LABEL[g.status]} · {g.items.length}</span></div>
          <div className="row-list">
            {g.items.map((c) => (
              <Link key={c.id} to={`/business/marketing/concepts/${c.id}`} className="row-item">
                <div className="name">
                  {c.name}{' '}
                  <span className={statusPillClass(c.status)} style={{ marginLeft: 6 }}>{STATUS_LABEL[c.status]}</span>
                </div>
                <div className="meta">
                  {c.campaign_id && <span>{c.campaign_id}</span>}
                  {c.performance?.spend_nzd != null && <span>spend <strong>{nzd(c.performance.spend_nzd)}</strong></span>}
                  {c.performance?.results != null && <span>sales <strong>{num(c.performance.results)}</strong></span>}
                  {c.performance?.cpr_nzd != null && <span>CPR <strong>{nzd(c.performance.cpr_nzd)}</strong></span>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
