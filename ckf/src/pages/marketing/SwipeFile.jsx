import { useEffect, useMemo, useState } from 'react';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import { fmtRelative } from '../../lib/format.js';
import MarketingNav from './MarketingNav.jsx';

export default function SwipeFile() {
  const [uploads, setUploads] = useState(null);
  const [err, setErr] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');

  async function load() {
    try {
      const r = await call('mktg-upload', { action: 'list', limit: 200 });
      setUploads((r.uploads || []).filter((u) => Array.isArray(u.tags) && u.tags.includes('swipe')));
    } catch (e) {
      setErr(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function del(id) {
    if (!confirm('Delete this swipe-file item?')) return;
    await call('mktg-upload', { action: 'delete', id });
    load();
  }

  const allTags = useMemo(() => {
    if (!uploads) return [];
    const set = new Set();
    uploads.forEach((u) => (u.tags || []).forEach((t) => { if (t !== 'swipe') set.add(t); }));
    return [...set].sort();
  }, [uploads]);

  const filtered = useMemo(() => {
    if (!uploads) return null;
    return uploads.filter((u) => {
      if (tagFilter && !(u.tags || []).includes(tagFilter)) return false;
      if (campaignFilter && !(u.target_table === 'mktg_campaigns' && u.target_id === campaignFilter)) return false;
      return true;
    });
  }, [uploads, tagFilter, campaignFilter]);

  return (
    <div className="app">
      <Header title="Swipe file" back />
      <MarketingNav />

      <div className="filterbar">
        <select value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)}>
          <option value="">All campaigns</option>
          <option value="tallow-balm">tallow-balm</option>
          <option value="shampoo-bar">shampoo-bar</option>
          <option value="reviana">reviana</option>
        </select>
        <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">All tags</option>
          {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="spacer" />
        {filtered && <span className="dim" style={{ fontSize: 12, alignSelf: 'center' }}>{filtered.length} items</span>}
      </div>

      {err && <div className="error">{err}</div>}
      {!uploads && !err && <div className="loading">Loading…</div>}
      {filtered && filtered.length === 0 && (
        <div className="empty">
          No swipe-file items yet. Open the marketing chat → camera button to capture inspiration with context.
        </div>
      )}

      <div className="swipe-grid">
        {filtered && filtered.map((u) => <SwipeCard key={u.id} upload={u} onDelete={() => del(u.id)} />)}
      </div>
    </div>
  );
}

function SwipeCard({ upload, onDelete }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (upload.kind !== 'image' || !upload.storage_path) return;
    let alive = true;
    call('mktg-upload', { action: 'signed_url', id: upload.id })
      .then((r) => { if (alive) setSrc(r.url); })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [upload.id, upload.kind, upload.storage_path]);

  return (
    <div className="swipe-card">
      <div className="swipe-card-img">
        {upload.kind !== 'image' ? (
          <div className="dim" style={{ fontSize: 12 }}>{upload.kind}</div>
        ) : err ? (
          <div className="dim" style={{ fontSize: 11 }}>[unavailable]</div>
        ) : !src ? (
          <div className="dim" style={{ fontSize: 11 }}>loading…</div>
        ) : (
          <img src={src} alt="" />
        )}
      </div>
      {upload.caption && <div className="swipe-card-caption">{upload.caption}</div>}
      <div className="swipe-card-meta">
        {(upload.tags || []).filter((t) => t !== 'swipe').map((t) => (
          <span key={t} className="pill outline">{t}</span>
        ))}
        {upload.target_id && <span className="pill outline">→ {upload.target_id}</span>}
      </div>
      <div className="swipe-card-foot">
        <span className="dim" style={{ fontSize: 11 }}>{fmtRelative(upload.created_at)}</span>
        <button onClick={onDelete} className="danger" style={{ fontSize: 11, padding: '4px 10px' }}>Delete</button>
      </div>
    </div>
  );
}
