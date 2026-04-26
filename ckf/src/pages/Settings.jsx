import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../components/Header.jsx';
import { useAuth } from '../lib/auth.jsx';
import { call, getToken } from '../lib/api.js';
import { fmtRelative } from '../lib/format.js';

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

      <ChangePassword />

      <MarketingPlaybookAdmin />

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

// Lives in CKF Settings (not in the Marketing module) so the marketing chunk
// stays small. Hits the same mktg-data + mktg-seed functions as the marketing
// home banner; this surface is here for re-seeds and the rare diagnostic.
function MarketingPlaybookAdmin() {
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function load() {
    setErr('');
    try {
      const r = await call('mktg-data', { action: 'summary' });
      setSummary(r);
    } catch (e) {
      setErr(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function reseed() {
    if (!confirm('Re-seed the marketing playbook from the bundled JSON? Idempotent — upserts by primary key, safe to re-run.')) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await call('mktg-seed', { action: 'seed', confirm: 'YES' });
      const total = r?.status?.counts ? Object.values(r.status.counts).reduce((a, b) => a + b, 0) : 0;
      setMsg(`Seeded. ${total} rows across the playbook.`);
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const totalRows = summary?.counts ? Object.values(summary.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="section-title" style={{ margin: '0 0 8px' }}>Marketing playbook</div>

      {err && <div className="error">{err}</div>}
      {!summary && !err && <div className="loading" style={{ padding: '8px 0', textAlign: 'left' }}>Loading…</div>}

      {summary && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>
            {totalRows === 0
              ? 'No data loaded yet. Hit "Re-seed" to populate from the bundled JSON.'
              : `${totalRows} rows across ${Object.keys(summary.counts).length} tables.`}
          </div>
          {totalRows > 0 && (
            <details style={{ marginBottom: 8 }}>
              <summary className="dim" style={{ fontSize: 12, cursor: 'pointer' }}>Row counts per table</summary>
              <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 12, color: 'var(--text-dim)' }}>
                {Object.entries(summary.counts).sort().map(([k, v]) => (
                  <li key={k}>{k.replace('mktg_', '')}: <strong style={{ color: 'var(--text)' }}>{v}</strong></li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {msg && <div style={{ color: 'var(--good)', fontSize: 13, marginBottom: 8 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={reseed} className="primary" disabled={busy}>
          {busy ? 'Seeding…' : (totalRows === 0 ? 'Seed playbook' : 'Re-seed playbook')}
        </button>
        <Link to="/business/marketing"><button>Open marketing →</button></Link>
      </div>
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
