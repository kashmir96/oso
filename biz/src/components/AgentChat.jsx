import { useEffect, useRef, useState } from 'react';
import { call, notifyChanged } from '@ckf-lib/api.js';
import { fmtRelative } from '@ckf-lib/format.js';
import {
  isRecordingSupported, startRecording,
  transcribe, speak, stopPlayback,
  isTtsOn, setTtsOn,
  createVoiceSession,
} from '@ckf-lib/voice.js';
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

  // ── Voice: tap mic to record, tap again to stop + transcribe ──
  // Same pattern as /ckf Chat. Transcribed text is appended to the
  // composer draft (NOT auto-sent) so Curtis can edit before sending.
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef(null);

  async function toggleMic() {
    if (recording) {
      const rec = recorderRef.current;
      recorderRef.current = null;
      setRecording(false);
      if (!rec) return;
      setTranscribing(true);
      try {
        const blob = await rec.stop();
        if (!blob || blob.size < 200) { setTranscribing(false); return; }
        const text = await transcribe(blob);
        if (text) {
          setDraft((d) => (d ? `${d} ${text}` : text));
          setTimeout(() => taRef.current?.focus(), 0);
        }
      } catch (e) { setErr(e.message); }
      finally { setTranscribing(false); }
      return;
    }
    if (!isRecordingSupported()) { setErr('Voice not supported on this device.'); return; }
    stopPlayback();
    try {
      const rec = await startRecording();
      recorderRef.current = rec;
      setRecording(true);
    } catch (e) { setErr(e.message || 'Mic permission denied'); }
  }

  // ── TTS toggle: speak AI replies aloud ──
  const [ttsOn, setTtsLocal] = useState(() => isTtsOn());
  function flipTts() {
    const next = !ttsOn;
    setTtsLocal(next);
    setTtsOn(next);
    if (!next) stopPlayback();
  }
  // When TTS is on AND not in voice-mode, speak each new assistant reply.
  // Voice-mode handles its own TTS inline (see startVoiceMode below).
  const lastSpokenRef = useRef(null);
  useEffect(() => {
    if (!ttsOn) return;
    const handler = (e) => {
      const text = e.detail;
      if (!text || text === lastSpokenRef.current) return;
      lastSpokenRef.current = text;
      speak(text).catch(() => {});
    };
    window.addEventListener('biz-assistant-text', handler);
    return () => window.removeEventListener('biz-assistant-text', handler);
  }, [ttsOn]);

  // ── Hands-free voice mode ──
  // Continuous loop: listen → silence detected → transcribe → send → speak
  // reply → resume listening. Curtis just talks, no buttons.
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceState, setVoiceState] = useState('idle');
  const voiceSessionRef = useRef(null);

  // Reusable sender used by voice mode (skips the composer state).
  async function sendTextDirect(text) {
    if (!text?.trim() || !conversation) return;
    setBusy(true); setErr('');
    setMessages((m) => [...m, { id: `optimistic-${Date.now()}`, role: 'user', content_text: text, created_at: new Date().toISOString() }]);
    try {
      const r = await call('biz-chat', {
        action: 'send', conversation_id: conversation.id, agent: agent.slug, text,
      });
      setMessages(r.messages);
      notifyChanged();
      // Tell the TTS listener (and any other consumers) about the new reply.
      if (r.text) window.dispatchEvent(new CustomEvent('biz-assistant-text', { detail: r.text }));
      return r.text;
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function startVoiceMode() {
    if (!ttsOn) { setTtsLocal(true); setTtsOn(true); }
    stopPlayback();
    setVoiceMode(true);
    setVoiceState('processing');

    // Speak a short opener so the AI starts the convo when mic goes live.
    let opener = "What's up?";
    try {
      if (messages.length === 0 && conversation) {
        const r = await call('biz-chat', { action: 'auto_open', conversation_id: conversation.id, agent: agent.slug });
        if (r.messages) setMessages(r.messages);
        opener = r.text || opener;
      }
    } catch { /* swallow; just speak the default */ }
    try { await speak(opener); } catch {}

    const session = createVoiceSession({
      onState: (s) => setVoiceState(s),
      onError: (e) => setErr(e?.message || String(e)),
      onSpeech: async (text) => {
        session.pause();
        const reply = await sendTextDirect(text);
        if (reply) { try { await speak(reply); } catch {} }
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

  function flipVoiceMode() { if (voiceMode) stopVoiceMode(); else startVoiceMode(); }

  // Cleanup on conversation change / unmount.
  useEffect(() => {
    return () => {
      if (voiceSessionRef.current) { voiceSessionRef.current.stop(); voiceSessionRef.current = null; }
      stopPlayback();
    };
  }, [conversation?.id]);

  // Tick the elapsed counter every second while busy so the visible
  // timer + "longer than usual" hint update without touching state.
  useEffect(() => {
    if (!busy) { setBusyStartedAt(null); return; }
    setBusyStartedAt(Date.now());
    const t = setInterval(() => setBusyTick((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);
  void busyTick;

  // Live poll while busy — every 2s re-fetch the conversation. Tool-loop
  // iterations that happen mid-call (assistant emits tool_use → tool
  // executes → tool_result lands → next iteration) will land in
  // ckf_messages as they happen, so polling lets Curtis SEE the AI's
  // intermediate steps in the expanded "thinking" panel.
  useEffect(() => {
    if (!busy || !conversation?.id) return;
    const t = setInterval(async () => {
      try {
        const got = await call('biz-chat', { action: 'get_conversation', id: conversation.id });
        if (Array.isArray(got.messages)) setMessages(got.messages);
      } catch { /* swallow */ }
    }, 2000);
    return () => clearInterval(t);
  }, [busy, conversation?.id]);

  // Auto-fire pipeline stages CLIENT-DIRECT after intake_brief succeeds.
  // The chat AI calls intake_brief (fast: just creates the row) but the
  // SLOW stages (strategy / outline / hooks / draft / critique) run via
  // the dedicated pipeline_run_stage_for_card endpoint with its own 26s
  // budget — never inside the chat AI's tool loop (that's how /ckf
  // avoided the 504s). This effect detects a fresh intake_brief result
  // and fires strategy directly.
  const autoFiredRef = useRef(new Set());
  useEffect(() => {
    if (!conversation?.id || busy) return;
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
      const next = recent[i + 1];
      if (!next || next.role !== 'tool') continue;
      const toolBlocks = Array.isArray(next.content_blocks) ? next.content_blocks : [];
      const result = toolBlocks.find((b) => b?.type === 'tool_result' && b?.tool_use_id === intakeBrief.id);
      if (!result) continue;
      let parsed = null;
      try { parsed = typeof result.content === 'string' ? JSON.parse(result.content) : result.content; } catch {}
      const cid = parsed?.creative_id;
      if (cid && parsed?.ok && !autoFiredRef.current.has(cid)) pendingCreativeId = cid;
    }
    if (!pendingCreativeId) return;
    autoFiredRef.current.add(pendingCreativeId);
    (async () => {
      setBusy(true); setErr('');
      try {
        await call('mktg-ads', {
          action: 'pipeline_run_stage_for_card',
          conversation_id: conversation.id,
          creative_id: pendingCreativeId,
          stage: 'strategy',
        });
        const got = await call('biz-chat', { action: 'get_conversation', id: conversation.id });
        if (Array.isArray(got.messages)) setMessages(got.messages);
      } catch (e) {
        const isTimeout = e.status === 504 || e.status === 502;
        setErr(isTimeout
          ? 'Strategy is still generating — card will appear in a moment. Click ↻ Refresh if it doesn\'t.'
          : e.message);
      } finally { setBusy(false); }
    })();
  }, [messages, conversation?.id, busy]);

  // Bootstrap a conversation per agent. Each agent gets its own thread
  // (scope = `biz_<slug>`); reuse the most recent if one exists. If the
  // thread is empty, fire auto_open so the AI greets immediately.
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
        const existing = got.messages || [];
        setMessages(existing);
        if (existing.length === 0) {
          // Empty thread -- AI opens with a contextual greeting.
          setBusy(true);
          try {
            const open = await call('biz-chat', { action: 'auto_open', conversation_id: conv.id, agent: agent.slug });
            if (alive && !open.skipped) setMessages(open.messages || []);
          } catch (e) { /* swallow; user can still type */ }
          finally { if (alive) setBusy(false); }
        }
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
      if (r.text) window.dispatchEvent(new CustomEvent('biz-assistant-text', { detail: r.text }));
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
  // Drop tool turns. Drop empty-assistant turns that have NO pipeline
  // cards. Drop agent_progress notes (those surface in the busy bar's
  // thinking log instead of cluttering the chat stream).
  const visible = messages.filter((m) => {
    if (m.role === 'tool') return false;
    if (isHorizon(m)) return true;
    const blocks = Array.isArray(m.content_blocks) ? m.content_blocks : [];
    const hasCard = blocks.some((b) => b?.type === 'pipeline_card');
    const onlyProgress = blocks.length > 0 && blocks.every((b) => b?.type === 'agent_progress');
    if (onlyProgress) return false;
    if (m.role === 'assistant' && !m.content_text?.trim() && !hasCard) return false;
    return true;
  });

  // Track which pipeline cards have been submitted so they lock to read-only.
  const [submittedCards, setSubmittedCards] = useState(() => new Set());

  async function onPipelineCardSubmit({ stage, next_stage_hint, creative_id, msgKey }) {
    setSubmittedCards((s) => new Set(s).add(msgKey));
    setBusy(true); setErr('');
    try {
      if (next_stage_hint && creative_id) {
        // Fire the next slow stage CLIENT-DIRECT (own 26s budget) — same
        // pattern as /ckf split-execution. The endpoint inserts a new
        // pipeline_card message into the conversation; we refresh after
        // to surface it.
        await call('mktg-ads', {
          action: 'pipeline_run_stage_for_card',
          conversation_id: conversation.id,
          creative_id,
          stage: next_stage_hint,
        });
        const got = await call('biz-chat', { action: 'get_conversation', id: conversation.id });
        if (Array.isArray(got.messages)) setMessages(got.messages);
        notifyChanged();
      } else {
        // No next stage (we're past critique) — let the AI take over for
        // approve / voiceover / submit-to-Assistant by sending it a short
        // ack so it knows the user accepted.
        const r = await call('biz-chat', {
          action: 'send', conversation_id: conversation.id, agent: agent.slug,
          text: `Approved ${stage}. Ready for approval / voiceover / Assistant.`,
        });
        setMessages(r.messages);
        notifyChanged();
      }
    } catch (e) {
      const isTimeout = e.status === 504 || e.status === 502;
      setErr(isTimeout
        ? 'Stage is still running — card will appear shortly. Click ↻ Refresh if it doesn\'t.'
        : e.message);
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
          <button
            onClick={flipTts}
            disabled={voiceMode}
            className={ttsOn ? 'on' : ''}
            title={ttsOn ? 'Read replies aloud — on' : 'Read replies aloud — off'}
          >{ttsOn ? '🔊' : '🔈'}</button>
          <button
            onClick={flipVoiceMode}
            className={voiceMode ? 'on' : ''}
            title={voiceMode ? 'Stop hands-free voice mode' : 'Start hands-free voice mode'}
          >{voiceMode ? '⏹ voice' : '🎙 voice'}</button>
          <button onClick={() => insertHorizon()} disabled={voiceMode} title="Forget context (keeps history)">
            forget
          </button>
          <button onClick={() => newConversation()} disabled={voiceMode} title="New conversation">+</button>
          <button onClick={() => { if (confirm('Delete this conversation?')) deleteConversation(); }} disabled={voiceMode} title="Delete + start fresh">↻</button>
        </div>
      </div>

      {/* Voice-mode pill */}
      {voiceMode && (
        <div className="biz-voice-status">
          <span className="biz-voice-dot" /> {voiceLabel(voiceState)}
          <button onClick={flipVoiceMode} className="biz-voice-stop">stop</button>
        </div>
      )}

      <div className="biz-chat-stream" ref={scrollRef}>
        {/* Empty state only flashes briefly before auto_open fires.
            No agent icon/name here -- the chat header above already
            carries them. Just the elevator pitch + quick points so
            Curtis knows what's possible while the AI greeting lands. */}
        {visible.length === 0 && !busy && (
          <div className="biz-empty biz-empty-card">
            <div className="biz-empty-blurb">{agent.blurb}</div>
            {Array.isArray(agent.quickPoints) && agent.quickPoints.length > 0 && (
              <ul className="biz-empty-points">
                {agent.quickPoints.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            )}
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
            toolNames={(() => {
              const lastAsst = [...messages].reverse().find((m) => m.role === 'assistant');
              const blocks = lastAsst?.content_blocks;
              if (!Array.isArray(blocks)) return [];
              return blocks.filter((b) => b?.type === 'tool_use').map((b) => b.name);
            })()}
            thinkingLog={buildThinkingLog(messages)}
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
        <button
          className={`biz-mic ${recording ? 'biz-mic-recording' : ''}`}
          onClick={toggleMic}
          disabled={busy || transcribing || voiceMode}
          aria-label={recording ? 'Stop recording' : 'Start voice recording'}
          title={voiceMode ? 'Hands-free voice mode is on' : (recording ? 'Stop & transcribe' : 'Voice → text')}
        >
          {transcribing ? '…' : (recording ? '⏹' : '🎙')}
        </button>
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder={
            voiceMode ? 'Hands-free is on — just talk.'
            : recording ? 'Listening…'
            : `Talk to ${agent.name.toLowerCase()}…`
          }
          rows={1}
          disabled={busy || voiceMode}
        />
        <button className="biz-send" onClick={send} disabled={busy || voiceMode || !draft.trim()}>Send</button>
      </div>
    </div>
  );
}

function isHorizon(m) {
  return Array.isArray(m?.content_blocks) && m.content_blocks.some((b) => b?.type === 'context_horizon');
}

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
  const [copied, setCopied] = useState(false);
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
  // Build a "copy all" payload: bubble text + any inline asset URLs.
  function fullText() {
    const lines = [m.content_text || ''];
    if (previews && previews.length) {
      lines.push('');
      for (const p of previews) lines.push(p.public_url || p.url || '');
    }
    return lines.join('\n').trim();
  }
  function copyAll(e) {
    e.stopPropagation();
    const text = fullText();
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }
  return (
    <div className={`biz-bubble ${m.role}`} onClick={onStart} title="Click to edit">
      {m.role === 'assistant' && (
        <button
          className={`biz-bubble-copy ${copied ? 'copied' : ''}`}
          onClick={copyAll}
          title="Copy this reply (and any asset URLs) to clipboard"
        >{copied ? '✓ Copied' : '📋 Copy all'}</button>
      )}
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

// Activity-aware busy bubble. Big, obvious, animated. Click to expand
// and see the AI's actual tool-call chain in real-time (the thinking log
// is fed by the live conversation poll).
function BusyBubble({ startedAt, toolNames = [], thinkingLog = [], onRefresh, onCancel }) {
  const [tick, setTick] = useState(0);
  // Default expanded so Curtis can SEE what's happening without clicking.
  // He can collapse if he wants the compact view.
  const [expanded, setExpanded] = useState(true);
  useEffect(() => { const t = setInterval(() => setTick((s) => s + 1), 1000); return () => clearInterval(t); }, []);
  void tick;
  const elapsed = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  const isLong  = elapsed > 12;
  const showKickstart = elapsed > 20;
  const toolLabel = toolNames.length > 0 ? prettyTool(toolNames[0]) : null;
  const hasLog = thinkingLog && thinkingLog.length > 0;

  return (
    <div className="biz-busy-bar">
      <div className="biz-busy-shimmer" />
      <div
        className={`biz-busy-row ${hasLog ? 'biz-busy-clickable' : ''}`}
        onClick={hasLog ? () => setExpanded((v) => !v) : undefined}
        role={hasLog ? 'button' : undefined}
        title={hasLog ? 'Click to see what the AI is doing' : undefined}
      >
        <span className="biz-busy-spinner" />
        <span className="biz-busy-headline">
          {toolLabel ? `${toolLabel}…` : 'Generating reply…'}
        </span>
        <span className="biz-busy-elapsed">{elapsed}s</span>
        {isLong && !showKickstart && (
          <span className="biz-busy-warn">— longer than usual, still working</span>
        )}
        {hasLog && (
          <span className="biz-busy-chevron">{expanded ? '▾' : '▸'}</span>
        )}
      </div>
      {toolNames.length > 1 && (
        <div className="biz-busy-sub">+ {toolNames.slice(1, 4).map(prettyTool).join(', ')}</div>
      )}
      {expanded && hasLog && (
        <div className="biz-busy-log">
          <div className="biz-busy-log-head">Thinking log (this turn)</div>
          {thinkingLog.map((entry, i) => (
            <div key={i} className={`biz-busy-log-row biz-busy-log-${entry.kind}`}>
              <span className="biz-busy-log-icon">{logIcon(entry.kind)}</span>
              <span className="biz-busy-log-text">{entry.label}</span>
              {entry.detail && <span className="biz-busy-log-detail">{entry.detail}</span>}
            </div>
          ))}
        </div>
      )}
      {showKickstart && (
        <div className="biz-busy-actions">
          <button onClick={onRefresh} className="primary">↻ Refresh from server</button>
          <button onClick={onCancel}>Cancel</button>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Server may have already finished — refresh picks it up.
          </span>
        </div>
      )}
    </div>
  );
}

function logIcon(kind) {
  return ({
    progress:    '⚙',
    text:        '💬',
    tool_use:    '🔧',
    tool_result: '✓',
    error:       '⚠',
  }[kind]) || '·';
}

// Build a list of recent activity from the messages array — what's
// happened in the CURRENT turn (since the last user message). Each entry
// summarises one block: an assistant text fragment, a tool call, a
// tool result, or a server-side agent_progress note from the stage runner.
// Used by the BusyBubble's expanded "thinking log" panel.
function buildThinkingLog(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  let startIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { startIdx = i; break; }
  }
  if (startIdx === -1) startIdx = 0;
  const out = [];
  for (let i = startIdx + 1; i < messages.length; i++) {
    const m = messages[i];
    const blocks = Array.isArray(m.content_blocks) ? m.content_blocks : [];
    for (const b of blocks) {
      if (b?.type === 'agent_progress') {
        out.push({ kind: 'progress', label: b.note || '(progress)', detail: null });
      } else if (b?.type === 'text' && b.text?.trim()) {
        out.push({ kind: 'text', label: b.text.trim().slice(0, 200) });
      } else if (b?.type === 'tool_use') {
        const params = b.input ? Object.keys(b.input).slice(0, 3).join(', ') : '';
        out.push({
          kind: 'tool_use',
          label: prettyTool(b.name) || `Calling ${b.name}`,
          detail: params ? `(${params})` : null,
        });
      } else if (b?.type === 'tool_result') {
        const c = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
        const isErr = /"error"\s*:/.test(c);
        out.push({
          kind: isErr ? 'error' : 'tool_result',
          label: isErr ? 'Tool returned an error' : 'Tool result received',
          detail: `${c.length} bytes`,
        });
      }
    }
  }
  return out.slice(-15);
}

function prettyTool(name) {
  if (!name) return null;
  return ({
    creative_pipeline:           'Running pipeline stage',
    fetch_landing_page:          'Reading landing page',
    generate_image:              'Generating image',
    generate_video:              'Submitting video to Veo',
    generate_captions:           'Generating captions',
    generate_broll_for_creative: 'Generating B-roll batch',
    list_locked_decisions:       'Reading brand decisions',
    search_swipefile:            'Searching swipefile',
    get_memory_facts:            'Reading memory',
    remember:                    'Saving to memory',
  }[name] || `Calling ${name}`);
}
