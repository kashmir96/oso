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
