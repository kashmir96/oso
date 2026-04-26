import { useEffect, useRef, useState } from 'react';
import Header from '../components/Header.jsx';
import { call } from '../lib/api.js';
import { processFile, revokePreview } from '../lib/upload.js';
import { fmtRelative } from '../lib/format.js';

const CATEGORIES = ['personal','health','business','social','finance','marketing','other'];

export default function Swipefile() {
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(null); // null | 'note' | 'link' | 'image' | 'pdf'
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState('');

  async function load() {
    try {
      const r = await call('ckf-swipefile', { action: 'list', archived: false });
      setItems(r.items || []);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function archive(id) {
    if (!confirm('Archive this item?')) return;
    await call('ckf-swipefile', { action: 'archive', id });
    load();
  }
  async function del(id) {
    if (!confirm('Delete permanently?')) return;
    await call('ckf-swipefile', { action: 'delete', id });
    load();
  }

  if (err) return <div className="app"><div className="error">{err}</div></div>;

  const visible = (items || []).filter((it) => {
    if (filter !== 'all' && it.category !== filter) return false;
    if (search && !`${it.title || ''} ${it.source_text || ''} ${it.why_it_matters || ''} ${(it.tags || []).join(' ')}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="app">
      <Header
        title="Swipefile"
        right={
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setAdding('note')}>+ Note</button>
            <button onClick={() => setAdding('link')}>+ Link</button>
          </div>
        }
      />

      <div className="card" style={{ marginBottom: 10 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search swipefile…" />
        <div className="row" style={{ marginTop: 6, gap: 4, flexWrap: 'wrap' }}>
          {['all', ...CATEGORIES].map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={filter === c ? 'primary' : ''}
              style={{ padding: '4px 10px', fontSize: 11 }}
            >{c}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => setAdding('image')} style={{ flex: 1 }}>+ Image</button>
          <button onClick={() => setAdding('pdf')} style={{ flex: 1 }}>+ PDF</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          The chat searches your swipefile first when answering questions.
        </div>
      </div>

      {adding && (
        <AddForm kind={adding} onSaved={() => { setAdding(null); load(); }} onCancel={() => setAdding(null)} />
      )}
      {editing && (
        <EditForm
          item={editing}
          onSaved={() => { setEditing(null); load(); }}
          onCancel={() => setEditing(null)}
          onArchive={() => { archive(editing.id); setEditing(null); }}
          onDelete={() => { del(editing.id); setEditing(null); }}
        />
      )}

      {!items ? (
        <div className="loading">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="empty">Nothing here yet. Add a note, link, image, or PDF.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visible.map((it) => (
            <div key={it.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setEditing(it)}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span className="pill">{it.kind}</span>
                <span className="pill">{it.category}</span>
                <span className="pill" title="Importance">·{'★'.repeat(it.importance || 1)}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{fmtRelative(it.created_at)}</span>
              </div>
              <div style={{ fontWeight: 600, marginTop: 6 }}>
                {it.title || (it.source_url ? new URL(it.source_url).hostname : '(untitled)')}
              </div>
              {it.author && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{it.author}</div>}
              {it.why_it_matters && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>{it.why_it_matters}</div>}
              {it.source_text && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4, whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'hidden' }}>{it.source_text.slice(0, 300)}{it.source_text.length > 300 ? '…' : ''}</div>}
              {it.tags && it.tags.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {it.tags.map((t) => <span key={t} className="pill" style={{ marginRight: 4 }}>{t}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddForm({ kind, onSaved, onCancel }) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [why, setWhy] = useState('');
  const [author, setAuthor] = useState('');
  const [tags, setTags] = useState('');
  const [importance, setImportance] = useState(3);
  const [category, setCategory] = useState('personal');
  const [att, setAtt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  async function pickFile(files) {
    if (!files?.[0]) return;
    setErr('');
    try {
      if (att) revokePreview(att);
      const a = await processFile(files[0]);
      setAtt(a);
    } catch (e) { setErr(e.message); }
  }

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
      const base = {
        title: title || null, why_it_matters: why || null,
        author: author || null, tags: tagList,
        importance: Number(importance), category,
      };
      let action; let payload;
      if (kind === 'note') {
        action = 'create_note'; payload = { ...base, source_text: text };
      } else if (kind === 'link') {
        if (!url.trim()) throw new Error('URL required');
        action = 'create_link'; payload = { ...base, url };
      } else if (kind === 'image') {
        if (!att) throw new Error('Pick an image');
        action = 'create_image'; payload = { ...base, image_base64: att.data_base64, mime_type: att.media_type };
      } else if (kind === 'pdf') {
        if (!att) throw new Error('Pick a PDF');
        if (att.kind !== 'document') throw new Error('Pick a PDF, not an image');
        action = 'create_pdf'; payload = { ...base, pdf_base64: att.data_base64 };
      }
      await call('ckf-swipefile', { action, ...payload });
      if (att) revokePreview(att);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 10 }}>
      <div className="section-title" style={{ margin: '0 0 8px' }}>+ {kind}</div>
      <div className="field">
        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'note' ? 'Short label' : ''} />
      </div>
      {kind === 'note' && (
        <div className="field">
          <label>Body</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} required />
        </div>
      )}
      {kind === 'link' && (
        <div className="field">
          <label>URL</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." required />
        </div>
      )}
      {(kind === 'image' || kind === 'pdf') && (
        <div className="field">
          <label>{kind === 'image' ? 'Image' : 'PDF'}</label>
          <input
            ref={fileRef}
            type="file"
            accept={kind === 'image' ? 'image/*' : 'application/pdf'}
            onChange={(e) => { pickFile(e.target.files); e.target.value = ''; }}
          />
          {att?.preview_url && <img src={att.preview_url} alt="" style={{ maxWidth: '100%', maxHeight: 240, marginTop: 8, borderRadius: 8 }} />}
          {att && att.kind === 'document' && <div style={{ marginTop: 6, fontSize: 12 }}>{att.filename}</div>}
        </div>
      )}
      <div className="field">
        <label>Why it matters</label>
        <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} placeholder="A line or two on why you trust this source." />
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Author / source</label>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Importance</label>
          <select value={importance} onChange={(e) => setImportance(e.target.value)}>
            {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Tags (comma separated)</label>
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="strategy, sleep, naval" />
      </div>
      {err && <div className="error">{err}</div>}
      <div className="row">
        <button type="button" onClick={() => { if (att) revokePreview(att); onCancel(); }}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

function EditForm({ item, onSaved, onCancel, onArchive, onDelete }) {
  const [title, setTitle] = useState(item.title || '');
  const [why, setWhy] = useState(item.why_it_matters || '');
  const [author, setAuthor] = useState(item.author || '');
  const [tags, setTags] = useState((item.tags || []).join(', '));
  const [importance, setImportance] = useState(item.importance || 3);
  const [category, setCategory] = useState(item.category || 'personal');
  const [text, setText] = useState(item.source_text || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await call('ckf-swipefile', {
        action: 'update', id: item.id,
        title: title || null,
        why_it_matters: why || null,
        author: author || null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        importance: Number(importance),
        category,
        source_text: text || null,
      });
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={save} style={{ marginBottom: 10 }}>
      {item.storage_url && item.kind === 'image' && (
        <img src={item.storage_url} alt="" style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 8, marginBottom: 8 }} />
      )}
      {item.source_url && (
        <div style={{ fontSize: 12, marginBottom: 8 }}>
          <a href={item.source_url} target="_blank" rel="noopener noreferrer">{item.source_url}</a>
        </div>
      )}
      <div className="field"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="field"><label>Why it matters</label><textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} /></div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}><label>Author</label><input value={author} onChange={(e) => setAuthor(e.target.value)} /></div>
        <div className="field" style={{ flex: 1 }}>
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Importance</label>
          <select value={importance} onChange={(e) => setImportance(e.target.value)}>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </div>
      </div>
      <div className="field"><label>Tags</label><input value={tags} onChange={(e) => setTags(e.target.value)} /></div>
      <div className="field">
        <label>Body / extracted text</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} />
      </div>
      {err && <div className="error">{err}</div>}
      <div className="row">
        <button type="button" className="danger" onClick={onDelete}>Delete</button>
        <button type="button" onClick={onArchive}>Archive</button>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
