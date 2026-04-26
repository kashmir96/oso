/**
 * ckf-tts.js — text-to-speech via ElevenLabs.
 *
 * Body: { text: string, voice_id?: string }
 * Returns: { audio_base64, mime_type: 'audio/mpeg' }
 *
 * Env: ELEVENLABS_API_KEY (required), ELEVENLABS_VOICE_ID (optional default).
 *
 * Uses the Flash v2.5 model — low latency, ~$0.18/1k chars. Fine for
 * conversational replies; switch to eleven_multilingual_v2 for more emotive
 * read-throughs if needed.
 */
const { withGate, reply } = require('./_lib/ckf-guard.js');
const { logUsage } = require('./_lib/ckf-usage.js');

const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb'; // "George" — calm, mellow male
const MODEL_ID = 'eleven_flash_v2_5';
const MAX_CHARS = 4000; // hard cap to stop runaway costs from a malformed reply

exports.handler = withGate(async (event, { user }) => {
  if (!process.env.ELEVENLABS_API_KEY) {
    return reply(500, { error: 'ELEVENLABS_API_KEY not configured' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  let { text, voice_id } = body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return reply(400, { error: 'text required' });
  }
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);

  const voice = voice_id || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return reply(res.status, { error: `ElevenLabs ${res.status}: ${errText.slice(0, 300)}` });
    }
    const arrayBuf = await res.arrayBuffer();
    const audio_base64 = Buffer.from(arrayBuf).toString('base64');
    logUsage({ user_id: user.id, provider: 'elevenlabs', action: 'tts', model: MODEL_ID, chars: text.length });
    return reply(200, { audio_base64, mime_type: 'audio/mpeg' });
  } catch (e) {
    console.error('[ckf-tts]', e);
    return reply(500, { error: e.message || 'TTS failed' });
  }
});
