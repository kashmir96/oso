import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { call } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

// Polls for any open errands whose remind_at has passed and shown_at is still null.
// On app open + every 60s. If any, shows a modal listing them. Dismiss marks them
// shown so they don't re-fire on the next refresh (separate from the SMS path,
// which uses sms_sent_at).
export default function ReminderModal() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);

  const check = useCallback(async () => {
    if (!user) return;
    try {
      const r = await call('ckf-errands', { action: 'list_due_modals' });
      const list = r.errands || [];
      if (list.length > 0) {
        setItems(list);
        setOpen(true);
      }
    } catch {/* swallow */}
  }, [user]);

  useEffect(() => {
    if (!user) return;
    check();
    const t = setInterval(check, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [user, check]);

  async function dismiss() {
    const ids = items.map((i) => i.id);
    if (ids.length > 0) {
      try { await call('ckf-errands', { action: 'mark_modal_shown', ids }); } catch {}
    }
    setOpen(false); setItems([]);
  }

  async function complete(id) {
    try { await call('ckf-errands', { action: 'complete', id }); } catch {}
    const remaining = items.filter((i) => i.id !== id);
    if (remaining.length === 0) {
      // Mark the dismissed ones too
      const ids = items.map((i) => i.id);
      try { await call('ckf-errands', { action: 'mark_modal_shown', ids }); } catch {}
      setOpen(false); setItems([]);
    } else {
      setItems(remaining);
    }
  }

  function viewAll() {
    dismiss();
    nav('/errands');
  }

  if (!open || items.length === 0) return null;

  return (
    <div className="reminder-modal" role="dialog" aria-modal="true">
      <div className="reminder-panel">
        <div className="reminder-head">
          <div style={{ fontWeight: 600 }}>⏰ Reminder{items.length > 1 ? `s (${items.length})` : ''}</div>
          <button onClick={dismiss} className="reminder-close" aria-label="Dismiss">✕</button>
        </div>
        <div className="reminder-list">
          {items.map((it) => (
            <div key={it.id} className="reminder-item">
              <div className="reminder-title">{it.title}</div>
              {it.description && <div className="reminder-desc">{it.description}</div>}
              <div className="reminder-meta">
                set for {new Date(it.remind_at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
              </div>
              <div className="reminder-actions">
                <button onClick={() => complete(it.id)} className="primary">Done</button>
              </div>
            </div>
          ))}
        </div>
        <div className="reminder-foot">
          <button onClick={viewAll}>Open Errands</button>
          <button onClick={dismiss}>Snooze (dismiss)</button>
        </div>
      </div>
    </div>
  );
}
