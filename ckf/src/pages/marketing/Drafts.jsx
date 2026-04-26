import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import { fmtRelative } from '../../lib/format.js';
import { STATUS_LABEL, statusPillClass } from './format.js';
import MarketingNav from './MarketingNav.jsx';

const STATUS_FILTERS = [
  { v: '',                label: 'All' },
  { v: 'needs_approval',  label: 'Needs approval' },
  { v: 'draft',           label: 'Draft' },
  { v: 'submitted',       label: 'Submitted' },
  { v: 'in_production',   label: 'In production' },
  { v: 'approved',        label: 'Approved' },
  { v: 'live',            label: 'Live' },
  { v: 'archived',        label: 'Archived' },
];

export default function Drafts() {
  const nav = useNavigate();
  const [filter, setFilter] = useState('');
  const [drafts, setDrafts] = useState(null);
  const [err, setErr] = useState('');

  async function load() {
    try {
      const args = { action: 'list_drafts' };
      if (filter) args.status = filter;
      const r = await call('mktg-ads', args);
      setDrafts(r.drafts);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [filter]);

  // "+ New draft" used to create a draft + open the form-based wizard.
  // Now it spawns a marketing chat in ad-creation mode — the AI walks the
  // user through it conversationally; the draft is created on first
  // wizard_set tool call and linked to the conversation.
  async function newDraft() {
    const conv = await call('mktg-chat', { action: 'create_conversation', kind: 'context' });
    const cid = conv.conversation.id;
    call('mktg-chat', { action: 'auto_open', conversation_id: cid, mode_hint: 'create_ad' })
      .catch(() => {});
    nav(`/business/marketing/chat/${cid}`);
  }

  async function del(id, e) {
    e.preventDefault(); e.stopPropagation();
    if (!confirm('Delete this draft?')) return;
    await call('mktg-ads', { action: 'delete_draft', id });
    load();
  }

  return (
    <div className="app">
      <Header
        title="Ad drafts"
        right={<button className="primary" onClick={newDraft}>+ New draft</button>}
        back
      />
      <MarketingNav />

      <div className="filterbar">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.v}
            className={filter === s.v ? 'primary' : ''}
            style={{ fontSize: 12, padding: '6px 10px' }}
            onClick={() => setFilter(s.v)}
          >{s.label}</button>
        ))}
      </div>

      {err && <div className="error">{err}</div>}
      {!drafts && !err && <div className="loading">Loading…</div>}
      {drafts && drafts.length === 0 && (
        <div className="empty">No drafts. Hit "+ New draft" to start the wizard.</div>
      )}

      {/* Surface "needs approval" drafts at the top regardless of filter */}
      {!filter && drafts && drafts.some((d) => d.status === 'needs_approval') && (
        <>
          <div className="section-title">
            <span>← Needs your approval</span>
          </div>
          <div className="row-list" style={{ marginBottom: 16 }}>
            {drafts.filter((d) => d.status === 'needs_approval').map((d) => <DraftRow key={d.id} d={d} highlight onDelete={del} />)}
          </div>
        </>
      )}

      <div className="row-list">
        {drafts && drafts
          .filter((d) => filter || d.status !== 'needs_approval') // already shown above when filter is empty
          .map((d) => <DraftRow key={d.id} d={d} onDelete={del} />)}
      </div>
    </div>
  );
}

function DraftRow({ d, highlight, onDelete }) {
  return (
    <Link
      to={`/business/marketing/wizard/${d.id}`}
      className="row-item"
      style={highlight ? { borderColor: 'var(--warn)' } : undefined}
    >
      <div className="name">
        {d.objective ? d.objective.slice(0, 80) : '(no objective yet)'}{' '}
        <span className={statusPillClass(d.status)} style={{ marginLeft: 6 }}>
          {STATUS_LABEL[d.status] || d.status}
        </span>
      </div>
      <div className="meta">
        <span>step <strong>{d.current_step}</strong></span>
        {d.campaign_id && <span>{d.campaign_id}</span>}
        {d.format && <span>{d.format}</span>}
        <span className="dim">{fmtRelative(d.updated_at)}</span>
        <span className="spacer" />
        <button onClick={(e) => onDelete(d.id, e)} className="danger" style={{ fontSize: 11, padding: '4px 10px' }}>Delete</button>
      </div>
    </Link>
  );
}

