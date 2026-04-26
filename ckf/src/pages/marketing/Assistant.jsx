import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import { fmtRelative } from '../../lib/format.js';
import { STATUS_LABEL, statusPillClass } from './format.js';
import MarketingNav from './MarketingNav.jsx';

const QUEUES = [
  { v: 'submitted',     label: 'New (claim)' },
  { v: 'in_production', label: 'In progress' },
  { v: 'needs_approval', label: 'Awaiting approval' },
];

export default function Assistant() {
  const [queue, setQueue] = useState('submitted');
  const [drafts, setDrafts] = useState(null);
  const [err, setErr] = useState('');

  async function load() {
    setErr('');
    try {
      const r = await call('mktg-ads', { action: 'list_drafts', status: queue });
      setDrafts(r.drafts);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [queue]);

  return (
    <div className="app">
      <Header title="Assistant queue" crumb="Marketing · production" back />
      <MarketingNav />

      <div className="filterbar">
        {QUEUES.map((q) => (
          <button
            key={q.v}
            className={queue === q.v ? 'primary' : ''}
            style={{ fontSize: 12, padding: '6px 10px' }}
            onClick={() => setQueue(q.v)}
          >{q.label}</button>
        ))}
      </div>

      {err && <div className="error">{err}</div>}
      {!drafts && !err && <div className="loading">Loading…</div>}
      {drafts && drafts.length === 0 && (
        <div className="empty">
          {queue === 'submitted' && 'No new drafts to claim.'}
          {queue === 'in_production' && 'No drafts currently in production.'}
          {queue === 'needs_approval' && 'No drafts waiting for approval.'}
        </div>
      )}

      <div className="row-list">
        {drafts && drafts.map((d) => <AssistantRow key={d.id} draft={d} onChange={load} />)}
      </div>
    </div>
  );
}

function AssistantRow({ draft, onChange }) {
  const [open, setOpen] = useState(false);
  const [productionNotes, setProductionNotes] = useState(draft.production_notes || '');
  const [assetUrl, setAssetUrl] = useState(draft.production_asset_url || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function claim() {
    setBusy(true); setErr('');
    try { await call('mktg-ads', { action: 'claim_draft', id: draft.id }); onChange(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function markDone() {
    setBusy(true); setErr('');
    try {
      await call('mktg-ads', {
        action: 'mark_needs_approval',
        id: draft.id,
        production_notes: productionNotes || null,
        production_asset_url: assetUrl || null,
      });
      onChange();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="row-item" style={{ padding: 12 }}>
      <div className="name" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {draft.objective ? draft.objective.slice(0, 80) : '(no objective)'}
        </span>
        <span className={statusPillClass(draft.status)}>{STATUS_LABEL[draft.status] || draft.status}</span>
      </div>
      <div className="meta">
        {draft.campaign_id && <span>{draft.campaign_id}</span>}
        {draft.format && <span>{draft.format}</span>}
        {draft.audience_type && <span>aud: {draft.audience_type}</span>}
        {draft.submitted_at && <span className="dim">submitted {fmtRelative(draft.submitted_at)}</span>}
      </div>

      {!open && (
        <div className="row" style={{ marginTop: 8 }}>
          <Link to={`/business/marketing/wizard/${draft.id}`}><button>Open draft</button></Link>
          {draft.status === 'submitted' && (
            <button className="primary" onClick={claim} disabled={busy}>{busy ? '…' : 'Claim'}</button>
          )}
          {draft.status === 'in_production' && (
            <button className="primary" onClick={() => setOpen(true)}>Mark done →</button>
          )}
          {draft.status === 'needs_approval' && (
            <span className="pill warn" style={{ alignSelf: 'center' }}>Waiting for Curtis to approve</span>
          )}
        </div>
      )}

      {open && (
        <div style={{ marginTop: 10 }}>
          <div className="field">
            <label>Asset URL (Drive / S3 / direct link to the produced creative)</label>
            <input value={assetUrl} onChange={(e) => setAssetUrl(e.target.value)} placeholder="https://drive.google.com/…" />
          </div>
          <div className="field">
            <label>Production notes</label>
            <textarea
              value={productionNotes}
              onChange={(e) => setProductionNotes(e.target.value)}
              rows={3}
              placeholder="Anything Curtis should know about the produced asset — quirks, swaps you made, decisions to confirm."
            />
          </div>
          {err && <div className="error">{err}</div>}
          <div className="row">
            <button onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button className="primary" onClick={markDone} disabled={busy}>
              {busy ? 'Submitting…' : 'Submit for approval'}
            </button>
          </div>
        </div>
      )}

      {draft.approval_notes && draft.status === 'in_production' && (
        <div className="card" style={{ marginTop: 8, borderColor: 'var(--warn)' }}>
          <div className="title" style={{ fontSize: 13 }}>Curtis requested changes</div>
          <div style={{ marginTop: 6, fontSize: 13, whiteSpace: 'pre-wrap' }}>{draft.approval_notes}</div>
        </div>
      )}
    </div>
  );
}
