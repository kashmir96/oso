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
  const [liveDrafts, setLiveDrafts] = useState(null);
  const [err, setErr] = useState('');

  async function load() {
    setErr('');
    try {
      const [r, live] = await Promise.all([
        call('mktg-ads', { action: 'list_drafts', status: queue }),
        // The reference rail at the bottom — recent shipped ads, capped to 8.
        call('mktg-ads', { action: 'list_drafts', status: 'live' }),
      ]);
      setDrafts(r.drafts);
      setLiveDrafts((live.drafts || []).slice(0, 8));
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

      {liveDrafts && liveDrafts.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 20 }}>Recent live ads (reference)</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
            Shipped briefs — past work the system also pulls in as voice
            reference for new generations. Voiceovers re-downloadable here.
          </div>
          <div className="row-list">
            {liveDrafts.map((d) => <LiveRow key={d.id} draft={d} onChange={load} />)}
          </div>
        </>
      )}
    </div>
  );
}

// Compact row for the reference rail. Single line + voiceover access.
function LiveRow({ draft, onChange }) {
  return (
    <div className="row-item" style={{ padding: 10 }}>
      <div className="name" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <Link to={`/business/marketing/wizard/${draft.id}`} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: 'none', color: 'var(--text)' }}>
          {draft.objective ? draft.objective.slice(0, 80) : '(no objective)'}
        </Link>
        <span className={statusPillClass(draft.status)}>{STATUS_LABEL[draft.status] || draft.status}</span>
      </div>
      <div className="meta">
        {draft.campaign_id && <span>{draft.campaign_id}</span>}
        {draft.format && <span>{draft.format}</span>}
        {draft.audience_type && <span>aud: {draft.audience_type}</span>}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <VoiceoverButton draft={draft} onChange={onChange} compact />
      </div>
    </div>
  );
}

// Generate / Re-generate / Download voiceover. Shows "Generate" if no MP3
// yet, "Download MP3" + "↻" (regenerate) if one exists. Hidden for non-video
// formats since there's no vo_script to read.
function VoiceoverButton({ draft, onChange, compact }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const supports = draft.format === 'video' || draft.format === 'reel';
  if (!supports) return null;

  async function generate() {
    setBusy(true); setErr('');
    try {
      await call('mktg-vo', { action: 'generate', draft_id: draft.id });
      onChange?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (draft.voiceover_url) {
    return (
      <>
        <a
          href={draft.voiceover_url}
          target="_blank"
          rel="noreferrer"
          style={{
            padding: compact ? '4px 10px' : '6px 12px',
            fontSize: 12,
            textDecoration: 'none',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
          title={`Voice: ${draft.voiceover_voice_id || 'default'} · ${draft.voiceover_generated_at ? fmtRelative(draft.voiceover_generated_at) : ''}`}
        >
          ▶ Download VO
        </a>
        <button
          onClick={generate}
          disabled={busy}
          style={{ padding: compact ? '4px 8px' : '6px 10px', fontSize: 11 }}
          title="Regenerate the voiceover"
        >
          {busy ? '…' : '↻'}
        </button>
        {err && <span className="error" style={{ fontSize: 11 }}>{err}</span>}
      </>
    );
  }

  return (
    <>
      <button
        onClick={generate}
        disabled={busy}
        className="primary"
        style={{ padding: compact ? '4px 10px' : '6px 12px', fontSize: 12 }}
      >
        {busy ? 'Generating…' : 'Generate voiceover'}
      </button>
      {err && <span className="error" style={{ fontSize: 11 }}>{err}</span>}
    </>
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
        <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
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
          <VoiceoverButton draft={draft} onChange={onChange} />
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
