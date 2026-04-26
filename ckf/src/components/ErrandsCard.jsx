import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../lib/api.js';
import { fmtShortDate } from '../lib/format.js';

// Reusable: shows top open items + quick add. Used on Home (Errands,
// non-business filter) and on Business (Jobs, business filter).
//
// Props:
//   title       — heading (e.g. "Errands" / "Jobs")
//   filter      — 'not_business' | 'business' | undefined
//   defaultCategory — what to assign newly-created items via this card
//   moreHref    — link target for "all"
//   limit       — how many to render before "see all"
export default function ErrandsCard({ title, filter, defaultCategory = 'personal', moreHref = '/errands', limit = 4 }) {
  const [items, setItems] = useState(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');

  function refresh() {
    const payload = { action: 'list', status: 'open' };
    if (filter) payload.category = filter;
    call('ckf-errands', payload)
      .then((r) => setItems(r.errands || []))
      .catch((e) => setErr(e.message));
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [filter]);

  async function quickAdd(e) {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await call('ckf-errands', { action: 'create', title: draft.trim(), category: defaultCategory });
      setDraft(''); setAdding(false); refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function complete(id) {
    setBusy(true);
    try {
      await call('ckf-errands', { action: 'complete', id });
      refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="errands-card">
      <div className="errands-head">
        <div className="home-title">{title}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <button className="errands-quick-add" onClick={() => setAdding((v) => !v)}>{adding ? 'cancel' : '+ add'}</button>
          <Link to={moreHref} className="home-manage">all</Link>
        </div>
      </div>

      {adding && (
        <form className="errands-quick-form" onSubmit={quickAdd}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={defaultCategory === 'business' ? 'Add a job…' : 'Add an errand…'}
          />
          <button className="primary" type="submit" disabled={busy || !draft.trim()}>Add</button>
        </form>
      )}

      {err && <div className="error">{err}</div>}
      {!items ? (
        <div className="loading" style={{ padding: '6px 0' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div className="empty" style={{ padding: '6px 0', textAlign: 'left', fontSize: 12 }}>
          Nothing open. Add one above or ask the chat.
        </div>
      ) : (
        <ul className="errands-list">
          {items.slice(0, limit).map((it) => (
            <li key={it.id} className="errands-item">
              <button className="errands-tick" onClick={() => complete(it.id)} aria-label="Mark done">○</button>
              <span className="errands-title">{it.title}</span>
              {it.due_date && <span className="errands-due">{fmtShortDate(it.due_date)}</span>}
              {it.remind_at && <span className="errands-remind" title={new Date(it.remind_at).toLocaleString()}>⏰</span>}
              {it.sms_remind && <span className="errands-sms" title="SMS at remind">✉</span>}
            </li>
          ))}
          {items.length > limit && (
            <li className="errands-more">
              <Link to={moreHref}>+ {items.length - limit} more</Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
