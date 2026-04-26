import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import { num, STATUS_LABEL, statusPillClass } from './format.js';
import MarketingNav from './MarketingNav.jsx';

export default function Scripts() {
  const [params, setParams] = useSearchParams();
  const campaign_id = params.get('campaign_id') || '';

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
    const args = { action: 'list_scripts' };
    if (campaign_id) args.campaign_id = campaign_id;
    call('mktg-data', args)
      .then((r) => setRows(r.scripts))
      .catch((e) => setErr(e.message));
  }, [campaign_id]);

  function update(k, v) {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  }

  return (
    <div className="app">
      <Header title="Production scripts" back />
      <MarketingNav />

      <div className="filterbar">
        <select value={campaign_id} onChange={(e) => update('campaign_id', e.target.value)}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {err && <div className="error">{err}</div>}
      {!rows && !err && <div className="loading">Loading…</div>}
      {rows && rows.length === 0 && <div className="empty">No scripts.</div>}

      <div className="row-list">
        {rows && rows.map((s) => (
          <Link key={s.id} to={`/business/marketing/scripts/${s.id}`} className="row-item">
            <div className="name">
              {s.name}{' '}
              <span className={statusPillClass(s.status)} style={{ marginLeft: 6 }}>
                {STATUS_LABEL[s.status] || s.status}
              </span>
            </div>
            <div className="meta">
              {s.campaign_id && <span>{s.campaign_id}</span>}
              {s.length_words != null && <span>{num(s.length_words)} words</span>}
              {s.video_opener_ids?.length > 0 && <span>{s.video_opener_ids.join(' / ')}</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
