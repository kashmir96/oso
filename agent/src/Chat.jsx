import { useEffect, useRef, useState } from 'react';
import { call } from '@ckf-lib/api.js';
import { fmtRelative } from '@ckf-lib/format.js';

/**
 * Chat — single-thread ad-script agent.
 *
 * Loop: chat → agent emits a fenced ```script``` block → user clicks Approve →
 * script saves + a learning is extracted into agent_learnings. Future turns
 * inject approved scripts + learnings so the agent improves over time.
 */
export default function Chat() {
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [approving, setApproving] = useState(false);
  const [stats, setStats] = useState({ approved: 0, learnings: 0 });
  const scrollRef = useRef(null);

  useEffect(() => { (async () => {
    try {
      const r = await call('agent-chat', { action: 'open' });
      setConversation(r.conversation);
      setMessages(r.messages || []);
      setStats(r.stats || { approved: 0, learnings: 0 });
    } catch (e) { setErr(e.message); }
  })(); }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function send() {
    const text = draft.trim();
    if (!text || !conversation || busy) return;
    setBusy(true); setErr(''); setDraft('');
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'user', content: text, created_at: new Date().toISOString() }]);
    try {
      const r = await call('agent-chat', { action: 'send', conversation_id: conversation.id, text });
      setMessages(r.messages);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function newThread() {
    if (busy) return;
    try {
      const r = await call('agent-chat', { action: 'new' });
      setConversation(r.conversation);
      setMessages([]);
    } catch (e) { setErr(e.message); }
  }

  async function approve(message, scriptText) {
    if (approving || !conversation) return;
    setApproving(true); setErr('');
    try {
      const r = await call('agent-chat', {
        action: 'approve',
        conversation_id: conversation.id,
        message_id: message.id,
        script: scriptText,
      });
      setMessages(r.messages);
      setStats(r.stats || stats);
    } catch (e) { setErr(e.message); }
    finally { setApproving(false); }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  // Find the most recent assistant message that contains a fenced script.
  // That's the only one we offer an "Approve" button on -- earlier drafts
  // are part of history.
  const latestDraftIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'assistant') continue;
      if (extractScript(m.content)) return i;
      break; // stop at the first non-script assistant turn -- no stale offers
    }
    return -1;
  })();

  return (
    <div className="ag-app">
      <header className="ag-header">
        <div className="ag-title">📝 Ad Script Agent</div>
        <div className="ag-stats">
          <span title="Approved scripts saved">{stats.approved} approved</span>
          <span className="ag-dot">·</span>
          <span title="Learnings the agent has captured">{stats.learnings} learnings</span>
        </div>
        <button className="ag-new" onClick={newThread} disabled={busy}>New chat</button>
      </header>

      <div className="ag-scroll" ref={scrollRef}>
        {messages.length === 0 && !busy && (
          <div className="ag-empty">
            Drop a brief — product, audience, angle. I’ll draft a script you can approve.
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble
            key={m.id}
            message={m}
            offerApprove={i === latestDraftIdx}
            approving={approving}
            onApprove={approve}
          />
        ))}
        {busy && <div className="ag-typing">thinking…</div>}
      </div>

      {err && <div className="ag-err">{err}</div>}

      <div className="ag-composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Tell me about the ad…"
          rows={2}
          disabled={busy || !conversation}
        />
        <button onClick={send} disabled={busy || !draft.trim() || !conversation}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function Bubble({ message, offerApprove, approving, onApprove }) {
  const isUser = message.role === 'user';
  const script = !isUser ? extractScript(message.content) : null;
  const beforeScript = !isUser && script ? message.content.slice(0, script.startIdx).trim() : message.content;
  const afterScript = !isUser && script ? message.content.slice(script.endIdx).trim() : '';
  const approved = !isUser && message.approved;

  return (
    <div className={`ag-msg ag-${isUser ? 'user' : 'assistant'}`}>
      {beforeScript && <div className="ag-text">{beforeScript}</div>}
      {script && (
        <div className={`ag-script ${approved ? 'ag-script--approved' : ''}`}>
          <div className="ag-script-head">
            <span>SCRIPT</span>
            {approved && <span className="ag-approved">✓ approved</span>}
          </div>
          <pre>{script.text}</pre>
          {offerApprove && !approved && (
            <button
              className="ag-approve"
              onClick={() => onApprove(message, script.text)}
              disabled={approving}
            >
              {approving ? 'Saving…' : 'Approve & save'}
            </button>
          )}
        </div>
      )}
      {afterScript && <div className="ag-text">{afterScript}</div>}
      <div className="ag-time">{fmtRelative(message.created_at)}</div>
    </div>
  );
}

// Pull the first fenced ```script``` block out of an assistant message.
function extractScript(content) {
  if (!content) return null;
  const m = content.match(/```script\s*\n([\s\S]*?)```/i);
  if (!m) return null;
  const startIdx = m.index;
  const endIdx = startIdx + m[0].length;
  return { text: m[1].trim(), startIdx, endIdx };
}
