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
import PipelineCard from '../components/PipelineCard.jsx';

// Marketing-mode is now driven by the AI in chat (creative_pipeline tool),
// not by a client-side intercept that navigates away. Curtis types
// "marketing mode" -> ckf-chat sees it -> AI walks him through brief intake
// + stages + approve + VO + assistant submit, all inline. The Creative page
// becomes a view-only result card he visits when the flow ends.

// Busy bubble for non-pipeline waits (chat-AI thinking, refreshes, etc.).
// Tracks its own elapsed time and surfaces Refresh/Cancel buttons after
// 20s so Curtis can recover from a hung tool loop without page-reloading.
function BusyDots({ lastUsedTools, onRefresh, onCancel }) {
  const [startedAt] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  void tick;
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const showKickstart = elapsed > 20;
  return (
    <div className="bubble assistant ghost">
      <div className="bubble-text">
        <span className="dots"><span/><span/><span/></span>
        {(lastUsedTools || []).length > 0 && (
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
            using {lastUsedTools.slice(0, 3).join(', ')}{lastUsedTools.length > 3 ? '…' : ''}
          </span>
        )}
        {elapsed > 4 && (
          <span style={{ marginLeft: 6, fontSize: 11, color: showKickstart ? 'var(--warn, #d2891f)' : 'var(--text-muted)' }}>
            {elapsed}s
          </span>
        )}
        {showKickstart && (
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={onRefresh} className="primary" style={{ fontSize: 11, padding: '4px 10px' }}>↻ Refresh</button>
            <button onClick={onCancel} style={{ fontSize: 11, padding: '4px 10px' }}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Map raw stage keys to user-friendly labels for the running-status pill.
function prettyStageName(stage) {
  return ({
    strategy:    'strategy',
    variants_ad: 'ad variants',
    outline:     'outline',
    hooks:       'hooks',
    draft:       'draft script',
    critique:    'critique',
  }[stage]) || stage;
}

// Help-text generator: a static list of every typed trigger + slash command
// the chat understands. Rendered locally as a chat message when Curtis types
// /help. Scope-aware — business chat shows the marketing-only triggers;
// personal chat hides them.
function buildHelpText(scope) {
  const sections = [];

  sections.push(
    `Slash commands (any chat):
  /help, /?              — this list
  /new, /reset           — start a new conversation (keeps the old one)
  /clear, /delete        — delete this conversation and start fresh`,
  );

  if (scope === 'business') {
    sections.push(
      `Marketing-mode triggers (business chat only):
  "marketing mode"        — start full creative pipeline (brief → strategy → variants/outline+hooks+draft → critique → approve)
  "let's make an ad"      — same
  "i want to create an ad"— same
  "create an ad"          — same
  "new creative"          — same

Record-script fast path (business chat only):
  "record script"         — opens an inline bubble with a script textarea + Generate Audio + Send to Assistant buttons. Skips the planning stages, just wraps your script with timeline + B-roll and files it to the production queue.
  "voice this"            — same
  "i have a script"       — same
  "paste a script"        — same
  "read this script"      — same`,
    );

    sections.push(
      `Capture modes (business chat only):
  "website mode"          — start queuing PrimalPantry storefront improvements (every following message gets queued until you say "exit website mode")
  "system update"         — start queuing CKF / second-brain code changes (every following message until "stop")`,
    );
  }

  sections.push(
    `Capture modes (both chats):
  "swipefile mode"        — silent dump: every following message is saved to your swipefile until you say "leave swipefile mode"`,
  );

  sections.push(
    `Things you can ask the AI directly (no triggers needed):
  "what did i write about X"                — searches diary + memory + swipefile
  "show my recent meals"                    — pulls last 7 days of meals
  "create a routine task to ___"            — adds to your routine
  "log <metric> = <value>"                  — logs a goal value
  "remember that <fact>"                    — stores a long-term memory fact
  "remind me to ___ at <time>"              — schedules an SMS reminder via errand
  "show my goals" / "open goals"            — pulls active goals
  "what's coming up" / "calendar this week" — Google Calendar (if connected)
  "generate an image of ___" /
    "image: ___"                            — AI image (OpenAI gpt-image-1, ~$0.04/img). Optionally seed off an existing image for variations (b-roll). Requires OPENAI_API_KEY.
  "generate a video of ___" /
    "video: ___" / "make a 5s clip of ___"  — AI video (Gemini Veo 2, ~$0.50/sec, default 5s). Long-running: returns immediately, cron finalises in ~1-2 min. Image-to-video by seeding off an asset. Requires GEMINI_API_KEY.
  "generate captions for <creative>" /
    "caption that VO"                       — SRT + VTT caption files from a creative's voiceover (ElevenLabs scribe_v1). Cheap (~$0.0001/sec). Also as a button on the Creative ResultCard's voiceover panel.`,
  );

  sections.push(
    `Pipeline state (after running marketing mode):
  /business/marketing/creative/<id>         — read-only result card for one creative (also reachable via clicking the card link)
  /business/marketing/assistant             — production queue (drafts + creatives ready for asset upload)
  /business/marketing/health                — system dashboard: pending pattern proposals, audit memos, token cost`,
  );

  return sections.join('\n\n');
}

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

    // Slash commands -- client-side intercepts. /new and /reset start a
    // fresh conversation; /clear deletes the current one as well so it
    // doesn't clutter the history sidebar (useful for wiping a failed
    // marketing-mode pipeline). All bypass the chat API.
    const lower = text.toLowerCase().trim();
    if (lower === '/new' || lower === '/reset') {
      setDraft('');
      await resetChat();
      return;
    }
    if (lower === '/clear' || lower === '/delete') {
      setDraft('');
      if (!confirm('Delete this conversation and start fresh?')) return;
      await resetChat({ discard: true });
      return;
    }
    if (lower === '/help' || lower === '/commands' || lower === '/?') {
      setDraft('');
      // Inject a local-only help message. Doesn't go to the API; just shown
      // in the bubble stream until the next refresh.
      const helpText = buildHelpText(scope);
      setMessages((m) => [
        ...m,
        { id: `help-${Date.now()}`, role: 'user',      content_text: text, created_at: new Date().toISOString() },
        { id: `help-r-${Date.now()}`, role: 'assistant', content_text: helpText, created_at: new Date().toISOString() },
      ]);
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

  // "Reset" — start a fresh conversation in the same scope. Used for the
  // /reset and /new slash commands and the Reset button in the header.
  // Optionally deletes the current conversation if `discard` is true.
  async function resetChat({ discard = false } = {}) {
    if (discard && id) {
      try { await call('ckf-chat', { action: 'delete_conversation', id }); }
      catch { /* swallow -- starting fresh is more important than cleanup */ }
    }
    autoFiredRef.current = new Set();
    setSubmittedCards(new Set());
    setMessages([]);
    setRecordWidget(null);
    setErr('');
    await newChat();
  }

  // Render the shell immediately even before the conversation loads — so the
  // composer + voice/camera buttons are present right away. Input is disabled
  // until id resolves; the stream shows a quiet "Opening…" placeholder.
  const ready = !!id && !!conversation;

  // Filter to renderable messages: text from user/assistant + pipeline cards.
  // Tool results are silent. Card-only assistant messages (text=null +
  // pipeline_card block) ARE shown via the dedicated card renderer.
  const visible = ready ? messages.filter((m) => {
    if (m.role === 'tool') return false;
    const blocks = Array.isArray(m.content_blocks) ? m.content_blocks : [];
    const hasPipelineCard = blocks.some((b) => b?.type === 'pipeline_card');
    if (m.role === 'assistant' && !m.content_text?.trim() && !hasPipelineCard) return false;
    return true;
  }) : [];

  // Track which cards have been "used" (submitted). Once submitted, we lock
  // the card so Curtis can't accidentally re-edit a stage that already
  // advanced. Keyed by message id + block index.
  const [submittedCards, setSubmittedCards] = useState(() => new Set());

  // Track which creative_ids we've already auto-fired strategy for, so we
  // don't double-fire on every render. Set keyed by creative_id.
  const autoFiredRef = useRef(new Set());

  // Pipeline-stage status indicator. Set when a slow stage is running so
  // Curtis can see "Running variants… 8s" instead of just generic dots.
  // Cleared when the stage completes (success or error).
  // Shape: { stage: 'variants_ad', startedAt: epoch_ms, label?: string } | null
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [statusTick, setStatusTick] = useState(0); // forces re-render every second while a stage runs
  useEffect(() => {
    if (!pipelineStatus) return;
    const t = setInterval(() => setStatusTick((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [pipelineStatus]);
  // statusTick is read implicitly via Date.now() during render; reference
  // it once so React knows this component depends on it (avoids the
  // "value never used" warning AND ensures the second-by-second tick
  // actually re-renders the elapsed counter).
  void statusTick;

  // ── Manual kick-start handlers when something hangs ───────────────────
  // These are exposed in the status row after ~20s elapsed AND on a
  // stand-alone "stuck" panel when busy is true with no pipeline stage.

  // Cancel: just clear the local spinner. The server-side work might still
  // be running -- that's fine; the next refreshConversation will pick up
  // any results.
  function cancelInFlight() {
    setBusy(false);
    setPipelineStatus(null);
    setErr('');
  }

  // Refresh: re-fetch the conversation. If the server completed but the
  // HTTP response was killed (504/timeout-after-write), this surfaces the
  // results without forcing a page reload.
  async function refreshConversation() {
    if (!id) return;
    try {
      const conv = await call('ckf-chat', { action: 'get_conversation', id });
      setMessages(conv.messages);
      notifyChanged();
    } catch (e) { setErr(e.message); }
  }

  // Retry the currently-running pipeline stage. Only meaningful when
  // pipelineStatus is set; clears + re-fires the same stage with a fresh
  // 26s budget.
  async function retryPipelineStage() {
    if (!pipelineStatus) return;
    const { stage, creative_id } = pipelineStatus;
    setPipelineStatus({ stage, startedAt: Date.now(), label: `Retrying ${prettyStageName(stage)}`, creative_id });
    setBusy(true); setErr('');
    try {
      await call('mktg-ads', {
        action: 'pipeline_run_stage_for_card',
        conversation_id: id, creative_id, stage,
      });
      const conv = await call('ckf-chat', { action: 'get_conversation', id });
      setMessages(conv.messages);
      notifyChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
      setPipelineStatus(null);
    }
  }

  // Detect successful intake_brief tool results in fresh assistant messages
  // and auto-fire the strategy stage via the direct endpoint (NOT the chat
  // AI -- that's how we avoid 504s from chained Sonnet calls in one tool
  // loop). The first card lands in the conversation as a result.
  // CRITICAL: this useEffect MUST be declared before any conditional
  // early returns (e.g. `if (err) return ...`) -- otherwise hook order
  // changes between renders and React tears the whole component down.
  useEffect(() => {
    if (!ready || busy) return;
    // Walk recent messages looking for a tool_use creative_pipeline call
    // with action='intake_brief' AND its matching tool_result with a
    // creative_id we haven't auto-fired yet.
    const recent = messages.slice(-8);
    let pendingCreativeId = null;
    for (let i = 0; i < recent.length; i++) {
      const m = recent[i];
      if (m.role !== 'assistant') continue;
      const blocks = Array.isArray(m.content_blocks) ? m.content_blocks : [];
      const intakeBrief = blocks.find((b) =>
        b?.type === 'tool_use' && b?.name === 'creative_pipeline' && b?.input?.action === 'intake_brief'
      );
      if (!intakeBrief) continue;
      // Look for the matching tool_result in the next message.
      const next = recent[i + 1];
      if (!next || next.role !== 'tool') continue;
      const toolBlocks = Array.isArray(next.content_blocks) ? next.content_blocks : [];
      const result = toolBlocks.find((b) => b?.type === 'tool_result' && b?.tool_use_id === intakeBrief.id);
      if (!result) continue;
      // tool_result.content is a JSON string with the pipeline.intakeBrief output.
      let parsed = null;
      try { parsed = typeof result.content === 'string' ? JSON.parse(result.content) : result.content; } catch {}
      const cid = parsed?.creative_id;
      if (cid && parsed?.ok && !autoFiredRef.current.has(cid)) {
        pendingCreativeId = cid;
      }
    }
    if (!pendingCreativeId) return;
    autoFiredRef.current.add(pendingCreativeId);
    (async () => {
      setBusy(true); setErr('');
      setPipelineStatus({ stage: 'strategy', startedAt: Date.now(), label: 'Generating strategy', creative_id: pendingCreativeId });
      try {
        await call('mktg-ads', {
          action: 'pipeline_run_stage_for_card',
          conversation_id: id, creative_id: pendingCreativeId, stage: 'strategy',
        });
        const conv = await call('ckf-chat', { action: 'get_conversation', id });
        setMessages(conv.messages);
        notifyChanged();
      } catch (e) {
        const isTimeout = e.status === 504 || e.status === 502;
        setErr(isTimeout ? 'Strategy is still generating -- card will appear in a moment, refresh if it doesn\'t.' : e.message);
      } finally {
        setBusy(false);
        setPipelineStatus(null);
      }
    })();
  }, [messages, ready, busy, id]);

  // Submit handler: edits were already saved by PipelineCard via
  // pipeline_save_stage_edits. Now we directly call the run-stage endpoint
  // (NOT through the chat AI -- that's how we avoid 504s from chained
  // Sonnet calls in one tool loop). The endpoint runs the stage with its
  // own 26s budget, inserts a new pipeline_card message, and we refresh
  // the conversation.
  async function onCardSubmit({ stage, next_stage_hint, creative_id, msgKey }) {
    setSubmittedCards((s) => new Set(s).add(msgKey));
    if (!next_stage_hint) {
      // No next stage means we're done with the slow flow (critique was the
      // last). Tell the AI conversationally so it can prompt approve / VO /
      // submit-to-Assistant.
      try {
        const r = await call('ckf-chat', {
          action: 'send', conversation_id: id, text: 'Approved the final stage. Ready for approval / voiceover / Assistant.', mode_hint: modeHint,
        });
        setMessages(r.messages);
        notifyChanged();
      } catch (e) { setErr(e.message); }
      return;
    }
    // Run the next slow stage directly. The endpoint inserts a new card
    // message into the conversation; we refresh after to see it.
    setBusy(true); setErr('');
    setPipelineStatus({
      stage: next_stage_hint, startedAt: Date.now(),
      label: `Generating ${prettyStageName(next_stage_hint)}`,
      creative_id,
    });
    try {
      await call('mktg-ads', {
        action: 'pipeline_run_stage_for_card',
        conversation_id: id,
        creative_id,
        stage: next_stage_hint,
      });
      // Refresh the conversation to pick up the freshly-inserted card.
      const conv = await call('ckf-chat', { action: 'get_conversation', id });
      setMessages(conv.messages);
      notifyChanged();
    } catch (e) {
      const isTimeout = e.status === 504 || e.status === 502;
      setErr(isTimeout ? 'Stage ran longer than expected -- refresh in a moment to see the next card.' : e.message);
    } finally {
      setBusy(false);
      setPipelineStatus(null);
    }
  }

  // Detect any tool_use blocks in the most recent assistant turn so we can hint
  // "thinking…" subtly.
  const lastAsst = [...messages].reverse().find((m) => m.role === 'assistant');
  const lastUsedTools = (lastAsst?.content_blocks || []).filter((b) => b?.type === 'tool_use').map((b) => b.name);

  // Early returns AFTER all hooks have been called, never before -- React
  // requires the same hook order on every render.
  if (err && !ready) return <div className="app"><div className="error">{err}</div></div>;

  return (
    <div className={`chat-shell ${embedded ? 'chat-embedded' : ''}`}>
      {!embedded && (
        <header className="chat-header">
          <button onClick={() => setHistoryOpen(true)} className="chat-icon-btn" aria-label="History">☰</button>
          <div className="chat-title">
            <div style={{ fontWeight: 600 }}>{conversation?.title || 'New chat'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{conversation?.nz_date ? fmtShortDate(conversation.nz_date) : ''}</div>
          </div>
          {/* Discard + restart for failed marketing-mode runs. The + button
              starts a new conversation but leaves the old one in history;
              this nukes the current row entirely. Click guarded by a
              confirm dialog. Same effect as typing "/clear". */}
          <button
            onClick={() => { if (confirm('Delete this conversation and start fresh?')) resetChat({ discard: true }); }}
            className="chat-icon-btn"
            aria-label="Reset and discard this chat"
            title="Reset (deletes this conversation)"
            style={{ opacity: 0.7 }}
          >↻</button>
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
        {visible.map((m) => {
          const blocks = Array.isArray(m.content_blocks) ? m.content_blocks : [];
          const cards = blocks
            .map((b, i) => ({ b, i }))
            .filter(({ b }) => b?.type === 'pipeline_card');
          return (
            <div key={m.id} className={`bubble ${m.role}`}>
              {m.content_text?.trim() && <div className="bubble-text">{m.content_text}</div>}
              {cards.map(({ b, i }) => {
                const msgKey = `${m.id}:${i}`;
                return (
                  <PipelineCard
                    key={msgKey}
                    stage={b.stage}
                    creative_id={b.creative_id}
                    payload={b.payload}
                    locked={submittedCards.has(msgKey)}
                    onSubmit={({ stage, next_stage_hint }) => onCardSubmit({ stage, next_stage_hint, creative_id: b.creative_id, msgKey })}
                  />
                );
              })}
              <div className="bubble-meta">{fmtRelative(m.created_at)}</div>
            </div>
          );
        })}
        {recordWidget && (
          <RecordScriptWidget
            initial={recordWidget.initial}
            onClose={() => setRecordWidget(null)}
          />
        )}
        {/* Pipeline-stage status: when a slow stage is running directly
            (not through the chat AI), show which stage + how long. Lets
            Curtis distinguish "behind-the-scenes work" from "stuck".
            After 20s, kick-start buttons appear so he can recover. */}
        {pipelineStatus && (() => {
          const elapsed = Math.floor((Date.now() - pipelineStatus.startedAt) / 1000);
          const isLong  = elapsed > 18;
          const showKickstart = elapsed > 20;
          return (
            <div className="bubble assistant ghost">
              <div className="bubble-text">
                <span className="dots"><span/><span/><span/></span>
                <span style={{ marginLeft: 8, fontSize: 12 }}>
                  {pipelineStatus.label || `Running ${prettyStageName(pipelineStatus.stage)}`}…
                </span>
                <span style={{ marginLeft: 6, fontSize: 11, color: isLong ? 'var(--warn, #d2891f)' : 'var(--text-muted)' }}>
                  {elapsed}s{isLong ? ' (longer than usual)' : ''}
                </span>
                {showKickstart && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={refreshConversation} className="primary" style={{ fontSize: 11, padding: '4px 10px' }}>↻ Refresh</button>
                    <button onClick={retryPipelineStage} style={{ fontSize: 11, padding: '4px 10px' }}>Retry stage</button>
                    <button onClick={cancelInFlight} style={{ fontSize: 11, padding: '4px 10px' }}>Cancel</button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        {busy && !pipelineStatus && <BusyDots lastUsedTools={lastUsedTools} onRefresh={refreshConversation} onCancel={cancelInFlight} />}
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
