import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import { num, STATUS_LABEL, statusPillClass } from './format.js';
import MarketingNav from './MarketingNav.jsx';

export default function ScriptDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    call('mktg-data', { action: 'get_script', id })
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [id]);

  if (err) return (<div className="app"><Header title="Script" back /><MarketingNav /><div className="error">{err}</div></div>);
  if (!data) return (<div className="app"><Header title="Script" back /><MarketingNav /><div className="loading">Loading…</div></div>);
  if (!data.script) return (<div className="app"><Header title="Not found" back /><MarketingNav /><div className="empty">No script with id {id}.</div></div>);

  const s = data.script;
  return (
    <div className="app">
      <Header title={s.name} crumb={`Script · ${s.campaign_id || ''}`} back />
      <MarketingNav />

      <dl className="kv">
        <dt>Status</dt><dd><span className={statusPillClass(s.status)}>{STATUS_LABEL[s.status] || s.status}</span></dd>
        {s.length_words != null && (<><dt>Length</dt><dd>{num(s.length_words)} words</dd></>)}
        {s.video_opener_ids?.length > 0 && (<><dt>Openers</dt><dd>{s.video_opener_ids.join(', ')}</dd></>)}
        {s.concept_ids?.length > 0 && (
          <>
            <dt>Concepts</dt>
            <dd>
              {s.concept_ids.map((cid, i) => (
                <span key={cid}>{i > 0 && ', '}<Link to={`/business/marketing/concepts/${cid}`}>{cid}</Link></span>
              ))}
            </dd>
          </>
        )}
      </dl>

      <div className="detail-block">
        <h2>Script</h2>
        <div className="script-body">{s.body || '—'}</div>
      </div>

      {s.notes && (
        <div className="detail-block">
          <h2>Notes</h2>
          <div className="card">{s.notes}</div>
        </div>
      )}
    </div>
  );
}
