import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import Header from '../components/Header.jsx';
import { call } from '../lib/api.js';
import { fmtRelative, fmtShortDate } from '../lib/format.js';
import {
  isRecordingSupported, startRecording,
  transcribe, speak, stopPlayback,
  isTtsOn, setTtsOn,
  createVoiceSession,
} from '../lib/voice.js';

const HATS = [
  { id: 'therapist', label: 'Therapist' },
  { id: 'business',  label: 'Business' },
  { id: 'pt',        label: 'PT' },
  { id: 'spiritual', label: 'Spiritual' },
];

function voiceLabel(state) {
  switch (state) {
    case 'listening':  return '🎙 Listening…';
    case 'recording':  return '🔴 Hearing you';
    case 'processing': return '… Thinking';
    case 'paused':     return '⏸ Paused';
    case 'stopped':    return 'Stopped';
    default:           return '🎙 On';
  }
}

export default function Chat({ embedded = false }) {
  const { id: routeId } = useParams();
  const [embeddedId, setEmbeddedId] = useState(null);
  const id = embedded ? embeddedId : routeId;
  const nav = useNavigate();
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [modeHint, setModeHint] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const scrollRef = useRef(null);
  const taRef = useRef(null);
  const autoOpenedRef = useRef(new Set());
  const recorderRef = useRef(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [ttsOn, setTts] = useState(() => isTtsOn());
  const lastSpokenRef = useRef(null);

  // Hands-free voice mode (continuous listen → silence → reply → speak → resume)
  const voiceSessionRef = useRef(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceState, setVoiceState] = useState('idle');

  // ── Routing logic ──
  // - Standalone /chat (no id): open today's conversation and redirect to /chat/:id
  // - Embedded (on Home): just open today's id locally; never navigates
  useEffect(() => {
    if (id) return;
    let alive = true;
    (async () => {
      try {
        const r = await call('ckf-chat', { action: 'open_today' });
        if (!alive) return;
        if (embedded) {
          setEmbeddedId(r.conversation.id);
        } else {
          nav(`/chat/${r.conversation.id}`, { replace: true });
        }
      } catch (e) {
        if (alive) setErr(e.message);
      }
    })();
    return () => { alive = false; };
  }, [id, nav, embedded]);

  // ── Load conversation + messages on id change ──
  const loadConversation = useCallback(async () => {
    if (!id) return;
    const r = await call('ckf-chat', { action: 'get_conversation', id });
    setConversation(r.conversation);
    setMessages(r.messages);
  }, [id]);

  useEffect(() => {
    loadConversation().catch((e) => setErr(e.message));
  }, [loadConversation]);

  // ── Auto-open: when a conversation is fresh (zero messages), the AI opens
  // the chat with a contextual greeting / evening-reflection question. We guard
  // against double-firing using autoOpenedRef.
  useEffect(() => {
    if (!id || !conversation || messages.length > 0 || busy) return;
    if (autoOpenedRef.current.has(id)) return;
    autoOpenedRef.current.add(id);
    setBusy(true);
    call('ckf-chat', { action: 'auto_open', conversation_id: id, mode_hint: modeHint })
      .then((r) => {
        if (r.messages) setMessages(r.messages);
        if (r.text) window.dispatchEvent(new CustomEvent('ckf-assistant-text', { detail: r.text }));
      })
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(false));
    // Intentionally not depending on modeHint — we only auto-open once per
    // conversation, regardless of later hat changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, conversation, messages.length]);

  // ── Load history list when drawer opens ──
  useEffect(() => {
    if (!historyOpen) return;
    call('ckf-chat', { action: 'list_conversations' })
      .then((r) => setHistory(r.conversations))
      .catch((e) => setErr(e.message));
  }, [historyOpen]);

  // ── Auto-scroll to bottom when messages change ──
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  async function send() {
    const text = draft.trim();
    if (!text || busy || !id) return;
    setDraft('');
    setBusy(true); setErr('');
    // Optimistic append
    setMessages((m) => [...m, { id: 'optimistic', role: 'user', content_text: text, created_at: new Date().toISOString() }]);
    try {
      const r = await call('ckf-chat', { action: 'send', conversation_id: id, text, mode_hint: modeHint });
      setMessages(r.messages);
      // Notify caller (Voice mode listener) about the new assistant text
      window.dispatchEvent(new CustomEvent('ckf-assistant-text', { detail: r.text }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault(); send();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); send();
    }
  }

  // ── Voice: record → transcribe → fill composer (don't auto-send so he can edit)
  async function toggleMic() {
    if (recording) {
      // Stop & transcribe
      const rec = recorderRef.current;
      recorderRef.current = null;
      setRecording(false);
      if (!rec) return;
      setTranscribing(true);
      try {
        const blob = await rec.stop();
        if (!blob || blob.size < 200) { setTranscribing(false); return; } // ignore taps
        const text = await transcribe(blob);
        if (text) {
          setDraft((d) => (d ? `${d} ${text}` : text));
          setTimeout(() => taRef.current?.focus(), 0);
        }
      } catch (e) {
        setErr(e.message);
      } finally {
        setTranscribing(false);
      }
      return;
    }
    // Start
    if (!isRecordingSupported()) {
      setErr('Voice not supported on this device.');
      return;
    }
    stopPlayback();
    try {
      const rec = await startRecording();
      recorderRef.current = rec;
      setRecording(true);
    } catch (e) {
      setErr(e.message || 'Mic permission denied');
    }
  }

  // ── TTS: when an assistant text arrives and TTS is on, speak it
  useEffect(() => {
    if (!ttsOn) return;
    const handler = (e) => {
      const text = e.detail;
      if (!text || text === lastSpokenRef.current) return;
      lastSpokenRef.current = text;
      speak(text).catch(() => {});
    };
    window.addEventListener('ckf-assistant-text', handler);
    return () => window.removeEventListener('ckf-assistant-text', handler);
  }, [ttsOn]);

  // Also speak the latest assistant message when TTS gets toggled on (covers
  // auto_open replies that landed before the listener attached).
  useEffect(() => {
    if (!ttsOn) { stopPlayback(); return; }
    const lastAsst = [...messages].reverse().find((m) => m.role === 'assistant' && m.content_text?.trim());
    if (lastAsst && lastAsst.content_text !== lastSpokenRef.current) {
      lastSpokenRef.current = lastAsst.content_text;
      speak(lastAsst.content_text).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsOn]);

  function flipTts() {
    const next = !ttsOn;
    setTts(next);
    setTtsOn(next);
    if (!next) stopPlayback();
  }

  // ── Hands-free voice mode ──
  // Reusable sender that bypasses the composer (used by voice mode + push-to-talk autosend).
  const sendText = useCallback(async (text) => {
    if (!text || !text.trim() || !id) return;
    setBusy(true); setErr('');
    setMessages((m) => [...m, { id: `optimistic-${Date.now()}`, role: 'user', content_text: text, created_at: new Date().toISOString() }]);
    try {
      const r = await call('ckf-chat', { action: 'send', conversation_id: id, text, mode_hint: modeHint });
      setMessages(r.messages);
      return r.text;
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }, [id, modeHint]);

  function startVoiceMode() {
    // Voice mode implies TTS — turn it on if it's off.
    if (!ttsOn) { setTts(true); setTtsOn(true); }
    stopPlayback();
    const session = createVoiceSession({
      onState: (s) => setVoiceState(s),
      onError: (e) => setErr(e?.message || String(e)),
      onSpeech: async (text) => {
        // Pause listening while we send + speak the reply
        session.pause();
        const replyText = await sendText(text);
        if (replyText) {
          // Speak the reply, then resume listening when audio ends.
          try { await speak(replyText); } catch {}
        }
        session.resume();
      },
    });
    voiceSessionRef.current = session;
    setVoiceMode(true);
    session.start();
  }

  function stopVoiceMode() {
    const s = voiceSessionRef.current;
    voiceSessionRef.current = null;
    if (s) s.stop();
    stopPlayback();
    setVoiceMode(false);
    setVoiceState('idle');
  }

  function flipVoiceMode() {
    if (voiceMode) stopVoiceMode();
    else startVoiceMode();
  }

  // Stop voice session on unmount or conversation change.
  useEffect(() => {
    return () => {
      if (voiceSessionRef.current) { voiceSessionRef.current.stop(); voiceSessionRef.current = null; }
      stopPlayback();
    };
  }, [id]);

  async function newChat() {
    const r = await call('ckf-chat', { action: 'create_conversation' });
    nav(`/chat/${r.conversation.id}`);
    setHistoryOpen(false);
  }

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  if (!id || !conversation) return <div className="app"><div className="loading">Loading…</div></div>;

  // Filter to renderable messages: text from user/assistant. Tool results are silent.
  const visible = messages.filter((m) => {
    if (m.role === 'tool') return false;
    if (m.role === 'assistant' && !m.content_text?.trim()) return false; // tool-only assistant turn
    return true;
  });

  // Detect any tool_use blocks in the most recent assistant turn so we can hint
  // "thinking…" subtly.
  const lastAsst = [...messages].reverse().find((m) => m.role === 'assistant');
  const lastUsedTools = (lastAsst?.content_blocks || []).filter((b) => b?.type === 'tool_use').map((b) => b.name);

  return (
    <div className={`chat-shell ${embedded ? 'chat-embedded' : ''}`}>
      {!embedded && (
        <header className="chat-header">
          <button onClick={() => setHistoryOpen(true)} className="chat-icon-btn" aria-label="History">☰</button>
          <div className="chat-title">
            <div style={{ fontWeight: 600 }}>{conversation.title || 'New chat'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{fmtShortDate(conversation.nz_date)}</div>
          </div>
          <button onClick={newChat} className="chat-icon-btn" aria-label="New chat">+</button>
        </header>
      )}

      <div className="hat-row">
        {HATS.map((h) => (
          <button
            key={h.id}
            className={`hat-pill ${modeHint === h.id ? 'active' : ''}`}
            onClick={() => setModeHint(modeHint === h.id ? null : h.id)}
          >
            {h.label}
          </button>
        ))}
        <button
          className={`hat-pill ${voiceMode ? 'active voice-active' : ''}`}
          onClick={flipVoiceMode}
          title="Hands-free voice mode — listen, reply, repeat"
          style={{ marginLeft: 'auto' }}
        >
          {voiceMode ? voiceLabel(voiceState) : 'Hands-free'}
        </button>
        <button
          className={`hat-pill ${ttsOn ? 'active' : ''}`}
          onClick={flipTts}
          title="Speak replies aloud"
          disabled={voiceMode}
        >
          {ttsOn ? '🔊' : '🔈'}
        </button>
        <Link to="/chat/memory" className="hat-pill">Memory</Link>
      </div>

      <div className="chat-stream" ref={scrollRef}>
        {visible.length === 0 && !busy && (
          <div className="empty" style={{ padding: '40px 16px', textAlign: 'center' }}>
            Opening…
          </div>
        )}
        {visible.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            <div className="bubble-text">{m.content_text}</div>
            <div className="bubble-meta">{fmtRelative(m.created_at)}</div>
          </div>
        ))}
        {busy && (
          <div className="bubble assistant ghost">
            <div className="bubble-text">
              <span className="dots"><span/><span/><span/></span>
              {lastUsedTools.length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                  using {lastUsedTools.slice(0, 3).join(', ')}{lastUsedTools.length > 3 ? '…' : ''}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="chat-composer">
        <button
          onClick={toggleMic}
          className={`mic-btn ${recording ? 'recording' : ''}`}
          disabled={transcribing || busy || voiceMode}
          aria-label={recording ? 'Stop recording' : 'Record voice'}
          title={voiceMode ? 'Disabled in hands-free mode' : recording ? 'Stop' : 'Tap to talk once'}
        >
          {transcribing ? '…' : recording ? '■' : '🎙'}
        </button>
        <textarea
          ref={taRef}
          rows={1}
          value={draft}
          placeholder={
            voiceMode ? 'Hands-free is on — just talk. Tap to stop.'
            : recording ? 'Listening…'
            : transcribing ? 'Transcribing…'
            : 'Type or tap the mic'
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy || recording || transcribing || voiceMode}
        />
        <button onClick={send} className="primary" disabled={busy || recording || transcribing || voiceMode || !draft.trim()}>Send</button>
      </div>

      {!embedded && historyOpen && (
        <div className="drawer" onClick={() => setHistoryOpen(false)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div style={{ fontWeight: 600 }}>Conversations</div>
              <button onClick={() => setHistoryOpen(false)} className="chat-icon-btn">✕</button>
            </div>
            <button className="primary" style={{ margin: '0 12px 12px', width: 'calc(100% - 24px)' }} onClick={newChat}>+ New chat</button>
            {history.length === 0 ? <div className="empty">No history yet.</div> :
              history.map((c) => (
                <Link
                  key={c.id}
                  to={`/chat/${c.id}`}
                  className={`drawer-row ${c.id === id ? 'active' : ''}`}
                  onClick={() => setHistoryOpen(false)}
                >
                  <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.title || 'New chat'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    {fmtShortDate(c.nz_date)} · {fmtRelative(c.last_message_at)}
                  </div>
                </Link>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
