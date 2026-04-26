import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { call } from '../lib/api.js';
import { fmtShortDate } from '../lib/format.js';

// Horizontal pill strip — same shape as the Goals strip. Quick-add via "+"
// pill, tap a pill once to mark done, tap title to view all.
//
// Props:
//   title           — heading (e.g. "Errands" / "Jobs")
//   filter          — 'not_business' | 'business' | undefined
//   defaultCategory — what to assign newly-created items
//   moreHref        — link target for "all"
export default function ErrandsCard({ title, filter, defaultCategory = 'personal', moreHref = '/errands' }) {
  const [items, setItems] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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
    try { await call('ckf-errands', { action: 'complete', id }); refresh(); } catch {}
  }

  return (
    <div className="strip">
      <div className="strip-head">
        <Link to={moreHref} className="strip-title-link">
          <span className="home-title">{title}</span>
          {items && items.length > 0 && <span className="strip-count">{items.length}</span>}
        </Link>
        <Link to={moreHref} className="home-manage">all</Link>
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
          <button type="button" onClick={() => { setAdding(false); setDraft(''); }}>×</button>
        </form>
      )}

      {err && <div className="error">{err}</div>}

      <div className="pill-strip">
        <button
          className="pill-add"
          onClick={() => setAdding((v) => !v)}
          aria-label="Add"
          title={defaultCategory === 'business' ? 'Add a job' : 'Add an errand'}
        >+</button>

        {!items ? (
          <div className="pill-skeleton" />
        ) : items.length === 0 ? (
          <div className="pill-empty">Nothing open. Add one or ask the chat.</div>
        ) : items.map((it) => (
          <button
            key={it.id}
            className="action-pill"
            onClick={() => complete(it.id)}
            title={`Mark "${it.title}" done`}
          >
            <span className="pill-tick">○</span>
            <span className="pill-title">{it.title}</span>
            {(it.due_date || it.remind_at) && (
              <span className="pill-meta">
                {it.due_date && fmtShortDate(it.due_date)}
                {it.remind_at && ' ⏰'}
                {it.sms_remind && ' ✉'}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
