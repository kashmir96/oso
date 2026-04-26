/**
 * ckf-stt.js — speech-to-text via OpenAI Whisper.
 *
 * Body: { audio_base64: string, mime_type?: string }   (default audio/webm)
 * Returns: { text: string, duration_seconds?: number }
 *
 * Env: OPENAI_API_KEY
 */
const { withGate, reply } = require('./_lib/ckf-guard.js');
const { logUsage } = require('./_lib/ckf-usage.js');

const MAX_BYTES = 24 * 1024 * 1024; // ~24 MB safety; Whisper allows 25 MB

exports.handler = withGate(async (event, { user }) => {
  if (!process.env.OPENAI_API_KEY) {
    return reply(500, { error: 'OPENAI_API_KEY not configured' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { audio_base64, mime_type } = body;
  if (!audio_base64 || typeof audio_base64 !== 'string') {
    return reply(400, { error: 'audio_base64 required' });
  }

  let audio;
  try {
    audio = Buffer.from(audio_base64, 'base64');
  } catch (e) {
    return reply(400, { error: 'Invalid base64 audio' });
  }
  if (audio.length === 0) return reply(400, { error: 'Empty audio' });
  if (audio.length > MAX_BYTES) return reply(413, { error: 'Audio too large' });

  // Default to webm; fall back to mp4 since iOS Safari MediaRecorder records mp4.
  const mime = mime_type || 'audio/webm';
  const ext = mime.includes('mp4') ? 'mp4'
    : mime.includes('mpeg') ? 'mp3'
    : mime.includes('wav') ? 'wav'
    : mime.includes('ogg') ? 'ogg'
    : 'webm';

  // Node 18+ has global FormData and Blob.
  const fd = new FormData();
  fd.append('file', new Blob([audio], { type: mime }), `voice.${ext}`);
  fd.append('model', 'whisper-1');
  fd.append('response_format', 'verbose_json');

  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) {
      return reply(res.status, { error: data?.error?.message || `Whisper ${res.status}` });
    }
    const seconds = Number(data?.duration) || 0;
    if (seconds > 0) {
      logUsage({ user_id: user.id, provider: 'openai', action: 'stt', model: 'whisper-1', audio_seconds: seconds });
    }
    return reply(200, {
      text: (data?.text || '').trim(),
      duration_seconds: data?.duration || null,
    });
  } catch (e) {
    console.error('[ckf-stt]', e);
    return reply(500, { error: e.message || 'STT failed' });
  }
});
