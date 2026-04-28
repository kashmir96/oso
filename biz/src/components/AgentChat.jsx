import { useEffect, useRef, useState } from 'react';
import { call, notifyChanged } from '@ckf-lib/api.js';
import { fmtRelative } from '@ckf-lib/format.js';

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
  const [err, setErr] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingDraft, setEditingDraft] = useState('');
  const scrollRef = useRef(null);
  const taRef = useRef(null);

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

  // ── Filter renderable messages (drop tool turns + empty assistants) ─────
  const visible = messages.filter((m) => {
    if (m.role === 'tool') return false;
    if (isHorizon(m)) return true;
    if (m.role === 'assistant' && !m.content_text?.trim()) return false;
    return true;
  });

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
          <div className="biz-empty">
            {agent.blurb}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
              Type to start. Click any bubble to edit. /help for more.
            </div>
          </div>
        )}
        {visible.map((m) => (
          isHorizon(m) ? (
            <HorizonDivider key={m.id} m={m} />
          ) : (
            <Bubble
              key={m.id}
              m={m}
              isEditing={editingId === m.id}
              editingDraft={editingDraft}
              setEditingDraft={setEditingDraft}
              onStart={() => startEdit(m)}
              onSave={() => saveEdit(m)}
              onCancel={cancelEdit}
              busy={busy}
            />
          )
        ))}
        {busy && (
          <div className="biz-bubble assistant ghost">
            <span className="biz-dots"><span/><span/><span/></span>
          </div>
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

function Bubble({ m, isEditing, editingDraft, setEditingDraft, onStart, onSave, onCancel, busy }) {
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
      <div className="biz-bubble-meta">{fmtRelative(m.created_at)} · click to edit</div>
    </div>
  );
}
