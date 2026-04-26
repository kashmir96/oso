import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import { nzd, num, STATUS_LABEL, statusPillClass } from './format.js';
import MarketingNav from './MarketingNav.jsx';

export default function CampaignDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    call('mktg-data', { action: 'get_campaign', id })
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [id]);

  if (err) return (<div className="app"><Header title="Campaign" back /><MarketingNav /><div className="error">{err}</div></div>);
  if (!data) return (<div className="app"><Header title="Campaign" back /><MarketingNav /><div className="loading">Loading…</div></div>);
  if (!data.campaign) return (<div className="app"><Header title="Not found" back /><MarketingNav /><div className="empty">No campaign with id {id}.</div></div>);

  const c = data.campaign;
  return (
    <div className="app">
      <Header title={c.name} crumb="Campaign" back />
      <MarketingNav />

      <div className="card">
        <div className="sub">{c.role_in_funnel}</div>
        {c.description && <div style={{ marginTop: 8 }}>{c.description}</div>}
        <dl className="kv" style={{ marginTop: 12 }}>
          {c.weekly_cadence && (<><dt>Cadence</dt><dd>{c.weekly_cadence}</dd></>)}
          {c.domain_default && (<><dt>Domain</dt><dd>{c.domain_default}</dd></>)}
        </dl>
      </div>

      <Section title={`Products (${data.products.length})`}>
        {data.products.length === 0 && <div className="empty">No products.</div>}
        <div className="row-list">
          {data.products.map((p) => (
            <div key={p.id} className="row-item">
              <div className="name">
                {p.full_name || p.name}{' '}
                <span className={statusPillClass(p.status)} style={{ marginLeft: 6 }}>
                  {STATUS_LABEL[p.status] || p.status}
                </span>
              </div>
              {p.tagline && <div className="meta">{p.tagline}</div>}
              <div className="meta">
                {p.format && <span>{p.format}</span>}
                {p.size && <span>{p.size}</span>}
                {p.price_from_nzd != null && <span><strong>{nzd(p.price_from_nzd)}</strong> from</span>}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Concepts (${data.concepts.length})`} right={<Link to={`/business/marketing/concepts?campaign_id=${id}`} className="dim" style={{ fontSize: 11 }}>filter →</Link>}>
        {data.concepts.length === 0 && <div className="empty">No concepts.</div>}
        <div className="row-list">
          {data.concepts.map((cn) => (
            <Link key={cn.id} to={`/business/marketing/concepts/${cn.id}`} className="row-item">
              <div className="name">
                {cn.name}{' '}
                <span className={statusPillClass(cn.status)} style={{ marginLeft: 6 }}>
                  {STATUS_LABEL[cn.status] || cn.status}
                </span>
              </div>
              <div className="meta">
                {cn.performance?.spend_nzd != null && <span>spend <strong>{nzd(cn.performance.spend_nzd)}</strong></span>}
                {cn.performance?.results != null && <span>sales <strong>{num(cn.performance.results)}</strong></span>}
                {cn.performance?.cpr_nzd != null && <span>CPR <strong>{nzd(cn.performance.cpr_nzd)}</strong></span>}
              </div>
            </Link>
          ))}
        </div>
      </Section>

      <Section title={`Ads (${data.ads.length})`} right={<Link to={`/business/marketing/ads?campaign_id=${id}`} className="dim" style={{ fontSize: 11 }}>open list →</Link>}>
        {data.ads.length === 0 && <div className="empty">No ads.</div>}
        <div className="row-list">
          {data.ads.slice(0, 5).map((a) => (
            <Link key={a.ad_id} to={`/business/marketing/ads/${encodeURIComponent(a.ad_id)}`} className="row-item">
              <div className="name">{a.ad_name}</div>
              <div className="meta">
                {a.format && <span>{a.format}</span>}
                {a.performance?.spend_nzd != null && <span>spend <strong>{nzd(a.performance.spend_nzd)}</strong></span>}
                {a.performance?.results != null && <span>sales <strong>{num(a.performance.results)}</strong></span>}
              </div>
              {a.body && <div className="body clip">{a.body}</div>}
            </Link>
          ))}
        </div>
      </Section>

      <Section title={`Production scripts (${data.scripts.length})`}>
        {data.scripts.length === 0 && <div className="empty">No scripts.</div>}
        <div className="row-list">
          {data.scripts.map((s) => (
            <Link key={s.id} to={`/business/marketing/scripts/${s.id}`} className="row-item">
              <div className="name">
                {s.name}{' '}
                <span className={statusPillClass(s.status)} style={{ marginLeft: 6 }}>
                  {STATUS_LABEL[s.status] || s.status}
                </span>
              </div>
              <div className="meta">
                {s.length_words != null && <span>{num(s.length_words)} words</span>}
              </div>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, right, children }) {
  return (
    <>
      <div className="section-title"><span>{title}</span>{right}</div>
      {children}
    </>
  );
}
