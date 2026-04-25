// Browser voice helpers — recording (MediaRecorder) and playback (Audio).
// STT goes through ckf-stt; TTS through ckf-tts. We intentionally avoid the
// Web Speech API and use server-side OpenAI Whisper + ElevenLabs for quality.

import { call, getToken } from './api.js';

// ── Recording ──
let activeRecorder = null;

export function isRecordingSupported() {
  return typeof window !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined';
}

// Start recording. Returns an object with stop() that resolves to a Blob.
export async function startRecording() {
  if (!isRecordingSupported()) throw new Error('Recording not supported on this device');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // Pick the most-supported mime type.
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  let mime = '';
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) { mime = c; break; }
  }
  const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

  let resolveBlob;
  const blobPromise = new Promise((r) => (resolveBlob = r));
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    resolveBlob(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
  };

  recorder.start();
  activeRecorder = recorder;

  return {
    stop: async () => {
      if (recorder.state !== 'inactive') recorder.stop();
      activeRecorder = null;
      const blob = await blobPromise;
      return blob;
    },
    cancel: () => {
      try { recorder.stop(); } catch {}
      stream.getTracks().forEach((t) => t.stop());
      activeRecorder = null;
    },
  };
}

export function isRecording() {
  return !!activeRecorder && activeRecorder.state === 'recording';
}

// ── Transcribe via Whisper ──
async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result is "data:<mime>;base64,<...>"; strip the prefix.
      const idx = reader.result.indexOf(',');
      resolve(idx >= 0 ? reader.result.slice(idx + 1) : reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function transcribe(blob) {
  const audio_base64 = await blobToBase64(blob);
  const res = await call('ckf-stt', { audio_base64, mime_type: blob.type });
  return res.text || '';
}

// ── Playback ──
let currentAudio = null;

function base64ToBlobUrl(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime || 'audio/mpeg' }));
}

export function stopPlayback() {
  if (currentAudio) {
    try { currentAudio.pause(); } catch {}
    currentAudio = null;
  }
}

// Speak `text` using ckf-tts. Returns a promise that resolves when audio ends.
// Caller should handle errors silently — voice is an enhancement, not core flow.
export async function speak(text) {
  if (!text || !text.trim()) return;
  stopPlayback();
  const res = await call('ckf-tts', { text });
  if (!res?.audio_base64) return;
  const url = base64ToBlobUrl(res.audio_base64, res.mime_type);
  return new Promise((resolve) => {
    const audio = new Audio(url);
    currentAudio = audio;
    audio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); currentAudio = null; resolve(); };
    audio.play().catch(() => resolve());
  });
}

// ── Settings (auto-TTS toggle, persisted) ──
const TTS_KEY = 'ckf_voice_tts_on';
export function isTtsOn() {
  return localStorage.getItem(TTS_KEY) === '1';
}
export function setTtsOn(on) {
  if (on) localStorage.setItem(TTS_KEY, '1');
  else localStorage.removeItem(TTS_KEY);
}

// Suppress unused-import warning while keeping shape for future use
void getToken;

// ── Continuous voice mode (hands-free) ──
// Listens continuously, detects speech via Web Audio RMS, stops on silence,
// transcribes, hands the text to onSpeech, then waits for resume() (called
// by the chat after TTS finishes). Like ChatGPT's voice mode.
export function createVoiceSession({ onSpeech, onState, onError }) {
  let stream = null;
  let audioCtx = null;
  let analyser = null;
  let recorder = null;
  let chunks = [];
  let rafId = null;
  let state = 'idle'; // idle | listening | recording | processing | paused | stopped
  let stopped = false;
  let paused = false; // true while assistant is speaking / processing
  let lastSpeechTs = 0;
  let firstSpeechTs = 0;
  let recordStartTs = 0;

  // Tunables — tested in Safari iOS + desktop Chrome.
  const FFT = 1024;
  const SILENCE_THRESHOLD = 0.012; // RMS — below this is "silent"
  const SILENCE_MS = 1400;         // how long of silence before sending
  const MIN_SPEECH_MS = 300;       // ignore short pops / breath
  const MAX_RECORDING_MS = 30_000; // hard cap — avoid runaway

  function setState(s) {
    state = s;
    try { onState && onState(s); } catch {}
  }

  function pickMime() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }

  function startListenLoop() {
    if (stopped || paused) return;
    chunks = [];
    firstSpeechTs = 0;
    lastSpeechTs = 0;
    recordStartTs = performance.now();

    const mime = pickMime();
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e) {
      onError && onError(e);
      return;
    }
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = onRecordingStop;

    recorder.start();
    setState('listening');

    const buf = new Float32Array(FFT);
    const tick = () => {
      if (!recorder || recorder.state === 'inactive' || stopped || paused) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();

      if (rms > SILENCE_THRESHOLD) {
        lastSpeechTs = now;
        if (!firstSpeechTs) firstSpeechTs = now;
        if (state === 'listening') setState('recording');
      }

      const speechDur = firstSpeechTs ? now - firstSpeechTs : 0;
      const silenceDur = lastSpeechTs ? now - lastSpeechTs : Infinity;
      const totalDur = now - recordStartTs;

      // Silence after enough speech → stop and transcribe
      if (firstSpeechTs && speechDur > MIN_SPEECH_MS && silenceDur > SILENCE_MS) {
        try { recorder.stop(); } catch {}
        return;
      }
      // Hard cap — too long without a pause, stop anyway
      if (totalDur > MAX_RECORDING_MS) {
        try { recorder.stop(); } catch {}
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  async function onRecordingStop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stopped) return;
    const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
    const hadSpeech = firstSpeechTs > 0 && blob.size > 200;
    if (!hadSpeech) {
      // Empty / too-quiet capture — re-listen.
      if (!paused) startListenLoop();
      return;
    }
    setState('processing');
    try {
      const text = await transcribe(blob);
      if (text && text.trim()) {
        try { await onSpeech(text); } catch (e) { onError && onError(e); }
      } else {
        // Whisper returned nothing useful — re-listen.
        if (!stopped && !paused) startListenLoop();
      }
    } catch (e) {
      onError && onError(e);
      if (!stopped && !paused) startListenLoop();
    }
  }

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);
      startListenLoop();
    } catch (e) {
      onError && onError(e);
      stop();
    }
  }

  function pause() {
    paused = true;
    setState('paused');
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch {}
  }

  function resume() {
    if (stopped) return;
    paused = false;
    startListenLoop();
  }

  function stop() {
    stopped = true;
    paused = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch {}
    try { stream && stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { audioCtx && audioCtx.close(); } catch {}
    setState('stopped');
  }

  return { start, pause, resume, stop, getState: () => state };
}
