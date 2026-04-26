import { useEffect, useState } from 'react';
import Header from '../components/Header.jsx';
import { call, callCached, notifyChanged } from '../lib/api.js';
import { fmtShortDate } from '../lib/format.js';

const CATEGORIES = ['personal','health','business','social','finance','marketing','other'];

export default function Errands() {
  const [items, setItems] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    try {
      const r = await callCached('ckf-errands', { action: 'list' });
      setItems(r.errands || []);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener('ckf-data-changed', handler);
    return () => window.removeEventListener('ckf-data-changed', handler);
  }, []);

  async function complete(id) { await call('ckf-errands', { action: 'complete', id }); notifyChanged(); load(); }
  async function reopen(id) { await call('ckf-errands', { action: 'reopen', id }); notifyChanged(); load(); }
  async function del(id) {
    if (!confirm('Delete this errand?')) return;
    await call('ckf-errands', { action: 'delete', id }); notifyChanged(); load();
  }

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  if (!items) return <div className="app"><div className="loading">Loading…</div></div>;

  const open = items.filter((i) => i.status === 'open');
  const done = items.filter((i) => i.status === 'done');

  return (
    <div className="app">
      <Header title="Errands" right={<button onClick={() => { setEditing(null); setAdding(true); }}>+ Add</button>} />
      {(adding || editing) && (
        <Form
          item={editing}
          onSaved={() => { setAdding(false); setEditing(null); load(); }}
          onCancel={() => { setAdding(false); setEditing(null); }}
        />
      )}

      {open.length === 0 ? (
        <div className="empty">Nothing open. Add one above or ask the chat.</div>
      ) : (
        <div className="card">
          {open.map((it) => (
            <div key={it.id} className="today-task">
              <div className="checkbox" onClick={() => complete(it.id)} role="button" tabIndex={0}>○</div>
              <div className="body" onClick={() => setEditing(it)} style={{ cursor: 'pointer' }}>
                <div className="title">{it.title}</div>
                <div className="meta">
                  {it.category}
                  {it.due_date ? ` · due ${fmtShortDate(it.due_date)}` : ''}
                  {it.remind_at ? ` · ⏰ ${new Date(it.remind_at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}` : ''}
                  {it.sms_remind ? ' · sms' : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: 18 }}>
        <button onClick={() => setShowDone((v) => !v)} style={{ fontSize: 12 }}>
          {showDone ? 'Hide' : `Show`} done ({done.length})
        </button>
      </div>

      {showDone && done.length > 0 && (
        <div className="card" style={{ marginTop: 8, opacity: .7 }}>
          {done.map((it) => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="pill" style={{ marginRight: 8 }}>done</span>
              <span style={{ flex: 1, textDecoration: 'line-through', color: 'var(--text-dim)' }}>{it.title}</span>
              <button onClick={() => reopen(it.id)} style={{ padding: '4px 8px', fontSize: 11 }}>reopen</button>
              <button onClick={() => del(it.id)} className="danger" style={{ padding: '4px 8px', fontSize: 11, marginLeft: 6 }}>del</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Form({ item, onSaved, onCancel }) {
  const [title, setTitle] = useState(item?.title || '');
  const [description, setDescription] = useState(item?.description || '');
  const [category, setCategory] = useState(item?.category || 'personal');
  const [dueDate, setDueDate] = useState(item?.due_date || '');
  const [hasRemind, setHasRemind] = useState(!!item?.remind_at);
  const [remindAt, setRemindAt] = useState(item?.remind_at ? toLocalInput(item.remind_at) : '');
  const [smsRemind, setSmsRemind] = useState(!!item?.sms_remind);
  const [priority, setPriority] = useState(item?.priority ?? 3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isEdit = !!item;

  function toLocalInput(iso) {
    // datetime-local needs YYYY-MM-DDTHH:MM (no TZ).
    const d = new Date(iso);
    const off = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - off).toISOString().slice(0, 16);
  }
  function fromLocalInput(s) {
    if (!s) return null;
    return new Date(s).toISOString();
  }

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const action = isEdit ? 'update' : 'create';
      const payload = {
        action,
        ...(isEdit ? { id: item.id } : {}),
        title, description: description || null,
        category, priority: Number(priority),
        due_date: dueDate || null,
        remind_at: hasRemind ? fromLocalInput(remindAt) : null,
        sms_remind: hasRemind && smsRemind,
      };
      await call('ckf-errands', payload);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function onDelete() {
    if (!confirm('Delete this errand?')) return;
    await call('ckf-errands', { action: 'delete', id: item.id });
    notifyChanged();
    onSaved();
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 14 }}>
      <div className="field">
        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Buy milk" />
      </div>
      <div className="field">
        <label>Description (optional)</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </div>
      <div className="row">
        <div className="field">
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>{[1,2,3,4,5].map((p) => <option key={p} value={p}>{p}</option>)}</select>
        </div>
        <div className="field">
          <label>Due date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
      <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={hasRemind} onChange={(e) => setHasRemind(e.target.checked)} id="errand-rem" />
        <label htmlFor="errand-rem" style={{ margin: 0 }}>Set reminder</label>
      </div>
      {hasRemind && (
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>Remind at (NZ time)</label>
            <input type="datetime-local" value={remindAt} onChange={(e) => setRemindAt(e.target.value)} required={hasRemind} />
          </div>
          <div className="field" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <input type="checkbox" checked={smsRemind} onChange={(e) => setSmsRemind(e.target.checked)} id="errand-sms" />
            <label htmlFor="errand-sms" style={{ margin: 0 }}>SMS too</label>
          </div>
        </div>
      )}
      {err && <div className="error">{err}</div>}
      <div className="row">
        {isEdit && <button type="button" className="danger" onClick={onDelete}>Delete</button>}
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
