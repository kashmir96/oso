import { useEffect, useRef, useState } from 'react';
import { call, notifyChanged } from '@ckf-lib/api.js';
import { fmtRelative } from '@ckf-lib/format.js';
import PipelineCard from './PipelineCard.jsx';

/**
 * AgentChat — shared chat shell for every biz agent. The agent slug is
 * passed through to the biz-chat backend on every send so the right
 * system prompt + tool subset is loaded.
 *
 * Universal features baked in:
 *   1. Click any bubble to edit. Editing a USER message offers to re-run
 *      the AI from that point (truncates everything after). Editing an
 *      ASSISTANT message just updates it -- the AI sees the edit on its
 *      next turn but no truncation.
 *   2. Clear context. Inserts a horizon marker into the conversation.
 *      Visible chat history stays; the AI only sees messages after the
 *      most recent horizon. "/clear-context" slash command also works.
 *   3. /reset, /new, /clear, /help slash commands (same as /ckf).
 */
export default function AgentChat({ agent }) {
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyStartedAt, setBusyStartedAt] = useState(null);
  const [busyTick, setBusyTick] = useState(0);     // forces re-render every second while busy
  const [err, setErr] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingDraft, setEditingDraft] = useState('');
  const scrollRef = useRef(null);
  const taRef = useRef(null);

  // Tick the elapsed counter every second while busy so the visible
  // timer + "longer than usual" hint update without touching state.
  useEffect(() => {
    if (!busy) { setBusyStartedAt(null); return; }
    setBusyStartedAt(Date.now());
    const t = setInterval(() => setBusyTick((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);
  void busyTick;

  // Bootstrap a conversation per agent. Each agent gets its own thread
  // (scope = `biz_<slug>`); reuse the most recent if one exists.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await call('biz-chat', { action: 'list_conversations', agent: agent.slug });
        let conv = list.conversations?.[0];
        if (!conv) {
          const created = await call('biz-chat', { action: 'create_conversation', agent: agent.slug });
          conv = created.conversation;
        }
        if (!alive) return;
        setConversation(conv);
        const got = await call('biz-chat', { action: 'get_conversation', id: conv.id });
        setMessages(got.messages || []);
      } catch (e) { if (alive) setErr(e.message); }
    })();
    return () => { alive = false; };
  }, [agent.slug]);

  // Auto-scroll on new messages.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  async function send() {
    const text = draft.trim();
    if (!text || busy || !conversation) return;

    // Slash commands (client-side intercepts).
    const lower = text.toLowerCase();
    if (lower === '/help' || lower === '/?')           { setDraft(''); injectHelp(); return; }
    if (lower === '/new' || lower === '/reset')        { setDraft(''); await newConversation(); return; }
    if (lower === '/clear' || lower === '/delete')     { setDraft(''); if (confirm('Delete this conversation?')) await deleteConversation(); return; }
    if (lower === '/clear-context' || lower === '/forget') { setDraft(''); await insertHorizon(); return; }

    setDraft(''); setBusy(true); setErr('');
    setMessages((m) => [...m, { id: 'optimistic', role: 'user', content_text: text, created_at: new Date().toISOString() }]);
    try {
      const r = await call('biz-chat', {
        action: 'send', conversation_id: conversation.id, agent: agent.slug, text,
      });
      setMessages(r.messages);
      notifyChanged();
    } catch (e) {
      const isTimeout = e.status === 504 || e.status === 502;
      if (isTimeout) {
        // Try a recovery refresh.
        try {
          const got = await call('biz-chat', { action: 'get_conversation', id: conversation.id });
          setMessages(got.messages || []);
          setErr('Took longer than usual — refreshed from server.');
        } catch { setErr(e.message); }
      } else setErr(e.message);
    } finally { setBusy(false); taRef.current?.focus(); }
  }

  async function newConversation() {
    const created = await call('biz-chat', { action: 'create_conversation', agent: agent.slug });
    setConversation(created.conversation);
    setMessages([]);
  }
  async function deleteConversation() {
    await call('biz-chat', { action: 'delete_conversation', id: conversation.id });
    await newConversation();
  }
  async function insertHorizon() {
    await call('biz-chat', { action: 'clear_context', conversation_id: conversation.id });
    const got = await call('biz-chat', { action: 'get_conversation', id: conversation.id });
    setMessages(got.messages || []);
  }
  function injectHelp() {
    const helpText = `Slash commands:
  /help, /?              — this list
  /new, /reset           — start a new conversation (history kept)
  /clear, /delete        — delete this conversation entirely
  /clear-context, /forget — keep history visible, but the AI starts fresh from here

Bubble actions:
  Click any bubble       — edit it. Editing a user message offers to re-run from that point. Editing an AI message updates what the AI sees on its next turn (no truncation).`;
    setMessages((m) => [
      ...m,
      { id: `help-${Date.now()}`, role: 'user', content_text: '/help', created_at: new Date().toISOString() },
      { id: `help-r-${Date.now()}`, role: 'assistant', content_text: helpText, created_at: new Date().toISOString() },
    ]);
  }

  // ── Edit any bubble ─────────────────────────────────────────────────────
  function startEdit(m) {
    if (m.id === 'optimistic') return;        // Don't allow editing in-flight
    if (isHorizon(m)) return;                  // Or the horizon divider
    setEditingId(m.id);
    setEditingDraft(m.content_text || '');
  }
  function cancelEdit() { setEditingId(null); setEditingDraft(''); }
  async function saveEdit(m) {
    const newText = editingDraft.trim();
    if (!newText) return cancelEdit();
    const wasUser = m.role === 'user';
    let truncate = false;
    if (wasUser) {
      truncate = confirm('Re-run the AI from this point? (Everything after this message will be removed.)');
    }
    setBusy(true); setErr('');
    try {
      await call('biz-chat', {
        action: 'edit_message', id: m.id, new_text: newText, truncate_after: truncate,
      });
      cancelEdit();
      // If we truncated and the message was a user one, fire a new send so
      // the AI re-runs with the edited message as its latest input.
      if (truncate && wasUser) {
        const r = await call('biz-chat', {
          action: 'continue_after_edit', conversation_id: conversation.id, agent: agent.slug,
        });
        setMessages(r.messages);
      } else {
        const got = await call('biz-chat', { action: 'get_conversation', id: conversation.id });
        setMessages(got.messages || []);
      }
      notifyChanged();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  // ── Filter renderable messages ─────────────────────────────────────────
  // Drop tool turns. Drop empty-assistant turns that have NO pipeline cards
  // (those would be tool-only turns from the AI). Keep horizons + cards.
  const visible = messages.filter((m) => {
    if (m.role === 'tool') return false;
    if (isHorizon(m)) return true;
    const hasCard = Array.isArray(m.content_blocks) && m.content_blocks.some((b) => b?.type === 'pipeline_card');
    if (m.role === 'assistant' && !m.content_text?.trim() && !hasCard) return false;
    return true;
  });

  // Track which pipeline cards have been submitted so they lock to read-only.
  const [submittedCards, setSubmittedCards] = useState(() => new Set());

  async function onPipelineCardSubmit({ stage, next_stage_hint, creative_id, msgKey }) {
    setSubmittedCards((s) => new Set(s).add(msgKey));
    setBusy(true); setErr('');
    try {
      // For now post a synthetic user message back to the chat so the AI
      // sees the approval and runs the next stage. (Same pattern /ckf
      // Chat.jsx uses; we can shift to client-direct stage runs later if
      // 504s become a problem here too.)
      const text = next_stage_hint
        ? `Approved ${stage}. Run ${next_stage_hint} next.`
        : `Approved ${stage}.`;
      const r = await call('biz-chat', {
        action: 'send', conversation_id: conversation.id, agent: agent.slug, text,
      });
      setMessages(r.messages);
      notifyChanged();
    } catch (e) {
      const isTimeout = e.status === 504 || e.status === 502;
      setErr(isTimeout ? 'Edits saved server-side. Type "next" to advance.' : e.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="biz-chat">
      <div className="biz-chat-head">
        <div className="biz-chat-title">
          <span style={{ fontSize: 20, marginRight: 6 }}>{agent.icon}</span>
          <strong>{agent.name}</strong>
        </div>
        <div className="biz-chat-actions">
          <button onClick={() => insertHorizon()} title="Forget context (keeps history)">
            forget
          </button>
          <button onClick={() => newConversation()} title="New conversation">+</button>
          <button onClick={() => { if (confirm('Delete this conversation?')) deleteConversation(); }} title="Delete + start fresh">↻</button>
        </div>
      </div>

      <div className="biz-chat-stream" ref={scrollRef}>
        {visible.length === 0 && !busy && (
          <div className="biz-empty biz-empty-card">
            <div className="biz-empty-icon">{agent.icon}</div>
            <div className="biz-empty-name">{agent.name}</div>
            <div className="biz-empty-blurb">{agent.blurb}</div>
            {Array.isArray(agent.quickPoints) && agent.quickPoints.length > 0 && (
              <ul className="biz-empty-points">
                {agent.quickPoints.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            )}
            <div className="biz-empty-tip">
              Type to start. You can paste a landing-page URL anywhere in the conversation
              and I'll read it for context. Click any bubble to edit. /help for more.
            </div>
          </div>
        )}
        {visible.map((m, idx) => {
          if (isHorizon(m)) return <HorizonDivider key={m.id} m={m} />;
          // Detect pipeline_card blocks on this message and render them
          // inline alongside the assistant's text bubble.
          const blocks = Array.isArray(m.content_blocks) ? m.content_blocks : [];
          const cards = blocks
            .map((b, i) => ({ b, i }))
            .filter(({ b }) => b?.type === 'pipeline_card');
          const previews = collectAssetPreviews(messages, idx, m);
          return (
            <div key={m.id}>
              {(m.content_text?.trim() || previews.length > 0) && (
                <Bubble
                  m={m}
                  previews={previews}
                  isEditing={editingId === m.id}
                  editingDraft={editingDraft}
                  setEditingDraft={setEditingDraft}
                  onStart={() => startEdit(m)}
                  onSave={() => saveEdit(m)}
                  onCancel={cancelEdit}
                  busy={busy}
                />
              )}
              {cards.map(({ b, i }) => {
                const msgKey = `${m.id}:${i}`;
                return (
                  <PipelineCard
                    key={msgKey}
                    stage={b.stage}
                    creative_id={b.creative_id}
                    payload={b.payload}
                    locked={submittedCards.has(msgKey)}
                    onSubmit={({ stage, next_stage_hint }) => onPipelineCardSubmit({ stage, next_stage_hint, creative_id: b.creative_id, msgKey })}
                  />
                );
              })}
            </div>
          );
        })}
        {busy && (
          <BusyBubble
            startedAt={busyStartedAt}
            onRefresh={async () => {
              if (!conversation) return;
              try {
                const got = await call('biz-chat', { action: 'get_conversation', id: conversation.id });
                setMessages(got.messages || []);
                setBusy(false);
              } catch (e) { setErr(e.message); }
            }}
            onCancel={() => { setBusy(false); setErr(''); }}
          />
        )}
      </div>

      <div className="biz-composer">
        {err && <div className="biz-error">{err}</div>}
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder={`Talk to ${agent.name.toLowerCase()}…`}
          rows={1}
          disabled={busy}
        />
        <button className="biz-send" onClick={send} disabled={busy || !draft.trim()}>Send</button>
      </div>
    </div>
  );
}

function isHorizon(m) {
  return Array.isArray(m?.content_blocks) && m.content_blocks.some((b) => b?.type === 'context_horizon');
}

function HorizonDivider({ m }) {
  return (
    <div className="biz-horizon">
      <span className="biz-horizon-line" />
      <span className="biz-horizon-label" title={`Cleared ${fmtRelative(m.created_at)}`}>
        — context cleared —
      </span>
      <span className="biz-horizon-line" />
    </div>
  );
}

function Bubble({ m, previews, isEditing, editingDraft, setEditingDraft, onStart, onSave, onCancel, busy }) {
  if (isEditing) {
    return (
      <div className={`biz-bubble ${m.role} biz-bubble-editing`}>
        <textarea
          autoFocus
          value={editingDraft}
          onChange={(e) => setEditingDraft(e.target.value)}
          rows={Math.min(12, Math.max(2, editingDraft.split('\n').length + 1))}
        />
        <div className="biz-bubble-edit-actions">
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button onClick={onSave} className="primary" disabled={busy || !editingDraft.trim()}>
            Save
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`biz-bubble ${m.role}`} onClick={onStart} title="Click to edit">
      <div className="biz-bubble-text">{m.content_text}</div>
      {previews && previews.length > 0 && (
        <div className="biz-bubble-previews">
          {previews.map((p, i) => (
            <AssetPreview key={i} asset={p} />
          ))}
        </div>
      )}
      <div className="biz-bubble-meta">{fmtRelative(m.created_at)} · click to edit</div>
    </div>
  );
}

// Inline preview for images / videos surfaced by the previous tool turn.
// Anything that looks like a public mktg-assets / mktg-vo URL gets rendered.
function AssetPreview({ asset }) {
  const url = asset.public_url || asset.url || asset;
  if (typeof url !== 'string') return null;
  const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url) || /mktg-vo/.test(url) === false && /mktg-assets/.test(url) && asset.kind === 'video';
  const isAudio = /\.(mp3|m4a|wav)(\?|$)/i.test(url) || /mktg-vo/.test(url);
  const isImage = /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url) || (!isVideo && !isAudio && /mktg-assets/.test(url));
  return (
    <div className="biz-preview" onClick={(e) => e.stopPropagation()}>
      {isImage && <img src={url} alt="" loading="lazy" />}
      {isVideo && <video src={url} controls preload="metadata" />}
      {isAudio && <audio src={url} controls preload="metadata" />}
      <div className="biz-preview-actions">
        <a href={url} target="_blank" rel="noreferrer">Open</a>
        <button onClick={() => navigator.clipboard.writeText(url)}>Copy URL</button>
      </div>
    </div>
  );
}

// Pull asset URLs out of the IMMEDIATE NEXT message's tool_result blocks.
// This covers the common pattern: assistant calls tool → tool returns JSON
// with public_url(s) → next assistant text mentions them. We surface the
// URLs as inline media right under the assistant's text bubble.
function collectAssetPreviews(messages, currentIdx, currentMsg) {
  if (currentMsg.role !== 'assistant') return [];
  // Walk forward looking for the next 'tool' role with tool_result blocks.
  // Stop if we hit another assistant or user.
  const out = [];
  for (let i = currentIdx + 1; i < messages.length && i < currentIdx + 4; i++) {
    const m = messages[i];
    if (m.role === 'tool') {
      const blocks = Array.isArray(m.content_blocks) ? m.content_blocks : [];
      for (const b of blocks) {
        if (b?.type !== 'tool_result') continue;
        const c = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
        const found = scanForAssetUrls(c);
        for (const a of found) out.push(a);
      }
      break;
    }
    if (m.role === 'assistant' || m.role === 'user') break;
  }
  // Also scan the assistant's OWN text for any direct asset URLs (fallback).
  const inText = scanForAssetUrls(currentMsg.content_text || '');
  for (const a of inText) {
    if (!out.find((x) => x.public_url === a.public_url)) out.push(a);
  }
  return out.slice(0, 8);
}

function scanForAssetUrls(text) {
  if (!text) return [];
  const urls = [];
  // Match https://...mktg-assets/... or mktg-vo/...
  const re = /https?:\/\/[^\s"'<>)]+(?:mktg-assets|mktg-vo)[^\s"'<>)]+/g;
  let m;
  while ((m = re.exec(text))) {
    const url = m[0].replace(/[.,;:)]+$/, '');
    if (urls.find((u) => u.public_url === url)) continue;
    let kind = 'asset';
    if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) kind = 'video';
    else if (/\.(mp3|m4a|wav)(\?|$)/i.test(url) || /mktg-vo/.test(url)) kind = 'audio';
    else if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) kind = 'image';
    else if (/mktg-assets/.test(url)) kind = 'image';
    urls.push({ public_url: url, kind });
  }
  return urls;
}

// Activity-aware busy bubble. Shows elapsed seconds; after 20s offers
// kick-start buttons (refresh from server / cancel local spinner).
function BusyBubble({ startedAt, onRefresh, onCancel }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((s) => s + 1), 1000); return () => clearInterval(t); }, []);
  void tick;
  const elapsed = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  const isLong  = elapsed > 12;
  const showKickstart = elapsed > 20;
  return (
    <div className="biz-bubble assistant ghost">
      <span className="biz-dots"><span/><span/><span/></span>
      <span className="biz-busy-label">
        {' '}working… {elapsed}s
        {isLong && !showKickstart && <span style={{ marginLeft: 6, color: 'var(--warn,#d2891f)', fontSize: 11 }}>(longer than usual)</span>}
      </span>
      {showKickstart && (
        <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
          <button onClick={onRefresh} className="primary" style={{ fontSize: 11, padding: '4px 10px' }}>↻ Refresh</button>
          <button onClick={onCancel} style={{ fontSize: 11, padding: '4px 10px' }}>Cancel</button>
        </div>
      )}
    </div>
  );
}
