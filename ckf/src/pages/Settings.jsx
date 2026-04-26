import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../components/Header.jsx';
import { useAuth } from '../lib/auth.jsx';
import { call, getToken } from '../lib/api.js';
import { fmtRelative } from '../lib/format.js';
import { getTheme, setTheme } from '../lib/theme.js';

const CATEGORIES = ['personal','health','business','social','finance','marketing','other'];

export default function Settings() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [pending, setPending] = useState(null);
  const [err, setErr] = useState('');

  async function load() {
    const r = await call('ckf-suggestions', { action: 'list', status: 'pending' });
    setPending(r.suggestions);
  }
  useEffect(() => { load().catch((e) => setErr(e.message)); }, []);

  async function approve(s, opts) {
    await call('ckf-suggestions', { action: 'approve', id: s.id, ...opts });
    load();
  }
  async function reject(id) {
    await call('ckf-suggestions', { action: 'reject', id });
    load();
  }

  return (
    <div className="app">
      <Header title="Settings" />

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Signed in</div>
        <div style={{ fontWeight: 600 }}>{user?.email}</div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <Link to="/ninety-day-goals"><button>90-day goals</button></Link>
          <Link to="/business"><button>Business</button></Link>
          <button onClick={() => { logout(); nav('/login'); }} className="danger">Sign out</button>
        </div>
      </div>

      <Appearance />

      <TrainerShare />

      <Connections />

      <ChangePassword />

      <div className="section-title">Pending suggestions</div>
      {!pending ? <div className="loading">Loading…</div> :
        pending.length === 0 ? <div className="empty">Nothing pending.</div> :
        pending.map((s) => (
          <SuggestionCard key={s.id} s={s} onApprove={approve} onReject={reject} />
        ))
      }
      {err && <div className="error">{err}</div>}
    </div>
  );
}

function SuggestionCard({ s, onApprove, onReject }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('personal');
  const [recurrence, setRecurrence] = useState('daily');
  const [busy, setBusy] = useState(false);

  return (
    <div className="suggestion">
      <div>{s.suggestion}</div>
      {s.reason && <div className="why">{s.reason}</div>}
      <div className="why" style={{ fontSize: 11 }}>From {s.source_type} · {fmtRelative(s.created_at)}</div>
      {!open ? (
        <div className="actions">
          <button onClick={() => setOpen(true)} className="primary">Approve</button>
          <button onClick={() => onReject(s.id)} className="danger">Reject</button>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <div className="row">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Recurrence</label>
              <input value={recurrence} onChange={(e) => setRecurrence(e.target.value)} placeholder="daily / weekly / mon,wed" />
            </div>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => { setBusy(true); await onApprove(s, { category, recurrence_rule: recurrence }); setBusy(false); }}
            >
              {busy ? 'Adding…' : 'Add to routine'}
            </button>
            <button onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TrainerShare() {
  const [shares, setShares] = useState(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('Trainer');
  const [err, setErr] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const APP_URL = (typeof window !== 'undefined' ? window.location.origin : '');

  async function load() {
    try {
      const r = await call('ckf-meals', { action: 'list_shares' });
      setShares(r.shares || []);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setBusy(true); setErr('');
    try {
      await call('ckf-meals', { action: 'create_share', label: label || 'Trainer' });
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function revoke(id) {
    if (!confirm('Revoke this share link? Anyone using it will lose access.')) return;
    await call('ckf-meals', { action: 'revoke_share', id });
    load();
  }
  function copyUrl(token, id) {
    const url = `${APP_URL}/ckf-meals.html#${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId((v) => v === id ? null : v), 1500);
    });
  }

  const active = (shares || []).filter((s) => !s.revoked);
  const revoked = (shares || []).filter((s) => s.revoked);

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="section-title" style={{ margin: '0 0 8px' }}>Meals · trainer share link</div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
        Generate a read+edit link for your trainer. They see meals you've logged
        (from the chat or the Meals page) with AI calorie/macro estimates. They
        can correct any field. They cannot upload, delete, or see anything else
        in the app. <Link to="/meals" style={{ marginLeft: 6 }}>Open Meals →</Link>
      </div>

      {!shares ? <div className="loading">Loading…</div> :
        active.length === 0 ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label>Label</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Trainer's name" />
            </div>
            <button className="primary" onClick={create} disabled={busy}>{busy ? '…' : 'Generate link'}</button>
          </div>
        ) : (
          <>
            {active.map((s) => {
              const url = `${APP_URL}/ckf-meals.html#${s.share_token}`;
              return (
                <div key={s.id} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{s.label || 'Share'}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={url} readOnly onClick={(e) => e.target.select()} style={{ flex: 1, fontSize: 12 }} />
                    <button onClick={() => copyUrl(s.share_token, s.id)} className="primary" style={{ padding: '6px 12px', fontSize: 12 }}>
                      {copiedId === s.id ? 'Copied' : 'Copy'}
                    </button>
                    <button onClick={() => revoke(s.id)} className="danger" style={{ padding: '6px 10px', fontSize: 12 }}>Revoke</button>
                  </div>
                </div>
              );
            })}
            <button onClick={create} disabled={busy} style={{ marginTop: 6, fontSize: 12 }}>+ another link</button>
          </>
        )}
      {revoked.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          {revoked.length} revoked link{revoked.length === 1 ? '' : 's'}.
        </div>
      )}
      {err && <div className="error">{err}</div>}
    </div>
  );
}

function Appearance() {
  const [theme, setT] = useState(() => getTheme());
  function pick(t) { setT(t); setTheme(t); }
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="section-title" style={{ margin: '0 0 8px' }}>Appearance</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className={theme === 'dark' ? 'primary' : ''}
          onClick={() => pick('dark')}
          style={{ flex: 1 }}
        >🌙 Dark</button>
        <button
          className={theme === 'light' ? 'primary' : ''}
          onClick={() => pick('light')}
          style={{ flex: 1 }}
        >☀ Light</button>
      </div>
    </div>
  );
}

// ── Connections ──
// Shows status for each integration. The "Connect" buttons hit the function
// which returns the OAuth authorize URL; we redirect the browser there.
// Backend functions for these aren't built yet — buttons surface a friendly
// message until they are. The UI shape is locked in so wiring later is just
// a function call swap.
function Connections() {
  const [status, setStatus] = useState({ whoop: null, google_calendar: null });
  const [busy, setBusy] = useState(null);
  const [info, setInfo] = useState('');

  useEffect(() => {
    call('ckf-integrations', { action: 'status' })
      .then((r) => setStatus(r.status || { whoop: null, google_calendar: null }))
      .catch(() => {/* function may not exist yet — leave nulls */});
  }, []);

  async function connect(provider) {
    setBusy(provider); setInfo('');
    try {
      const r = await call('ckf-integrations', { action: 'connect', provider });
      if (r.authorize_url) { window.location.href = r.authorize_url; return; }
      setInfo(r.message || 'Not yet wired — coming soon.');
    } catch (e) {
      setInfo(`${provider}: not yet wired (${e.message})`);
    } finally {
      setBusy(null);
    }
  }
  async function disconnect(provider) {
    if (!confirm(`Disconnect ${provider}? Tokens will be revoked locally.`)) return;
    setBusy(provider);
    try {
      await call('ckf-integrations', { action: 'disconnect', provider });
      const r = await call('ckf-integrations', { action: 'status' });
      setStatus(r.status || {});
    } catch (e) {
      setInfo(`${provider}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  const items = [
    { id: 'whoop', label: 'Whoop', desc: 'Pull recovery, sleep, strain, HRV daily.' },
    { id: 'google_calendar', label: 'Google Calendar', desc: 'Read events into the Routine view (one-way).' },
  ];

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="section-title" style={{ margin: '0 0 8px' }}>Connections</div>
      {items.map((it) => {
        const s = status?.[it.id];
        const connected = s?.connected;
        return (
          <div key={it.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{it.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{it.desc}</div>
              <div style={{ fontSize: 11, color: connected ? 'var(--good)' : 'var(--text-muted)', marginTop: 2 }}>
                {connected ? `Connected${s.connected_at ? ` · since ${new Date(s.connected_at).toLocaleDateString()}` : ''}` : 'Not connected'}
              </div>
            </div>
            {connected
              ? <button onClick={() => disconnect(it.id)} disabled={busy === it.id} className="danger" style={{ padding: '6px 12px', fontSize: 12 }}>{busy === it.id ? '…' : 'Disconnect'}</button>
              : <button onClick={() => connect(it.id)} disabled={busy === it.id} className="primary" style={{ padding: '6px 12px', fontSize: 12 }}>{busy === it.id ? '…' : 'Connect'}</button>}
          </div>
        );
      })}
      {info && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>{info}</div>}
    </div>
  );
}

function ChangePassword() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setMsg(''); setErr(''); setBusy(true);
    try {
      await call('ckf-auth', {
        action: 'change-password',
        token: getToken(),
        current_password: cur,
        new_password: next,
      });
      setMsg('Updated.');
      setCur(''); setNext('');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="card" style={{ marginBottom: 12 }}>
      <div className="section-title" style={{ margin: '0 0 8px' }}>Change password</div>
      <div className="field">
        <label>Current</label>
        <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required />
      </div>
      <div className="field">
        <label>New (8+ chars)</label>
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
      </div>
      {err && <div className="error">{err}</div>}
      {msg && <div style={{ color: 'var(--good)', fontSize: 13 }}>{msg}</div>}
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
    </form>
  );
}
