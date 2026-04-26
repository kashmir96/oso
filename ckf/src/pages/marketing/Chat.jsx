import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { call } from '../../lib/api.js';
import { fmtRelative } from '../../lib/format.js';

const ACCEPTED_IMAGE_MIME = ['image/png','image/jpeg','image/webp','image/gif'];

export default function Chat() {
  const { id } = useParams();
  const nav = useNavigate();
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [attachOpen, setAttachOpen] = useState(false);
  // Pending images, uploaded but not yet sent. Each: { upload_id, storage_path, mime_type, signed_url, name }
  const [pendingImages, setPendingImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  // For the camera → swipe-file flow: holds the captured file until the user
  // fills in the context prompt, then uploads tagged 'swipe'.
  const [swipeCapture, setSwipeCapture] = useState(null);
  const scrollRef = useRef(null);
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);

  // ── Routing: no id → create a fresh conversation and redirect ──
  useEffect(() => {
    if (id) return;
    let alive = true;
    (async () => {
      try {
        const r = await call('mktg-chat', { action: 'create_conversation', kind: 'context' });
        if (!alive) return;
        nav(`/business/marketing/chat/${r.conversation.id}`, { replace: true });
      } catch (e) {
        if (alive) setErr(e.message);
      }
    })();
    return () => { alive = false; };
  }, [id, nav]);

  const loadConversation = useCallback(async () => {
    if (!id) return;
    const r = await call('mktg-chat', { action: 'get_conversation', id });
    setConversation(r.conversation);
    setMessages(r.messages);
  }, [id]);

  useEffect(() => { loadConversation().catch((e) => setErr(e.message)); }, [loadConversation]);

  useEffect(() => {
    if (!historyOpen) return;
    call('mktg-chat', { action: 'list_conversations' })
      .then((r) => setHistory(r.conversations))
      .catch((e) => setErr(e.message));
  }, [historyOpen]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  // ── Image upload flow (paste / file picker) ──
  async function uploadImageFile(file) {
    if (!file) return;
    if (!ACCEPTED_IMAGE_MIME.includes(file.type)) {
      setErr(`Unsupported image type: ${file.type || 'unknown'}`);
      return;
    }
    setUploading(true); setErr('');
    try {
      const data_base64 = await fileToBase64(file);
      const r = await call('mktg-upload', {
        action: 'create',
        kind: 'image',
        mime_type: file.type,
        data_base64,
        conversation_id: id,
      });
      setPendingImages((arr) => [...arr, {
        upload_id:    r.upload.id,
        storage_path: r.upload.storage_path,
        mime_type:    r.upload.mime_type,
        signed_url:   r.signed_url,
        name:         file.name || 'image',
      }]);
    } catch (e) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function onPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault();
        await uploadImageFile(item.getAsFile());
      }
    }
  }

  function onFilePick(e) {
    const files = Array.from(e.target.files || []);
    files.forEach(uploadImageFile);
    e.target.value = '';
  }

  // Camera button — captures a photo (mobile) or opens file picker (desktop)
  // and stages it in `swipeCapture` so the user can add context before saving.
  function onCameraPick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ACCEPTED_IMAGE_MIME.includes(file.type)) {
      setErr(`Unsupported image type: ${file.type || 'unknown'}`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setSwipeCapture({ file, previewUrl: reader.result });
    reader.readAsDataURL(file);
  }

  async function saveToSwipeFile({ what, why, tags, target_table, target_id }) {
    if (!swipeCapture) return;
    setUploading(true); setErr('');
    try {
      const data_base64 = await fileToBase64(swipeCapture.file);
      const caption = [what?.trim(), why?.trim()].filter(Boolean).join(' — ') || null;
      const baseTags = ['swipe'];
      const extra = (tags || '')
        .split(',').map((t) => t.trim()).filter(Boolean);
      await call('mktg-upload', {
        action: 'create',
        kind: 'image',
        mime_type: swipeCapture.file.type,
        data_base64,
        caption,
        tags: [...baseTags, ...extra],
        target_table: target_table || null,
        target_id:    target_id || null,
        // Intentionally NOT setting conversation_id — swipe-file items belong
        // to the global library, not this chat.
      });
      setSwipeCapture(null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
  }

  function removePending(uploadId) {
    setPendingImages((arr) => arr.filter((p) => p.upload_id !== uploadId));
    // Best-effort delete from storage; ignore failures
    call('mktg-upload', { action: 'delete', id: uploadId }).catch(() => {});
  }

  async function send() {
    const text = draft.trim();
    if ((!text && pendingImages.length === 0) || busy || !id) return;
    setBusy(true); setErr('');
    const sentImages = pendingImages;
    setDraft('');
    setPendingImages([]);
    // Optimistic user bubble
    setMessages((m) => [...m, {
      id: `optim-${Date.now()}`,
      role: 'user',
      content_text: text,
      content_blocks: [
        ...sentImages.map((p) => ({
          type: 'image_ref',
          upload_id: p.upload_id,
          storage_path: p.storage_path,
          mime_type: p.mime_type,
          // pass signed_url through for instant display — server doesn't need it
          _signed_url: p.signed_url,
        })),
        ...(text ? [{ type: 'text', text }] : []),
      ],
      created_at: new Date().toISOString(),
    }]);
    try {
      const r = await call('mktg-chat', {
        action: 'send',
        conversation_id: id,
        text,
        attachments: sentImages.map((p) => ({
          upload_id:    p.upload_id,
          storage_path: p.storage_path,
          mime_type:    p.mime_type,
        })),
      });
      setMessages(r.messages);
    } catch (e) {
      setErr(e.message);
      loadConversation().catch(() => {});
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function newChat() {
    setHistoryOpen(false);
    const r = await call('mktg-chat', { action: 'create_conversation', kind: 'context' });
    nav(`/business/marketing/chat/${r.conversation.id}`);
  }

  return (
    <div className="chat-shell">
      <header className="chat-header">
        <button className="chat-icon-btn" onClick={() => setHistoryOpen(true)} aria-label="History">☰</button>
        <div className="chat-title">
          <div>{conversation?.title || 'Marketing chat'}</div>
          <div className="dim" style={{ fontSize: 11 }}>
            {conversation?.active_campaign ? `focus: ${conversation.active_campaign}` : 'context-feeding'}
          </div>
        </div>
        <Link to="/business/marketing" className="chat-icon-btn" aria-label="Back to marketing">×</Link>
      </header>

      {err && <div className="error" style={{ margin: '8px 12px' }}>{err}</div>}

      <div className="chat-stream" ref={scrollRef}>
        {messages.length === 0 && !busy && (
          <div className="empty" style={{ marginTop: 40 }}>
            New chat. Paste copy or screenshots, share a link, ask about a concept, or just start talking.
          </div>
        )}
        {messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
        {busy && (
          <div className="bubble assistant ghost">
            <div className="dots"><span /><span /><span /></div>
          </div>
        )}
      </div>

      {attachOpen && (
        <AttachPanel
          conversationId={id}
          onClose={() => setAttachOpen(false)}
          onSaved={() => { setAttachOpen(false); loadConversation().catch(() => {}); }}
        />
      )}

      {pendingImages.length > 0 && (
        <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: '1px solid var(--border)', overflowX: 'auto' }}>
          {pendingImages.map((p) => (
            <div key={p.upload_id} style={{ position: 'relative', flex: '0 0 auto' }}>
              <img
                src={p.signed_url}
                alt={p.name}
                style={{ height: 56, borderRadius: 8, border: '1px solid var(--border)' }}
              />
              <button
                onClick={() => removePending(p.upload_id)}
                title="Remove"
                aria-label="Remove image"
                style={{
                  position: 'absolute', top: -6, right: -6,
                  width: 20, height: 20, borderRadius: '50%',
                  padding: 0, fontSize: 12, lineHeight: '18px',
                  background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
                }}
              >×</button>
            </div>
          ))}
        </div>
      )}

      <div className="chat-composer">
        <button
          className="chat-icon-btn"
          onClick={() => setAttachOpen((v) => !v)}
          aria-label="Attach link or text"
          title="Attach a link / text snippet"
          style={{ flex: '0 0 auto' }}
        >＋</button>
        <button
          className="chat-icon-btn"
          onClick={() => fileRef.current?.click()}
          aria-label="Attach image"
          title="Attach an image to this chat (or just paste one)"
          disabled={uploading}
          style={{ flex: '0 0 auto' }}
        >{uploading ? '…' : '🖼'}</button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_IMAGE_MIME.join(',')}
          multiple
          onChange={onFilePick}
          style={{ display: 'none' }}
        />
        <button
          className="chat-icon-btn"
          onClick={() => cameraRef.current?.click()}
          aria-label="Camera → swipe file"
          title="Take a photo and save it to the swipe file with context"
          disabled={uploading}
          style={{ flex: '0 0 auto' }}
        >📷</button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onCameraPick}
          style={{ display: 'none' }}
        />
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder="Ask, paste copy, paste a screenshot, plan a concept…"
          rows={1}
          disabled={busy}
        />
        <button onClick={send} className="primary" disabled={busy || (!draft.trim() && pendingImages.length === 0)}>
          {busy ? '…' : 'Send'}
        </button>
      </div>

      {swipeCapture && (
        <SwipeContextModal
          previewUrl={swipeCapture.previewUrl}
          busy={uploading}
          onCancel={() => setSwipeCapture(null)}
          onSave={saveToSwipeFile}
        />
      )}

      {historyOpen && (
        <HistoryDrawer
          history={history}
          activeId={id}
          onClose={() => setHistoryOpen(false)}
          onPick={(cid) => { setHistoryOpen(false); nav(`/business/marketing/chat/${cid}`); }}
          onNew={newChat}
        />
      )}
    </div>
  );
}

// ── Render one message bubble (user / assistant / tool) ──
function MessageBubble({ msg }) {
  if (msg.role === 'tool') {
    const blocks = Array.isArray(msg.content_blocks) ? msg.content_blocks : [];
    const tools = blocks.filter((b) => b.type === 'tool_result');
    if (tools.length === 0) return null;
    // If any tool_result carried wizard finalize output, render the
    // ready-to-paste card inline so Curtis can copy fields without leaving chat.
    const ready = tools.map(parseReadyToPaste).find(Boolean);
    if (ready) return <ReadyToPasteCard ready={ready.ready} draft={ready.draft} />;
    return (
      <div className="bubble assistant ghost" style={{ alignSelf: 'flex-start', fontSize: 11 }}>
        <span className="dim">used {tools.length} tool{tools.length === 1 ? '' : 's'}</span>
      </div>
    );
  }

  const blocks = Array.isArray(msg.content_blocks) && msg.content_blocks.length
    ? msg.content_blocks
    : [{ type: 'text', text: msg.content_text || '' }];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  const tools = blocks.filter((b) => b.type === 'tool_use');
  const images = blocks.filter((b) => b.type === 'image_ref');

  if (msg.role === 'assistant' && !text && tools.length > 0) {
    return (
      <div className="bubble assistant ghost" style={{ fontSize: 11 }}>
        <span className="dim">calling {tools.map((t) => t.name).join(', ')}…</span>
      </div>
    );
  }
  if (!text && images.length === 0) return null;

  return (
    <div className={`bubble ${msg.role}`}>
      {images.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: text ? 8 : 0 }}>
          {images.map((img, i) => <ImageRef key={i} block={img} />)}
        </div>
      )}
      {text && <div className="bubble-text">{text}</div>}
      {tools.length > 0 && (
        <div className="bubble-meta">used {tools.map((t) => t.name).join(', ')}</div>
      )}
    </div>
  );
}

// tool_result content is stored as a stringified JSON blob (see mktg-chat
// runChat). Try to parse it and pick out the wizard finalize payload so we
// can render the ready-to-paste card.
function parseReadyToPaste(block) {
  if (!block || block.type !== 'tool_result') return null;
  let raw = block.content;
  if (Array.isArray(raw)) raw = raw.map((b) => b.text || '').join('');
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.finalized && parsed.ready_to_paste) {
      return { ready: parsed.ready_to_paste, draft: parsed.draft };
    }
  } catch { /* not JSON or not a finalize result */ }
  return null;
}

function ReadyToPasteCard({ ready, draft }) {
  const fields = [
    { label: 'Ad name',     value: ready.ad_name,      hint: 'Meta → Ad → Name' },
    { label: 'Primary text', value: ready.primary_text, hint: 'Meta → Primary text', big: true },
    { label: 'Headline',    value: ready.headline,     hint: 'Meta → Headline' },
    { label: 'Description', value: ready.description,  hint: 'Meta → Description' },
    { label: 'CTA',         value: ready.cta,          hint: 'Meta → Call to action button' },
    { label: 'Website URL', value: ready.website_url,  hint: 'Meta → Website URL' },
  ];
  return (
    <div className="card" style={{ alignSelf: 'stretch', borderColor: 'var(--accent)' }}>
      <div className="title" style={{ marginBottom: 6 }}>✨ Ready to paste into Meta</div>
      <div className="row-list" style={{ gap: 6 }}>
        {fields.map((f) => f.value ? (
          <div key={f.label} className="row-item" style={{ padding: '8px 10px' }}>
            <div className="name" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>{f.label}</span>
              <CopyMini text={f.value} />
            </div>
            <div className="meta dim">{f.hint}</div>
            <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', fontSize: f.big ? 13 : 14 }}>{f.value}</div>
          </div>
        ) : null)}
      </div>
      {draft?.id && (
        <div style={{ marginTop: 10, textAlign: 'right' }}>
          <Link to={`/business/marketing/wizard/${draft.id}`} className="primary" style={{
            display: 'inline-block', textDecoration: 'none', color: '#06130c',
            background: 'var(--accent)', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
          }}>
            Edit &amp; submit to creator →
          </Link>
        </div>
      )}
    </div>
  );
}

function CopyMini({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        if (!text) return;
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      style={{ fontSize: 11, padding: '2px 8px' }}
      title="Copy"
    >
      {done ? '✓' : 'Copy'}
    </button>
  );
}

// Lazily fetch a fresh signed URL when first rendering an image_ref (signed URLs
// expire after 5 minutes, so we do this every time the message comes back into
// view from a fresh load).
function ImageRef({ block }) {
  const [src, setSrc] = useState(block._signed_url || null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (src) return;
    if (!block.upload_id) return;
    let alive = true;
    call('mktg-upload', { action: 'signed_url', id: block.upload_id })
      .then((r) => { if (alive) setSrc(r.url); })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [block.upload_id, src]);

  if (err) return <div className="dim" style={{ fontSize: 11 }}>[image unavailable]</div>;
  if (!src) return <div className="dim" style={{ fontSize: 11 }}>loading image…</div>;
  return (
    <img
      src={src}
      alt=""
      style={{ maxWidth: 240, maxHeight: 240, borderRadius: 8, border: '1px solid var(--border)' }}
    />
  );
}

// ── Attach text/link/screenshot description ──
function AttachPanel({ conversationId, onClose, onSaved }) {
  const [kind, setKind] = useState('text');
  const [textBody, setTextBody] = useState('');
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setBusy(true); setErr('');
    try {
      await call('mktg-upload', {
        action: 'create',
        kind,
        text_body: kind !== 'link' ? textBody || null : null,
        url:       kind === 'link' ? url || null : null,
        caption:   caption || null,
        conversation_id: conversationId,
      });
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-elev)', padding: 12 }}>
      <div className="filterbar" style={{ marginBottom: 10 }}>
        {['text','link','screenshot'].map((k) => (
          <button
            key={k}
            className={kind === k ? 'primary' : ''}
            style={{ fontSize: 12, padding: '6px 10px' }}
            onClick={() => setKind(k)}
          >{k}</button>
        ))}
        <div className="spacer" />
        <button onClick={onClose} style={{ fontSize: 12, padding: '6px 10px' }}>Cancel</button>
      </div>

      {kind === 'link' && (
        <div className="field"><label>URL</label><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></div>
      )}
      {(kind === 'text' || kind === 'screenshot') && (
        <div className="field">
          <label>{kind === 'screenshot' ? 'What does the screenshot show?' : 'Pasted copy / note'}</label>
          <textarea value={textBody} onChange={(e) => setTextBody(e.target.value)} rows={3} />
        </div>
      )}
      <div className="field">
        <label>What's good about it / why share</label>
        <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="optional caption" />
      </div>
      {err && <div className="error">{err}</div>}
      <button onClick={save} className="primary" disabled={busy} style={{ width: '100%' }}>
        {busy ? 'Saving…' : 'Save to context'}
      </button>
    </div>
  );
}

// ── Swipe-file context modal — prompts for "what is this / why do I like it"
// before the photo gets saved, so it stays useful in future improvements. ──
function SwipeContextModal({ previewUrl, busy, onCancel, onSave }) {
  const [what, setWhat] = useState('');
  const [why, setWhy] = useState('');
  const [tags, setTags] = useState('');
  const [campaign, setCampaign] = useState('');

  return (
    <div className="drawer" onClick={busy ? null : onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          margin: 'auto',
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: 16,
          width: 'min(94vw, 460px)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Add to swipe file</div>
        {previewUrl && (
          <img
            src={previewUrl}
            alt=""
            style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)', marginBottom: 12 }}
          />
        )}
        <div className="field">
          <label>What is this?</label>
          <input
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            placeholder="e.g. shelf shot at New World, competitor IG ad, packaging close-up…"
            autoFocus
          />
        </div>
        <div className="field">
          <label>Why do you like it / what's good about it?</label>
          <textarea
            rows={3}
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="What stood out? Who's it for? What about it works?"
          />
        </div>
        <div className="row">
          <div className="field">
            <label>Tags (comma-separated)</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="packaging, ugc, retail…"
            />
          </div>
          <div className="field">
            <label>Campaign</label>
            <select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
              <option value="">— none —</option>
              <option value="tallow-balm">tallow-balm</option>
              <option value="shampoo-bar">shampoo-bar</option>
              <option value="reviana">reviana</option>
            </select>
          </div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            onClick={() => onSave({
              what, why, tags,
              target_table: campaign ? 'mktg_campaigns' : null,
              target_id:    campaign || null,
            })}
            className="primary"
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save to swipe file'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Conversation drawer ──
function HistoryDrawer({ history, activeId, onClose, onPick, onNew }) {
  return (
    <div className="drawer" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <strong>Marketing chats</strong>
          <button onClick={onNew}>+ New</button>
        </div>
        <Link to="/business/marketing/memory" className="drawer-row" onClick={onClose}>
          <strong>Memory facts</strong>
          <div className="dim" style={{ fontSize: 11 }}>Long-term marketing patterns</div>
        </Link>
        {history.length === 0 ? (
          <div className="empty">No chats yet.</div>
        ) : history.map((c) => (
          <a
            key={c.id}
            href={`/ckf/business/marketing/chat/${c.id}`}
            className={`drawer-row ${c.id === activeId ? 'active' : ''}`}
            onClick={(e) => { e.preventDefault(); onPick(c.id); }}
          >
            <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.title || 'Untitled'}
            </div>
            <div className="dim" style={{ fontSize: 11 }}>
              {fmtRelative(c.last_message_at)}{c.active_campaign ? ` · ${c.active_campaign}` : ''}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Helpers ──
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // result is "data:image/png;base64,XXXX" — strip prefix
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Read failed'));
    reader.readAsDataURL(file);
  });
}
