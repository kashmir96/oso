import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import Header from '../components/Header.jsx';
import { call, notifyChanged } from '../lib/api.js';
import { fmtRelative, fmtShortDate } from '../lib/format.js';
import {
  isRecordingSupported, startRecording,
  transcribe, speak, stopPlayback,
  isTtsOn, setTtsOn,
  createVoiceSession,
} from '../lib/voice.js';
import { processFile, revokePreview } from '../lib/upload.js';

// Marketing-mode is now driven by the AI in chat (creative_pipeline tool),
// not by a client-side intercept that navigates away. Curtis types
// "marketing mode" -> ckf-chat sees it -> AI walks him through brief intake
// + stages + approve + VO + assistant submit, all inline. The Creative page
// becomes a view-only result card he visits when the flow ends.

// Hat selection is handled by the model from context; no manual UI for it.
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

export default function Chat({ embedded = false, scope = 'personal' }) {
  const { id: routeId } = useParams();
  const [embeddedId, setEmbeddedId] = useState(null);
  const id = embedded ? embeddedId : routeId;
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  // ?mode=website_capture from the Business page Website-mode FAB. The hint is
  // passed through to ckf-chat on every send so the AI keeps capturing.
  const urlMode = searchParams.get('mode');
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // ?mode=website_capture flips the chat into capture-only behaviour. Threaded
  // through to ckf-chat (auto_open + send) so the AI's STABLE_SYSTEM keeps it
  // active across every turn, not just the first.
  const [modeHint, setModeHint] = useState(urlMode || null);
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

  // Attachments staged for the next message (image / document blobs encoded
  // base64 — sent inline to Claude vision/document, not yet stored in Storage).
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const [attachments, setAttachments] = useState([]);

  // "+" fan-out for camera / file / TTS. Closes when an option is picked or
  // the user taps outside.
  const [plusOpen, setPlusOpen] = useState(false);
  const mealInputRef = useRef(null);
  const [logMealBusy, setLogMealBusy] = useState(false);

  // ── Routing logic ──
  // - Standalone /chat (no id): open today's conversation and redirect to /chat/:id
  // - Embedded (on Home): just open today's id locally; never navigates
  useEffect(() => {
    if (id) return;
    let alive = true;
    // Reset embedded id when scope changes — Home and Business hold separate threads.
    if (embedded) setEmbeddedId(null);
    (async () => {
      try {
        const r = await call('ckf-chat', { action: 'open_today', scope });
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
  }, [id, nav, embedded, scope]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, conversation, messages.length]);

  // ── Load history list when drawer opens ──
  useEffect(() => {
    if (!historyOpen) return;
    call('ckf-chat', { action: 'list_conversations', scope })
      .then((r) => setHistory(r.conversations))
      .catch((e) => setErr(e.message));
  }, [historyOpen]);

  // ── Auto-scroll to bottom when messages change ──
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  // ── "Record script" fast-path widget (business chat) ──
  // Triggers: "record script", "voice this", "i have a script", "paste a script",
  // "read this script". Opens an inline bubble with a textarea + Generate Audio
  // + Send to Assistant buttons. No AI in the loop until Send to Assistant
  // (which runs the wrap_script stage server-side).
  const [recordWidget, setRecordWidget] = useState(null);
  function isRecordScriptTrigger(t) {
    const s = (t || '').toLowerCase();
    return /\b(record\s+script|voice\s+this|i\s+have\s+a\s+script|paste\s+a\s+script|read\s+this\s+script)\b/.test(s);
  }
  function stripRecordScriptTrigger(text) {
    return (text || '')
      .replace(/\b(record\s+script|voice\s+this|i\s+have\s+a\s+script|paste\s+a\s+script|read\s+this\s+script)\b/ig, '')
      .replace(/^[\s.,—:;-]+|[\s.,—:;-]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  async function send() {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || busy || !id) return;

    if (scope === 'business' && isRecordScriptTrigger(text)) {
      setDraft('');
      // initial: any text typed alongside the trigger pre-fills the textarea
      setRecordWidget({ initial: stripRecordScriptTrigger(text) });
      return;
    }

    setDraft('');
    setBusy(true); setErr('');
    const payloadAttachments = attachments.map(({ kind, media_type, data_base64, filename }) => ({
      kind, media_type, data_base64, filename,
    }));
    // Clear staged attachments + revoke object URLs
    attachments.forEach(revokePreview);
    setAttachments([]);
    // Optimistic append
    setMessages((m) => [...m, { id: 'optimistic', role: 'user', content_text: text || '(attachment)', created_at: new Date().toISOString() }]);
    const sentAtMs = Date.now();
    const baselineMsgCount = messages.length;
    try {
      const r = await call('ckf-chat', {
        action: 'send', conversation_id: id, text: text || '',
        attachments: payloadAttachments,
        mode_hint: modeHint,
      });
      setMessages(r.messages);
      window.dispatchEvent(new CustomEvent('ckf-assistant-text', { detail: r.text }));
      notifyChanged();
    } catch (e) {
      // Netlify-timeout (504/502/timeout) recovery: the function often keeps
      // running past the 26s wall-clock kill, so the DB write completes even
      // though the HTTP response was cut. Don't surface a scary error -- wait
      // a beat, re-fetch the conversation, and if new messages exist, treat
      // it as success.
      const isGatewayTimeout = e.status === 504 || e.status === 502 || /timeout|timed out/i.test(e.message || '');
      if (isGatewayTimeout) {
        const recovered = await tryRecoverFromTimeout(id, baselineMsgCount, sentAtMs);
        if (recovered.ok) {
          setMessages(recovered.messages);
          if (recovered.lastAssistantText) {
            window.dispatchEvent(new CustomEvent('ckf-assistant-text', { detail: recovered.lastAssistantText }));
          }
          notifyChanged();
        } else if (recovered.partialOk) {
          // Tool result landed but the AI's reply call timed out. Show what
          // we have and a soft note rather than a red error.
          setMessages(recovered.messages);
          notifyChanged();
          setErr('That took longer than usual to reply -- the work landed but the assistant didn\'t finish typing. Send "continue" or look at the result.');
        } else {
          setErr(`Timed out after ${(Date.now() - sentAtMs) / 1000 | 0}s with no reply. Try again -- the system might have been cold.`);
        }
      } else {
        setErr(e.message);
      }
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  }

  // Background poll after a 504. Fetch the conversation; if the message count
  // went up since we sent, the function actually completed. Returns:
  //   { ok: true, messages, lastAssistantText }       -- final assistant reply landed
  //   { partialOk: true, messages }                   -- tool result landed but no final reply
  //   { ok: false }                                   -- nothing landed
  async function tryRecoverFromTimeout(convId, baselineMsgCount, sentAtMs) {
    // Poll up to 3 times over ~6s -- the function might still be writing
    // when the gateway killed the response.
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const r = await call('ckf-chat', { action: 'get_conversation', id: convId });
        const newMsgs = r?.messages || [];
        if (newMsgs.length <= baselineMsgCount) continue;
        // Find the last assistant message AFTER our send timestamp.
        const lastAsst = [...newMsgs].reverse().find((m) =>
          m.role === 'assistant' && m.content_text?.trim() &&
          new Date(m.created_at).getTime() >= sentAtMs - 1000
        );
        if (lastAsst) return { ok: true, messages: newMsgs, lastAssistantText: lastAsst.content_text };
        // Got new tool/user messages but no assistant text yet.
        return { partialOk: true, messages: newMsgs };
      } catch { /* keep polling */ }
    }
    return { ok: false };
  }

  async function onPickFiles(files, fromCamera) {
    if (!files || files.length === 0) return;
    setErr('');
    for (const f of files) {
      try {
        const att = await processFile(f);
        att.from_camera = !!fromCamera;
        setAttachments((a) => [...a, att]);
      } catch (e) {
        setErr(e.message);
      }
    }
  }
  function removeAttachment(i) {
    setAttachments((a) => {
      revokePreview(a[i]);
      return a.filter((_, idx) => idx !== i);
    });
  }

  // Log a meal directly via /meals API — image goes to Storage + AI scan,
  // visible to the trainer share, NOT pushed into the chat conversation.
  async function logMealFromCamera(files) {
    const file = files?.[0];
    if (!file) return;
    setErr(''); setLogMealBusy(true);
    try {
      const att = await processFile(file);
      const logTo = localStorage.getItem('ckf_meals_log_goal') || null;
      await call('ckf-meals', {
        action: 'create',
        image_base64: att.data_base64,
        mime_type: att.media_type,
        log_to_goal_id: logTo,
      });
      revokePreview(att);
      // Inject a friendly "logged" message into the assistant stream so the
      // user gets feedback inside chat without re-running auto_open.
      setMessages((m) => [...m, {
        id: `meal-${Date.now()}`,
        role: 'assistant',
        content_text: `Meal logged. The AI estimate is in your Meals page${logTo ? ' and counted toward your linked calorie goal' : ''}.`,
        created_at: new Date().toISOString(),
      }]);
    } catch (e) { setErr(e.message); }
    finally { setLogMealBusy(false); }
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
      notifyChanged();
      return r.text;
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }, [id, modeHint]);

  async function startVoiceMode() {
    // Voice mode implies TTS — turn it on if it's off.
    if (!ttsOn) { setTts(true); setTtsOn(true); }
    stopPlayback();
    setVoiceMode(true);
    setVoiceState('processing');

    // Speak a prompt FIRST so the AI starts the conversation, not the user.
    // - Empty conversation: auto_open generates a contextual greeting.
    // - Existing conversation: short re-engagement prompt so the user knows
    //   the mic is live without re-running the whole opener.
    let opener = null;
    try {
      if (!messages.length && id) {
        const r = await call('ckf-chat', {
          action: 'auto_open',
          conversation_id: id,
          mode_hint: modeHint,
        });
        if (r.messages) setMessages(r.messages);
        opener = r.text;
      } else {
        opener = modeHint === 'website_capture'
          ? "Ready — what's the first one?"
          : "What's on your mind?";
      }
    } catch (e) {
      setErr(e.message);
      opener = "Listening.";
    }

    if (opener) {
      try { await speak(opener); } catch {}
    }

    // Now start listening. getUserMedia prompt happens here on first run; user
    // has already heard the AI greet, so the prompt-context makes sense.
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
    const r = await call('ckf-chat', { action: 'create_conversation', scope });
    nav(`/chat/${r.conversation.id}`);
    setHistoryOpen(false);
  }

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  // Render the shell immediately even before the conversation loads — so the
  // composer + voice/camera buttons are present right away. Input is disabled
  // until id resolves; the stream shows a quiet "Opening…" placeholder.
  const ready = !!id && !!conversation;

  // Filter to renderable messages: text from user/assistant. Tool results are silent.
  const visible = ready ? messages.filter((m) => {
    if (m.role === 'tool') return false;
    if (m.role === 'assistant' && !m.content_text?.trim()) return false; // tool-only assistant turn
    return true;
  }) : [];

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
            <div style={{ fontWeight: 600 }}>{conversation?.title || 'New chat'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{conversation?.nz_date ? fmtShortDate(conversation.nz_date) : ''}</div>
          </div>
          <button onClick={newChat} className="chat-icon-btn" aria-label="New chat">+</button>
        </header>
      )}

      {/* Voice-mode status pill — only when active, very subtle */}
      {voiceMode && (
        <div className="voice-status">
          <span className="dot" /> {voiceLabel(voiceState)}
          <button onClick={flipVoiceMode} className="voice-stop">stop</button>
        </div>
      )}

      <div className="chat-stream" ref={scrollRef}>
        {!ready && (
          <div className="empty" style={{ padding: '40px 16px', textAlign: 'center' }}>
            Opening…
          </div>
        )}
        {ready && visible.length === 0 && !busy && (
          <div className="empty" style={{ padding: '40px 16px', textAlign: 'center' }}>
            Say hi, or pick a thread.
          </div>
        )}
        {visible.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            <div className="bubble-text">{m.content_text}</div>
            <div className="bubble-meta">{fmtRelative(m.created_at)}</div>
          </div>
        ))}
        {recordWidget && (
          <RecordScriptWidget
            initial={recordWidget.initial}
            onClose={() => setRecordWidget(null)}
          />
        )}
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

      {attachments.length > 0 && (
        <div className="attachment-tray">
          {attachments.map((a, i) => (
            <div key={i} className="attachment-chip" title={a.filename}>
              {a.kind === 'image'
                ? <img src={a.preview_url} alt="" />
                : <span style={{ fontSize: 18 }}>📄</span>}
              <span className="attachment-name">{a.filename}</span>
              <button onClick={() => removeAttachment(i)} aria-label="Remove" className="attachment-x">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Hidden file inputs — triggered by the composer buttons. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => { onPickFiles(e.target.files, true); e.target.value = ''; }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { onPickFiles(e.target.files, false); e.target.value = ''; }}
      />
      <input
        ref={mealInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => { logMealFromCamera(e.target.files); e.target.value = ''; }}
      />

      <div className="chat-composer">
        {plusOpen && (
          <div className="plus-fan" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => { flipTts(); setPlusOpen(false); }}
              className={`tts-btn ${ttsOn ? 'on' : ''}`}
              disabled={voiceMode}
              title={ttsOn ? 'Read replies aloud — on' : 'Read replies aloud — off'}
            >{ttsOn ? '🔊' : '🔈'}</button>
            <button
              onClick={() => { cameraInputRef.current?.click(); setPlusOpen(false); }}
              className="cam-btn"
              disabled={voiceMode || busy}
              title="Take a photo"
            >📷</button>
            <button
              onClick={() => { fileInputRef.current?.click(); setPlusOpen(false); }}
              className="file-btn"
              disabled={voiceMode || busy}
              title="Attach an image or PDF"
            >📎</button>
            <button
              onClick={() => { mealInputRef.current?.click(); setPlusOpen(false); }}
              className="meal-btn"
              disabled={voiceMode || busy || logMealBusy}
              title="Log a meal (saves to /meals + trainer share)"
            >🍽</button>
          </div>
        )}
        <button
          onClick={() => setPlusOpen((v) => !v)}
          className={`plus-btn ${plusOpen ? 'open' : ''}`}
          disabled={voiceMode || busy}
          aria-label={plusOpen ? 'Close attachments' : 'Open attachments'}
          title="Attach photo, file, or toggle read-aloud"
        >+</button>
        <div className="composer-field">
          <textarea
            ref={taRef}
            rows={1}
            value={draft}
            placeholder={
              !ready ? 'Opening…'
              : voiceMode ? 'Hands-free is on — just talk.'
              : 'Type a message…'
            }
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setPlusOpen(false)}
            disabled={busy || voiceMode || !ready}
          />
          <button
            onClick={flipVoiceMode}
            className={`field-mic ${voiceMode ? 'recording' : ''}`}
            disabled={busy && !voiceMode}
            aria-label={voiceMode ? 'Stop hands-free' : 'Switch to hands-free conversation'}
            title={voiceMode ? 'Stop hands-free' : 'Hands-free voice — tap and talk'}
          >
            {voiceMode ? (
              // Stop square — visible without a border because background turns red
              <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="1.5" /></svg>
            ) : (
              // Microphone — clean SVG, renders the same on every platform unlike emoji
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
              </svg>
            )}
          </button>
        </div>
        <button onClick={send} className="primary" disabled={!ready || busy || voiceMode || (!draft.trim() && attachments.length === 0)}>Send</button>
      </div>

      {!embedded && historyOpen && (
        <div className="drawer" onClick={() => setHistoryOpen(false)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div style={{ fontWeight: 600 }}>Conversations</div>
              <button onClick={() => setHistoryOpen(false)} className="chat-icon-btn">✕</button>
            </div>
            <button className="primary" style={{ margin: '0 12px 8px', width: 'calc(100% - 24px)' }} onClick={newChat}>+ New chat</button>
            <Link
              to="/chat/memory"
              onClick={() => setHistoryOpen(false)}
              style={{ display: 'block', margin: '0 12px 12px', textAlign: 'center', fontSize: 13 }}
            >
              View long-term memory →
            </Link>
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

// ─── RecordScriptWidget ────────────────────────────────────────────────────
// Inline bubble in business chat for the "fast path": Curtis types
// "record script" -> this opens with a textarea -> he pastes / writes the
// script -> Generate audio voices it via ElevenLabs -> Send to Assistant
// wraps it with timeline + B-roll via the wrap_script stage and routes to
// the production queue. Ephemeral state -- closes after submit or cancel.
function RecordScriptWidget({ initial = '', onClose }) {
  const [script, setScript] = useState(initial);
  const [creativeId, setCreativeId] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [busy, setBusy] = useState(null); // 'voice' | 'submit' | null
  const [err, setErr] = useState('');
  const [submitted, setSubmitted] = useState(null); // { detail_url, timeline_n, broll_n }

  // Make sure the row exists before voicing or submitting -- both reuse the
  // same creative_id so generation + submit point at the same record.
  async function ensureRow() {
    if (creativeId) return creativeId;
    const r = await call('mktg-ads', {
      action: 'record_script_init',
      script_text: script,
      creative_type: 'video_script',
    });
    if (r.error) throw new Error(r.error);
    setCreativeId(r.creative_id);
    return r.creative_id;
  }

  async function generateAudio() {
    if (!script.trim()) { setErr('Paste a script first.'); return; }
    setBusy('voice'); setErr('');
    try {
      const id = await ensureRow();
      const r = await call('mktg-vo', { action: 'generate_creative', creative_id: id });
      setAudioUrl(r.public_url);
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  }

  async function sendToAssistant() {
    if (!script.trim()) { setErr('Paste a script first.'); return; }
    setBusy('submit'); setErr('');
    try {
      const id = await ensureRow();
      const r = await call('mktg-ads', { action: 'record_script_submit', creative_id: id });
      if (r.error) throw new Error(r.error);
      setSubmitted({
        detail_url: r.detail_url,
        timeline_n: r.timeline_n,
        broll_n:    r.broll_n,
      });
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  }

  const wordCount = script.trim() ? script.trim().split(/\s+/).length : 0;

  // After submit: collapse to a confirmation row.
  if (submitted) {
    return (
      <div className="bubble assistant" style={{ borderLeft: '3px solid var(--accent, #5cb85c)' }}>
        <div className="bubble-text">
          <div style={{ marginBottom: 4 }}><strong>Sent to Assistant.</strong></div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
            Wrapped with {submitted.timeline_n} timeline beats + {submitted.broll_n} B-roll shots.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <a href={submitted.detail_url} style={{ fontSize: 12, padding: '4px 10px', textDecoration: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}>Open creative →</a>
            <a href="/business/marketing/assistant" style={{ fontSize: 12, padding: '4px 10px', textDecoration: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}>Assistant queue</a>
            <button onClick={onClose} style={{ fontSize: 11, padding: '4px 10px', marginLeft: 'auto' }}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bubble user" style={{ background: 'var(--card-bg, #1c1c1e)', border: '1px solid var(--border)' }}>
      <div className="bubble-text" style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <strong>Record script</strong>
          <button onClick={onClose} style={{ fontSize: 11, padding: '2px 8px' }}>✕</button>
        </div>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={8}
          placeholder="Paste or type the spoken script. Voice it as-is, or send to Assistant to wrap with timeline + B-roll + timestamps."
          style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, padding: 8, borderRadius: 6, border: '1px solid var(--border)', resize: 'vertical' }}
          disabled={!!busy}
        />
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
          {wordCount} words · ~{Math.max(1, Math.round(wordCount / 2.5))}s spoken
        </div>

        {audioUrl && (
          <div style={{ marginTop: 8 }}>
            <audio controls src={audioUrl} style={{ width: '100%' }} />
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <a href={audioUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, padding: '3px 8px', textDecoration: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}>▶ Download MP3</a>
              <button onClick={() => navigator.clipboard.writeText(audioUrl)} style={{ fontSize: 11, padding: '3px 8px' }}>Copy link</button>
            </div>
          </div>
        )}

        {err && <div className="error" style={{ fontSize: 11, marginTop: 6 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <button
            onClick={generateAudio}
            disabled={!!busy || !script.trim()}
            className="primary"
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            {busy === 'voice' ? 'Generating audio…' : (audioUrl ? '↻ Re-render audio' : 'Generate audio')}
          </button>
          <button
            onClick={sendToAssistant}
            disabled={!!busy || !script.trim()}
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            {busy === 'submit' ? 'Wrapping + sending…' : 'Send to Assistant →'}
          </button>
        </div>
      </div>
    </div>
  );
}
