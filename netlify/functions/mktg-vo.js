/**
 * mktg-vo.js — generate ElevenLabs voiceovers for marketing drafts and store
 * them in a public Supabase Storage bucket so the team can download the MP3
 * directly via the public URL (same model as the trainer-share link).
 *
 * The voice is tuned for "punch" — a young, energetic conversational voice
 * (Liam by default) with lower stability + higher style than the diary's
 * George voice. Override per call with body.voice_id, or globally with the
 * ELEVENLABS_AD_VOICE_ID env var (kept distinct from ELEVENLABS_VOICE_ID
 * so the diary stays calm while ads get punch).
 *
 * Actions:
 *   generate { draft_id, voice_id?, label? }
 *     -> { draft, public_url, voice_id, bytes }
 *
 *   list { }
 *     -> { voiceovers: [{ draft_id, label, public_url, voice_id, generated_at,
 *                         objective, campaign_id, format }] }
 *
 *   delete { draft_id }
 *     -> { success: true }
 */
const crypto = require('crypto');
const { sbSelect, sbUpdate } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');
const { logUsage } = require('./_lib/ckf-usage.js');

const STORAGE_BUCKET = 'mktg-vo';
const MODEL_ID = 'eleven_flash_v2_5';
const MAX_CHARS = 4000;

// Liam — young, energetic, conversational. Distinct from the diary's calm
// George (JBFqnCBsd6RMkjVDRZzb). Override globally with ELEVENLABS_AD_VOICE_ID,
// or per-call with body.voice_id.
const DEFAULT_AD_VOICE = 'TX3LPaxmHKxFdv7VOQHJ';

// Tuned for punch: lower stability (more expressive range), higher style
// (more emotional/dramatic delivery), speaker boost on (clearer attack).
const PUNCHY_VOICE_SETTINGS = {
  stability: 0.4,
  similarity_boost: 0.75,
  style: 0.55,
  use_speaker_boost: true,
};

function publicUrlFor(storagePath) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;
}

async function uploadMp3({ userId, draftId, buf }) {
  // userId/draftId/timestamp.mp3 — userId-prefixed for tidy bucket organisation.
  const path = `${userId}/${draftId}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.mp3`;
  const url = `${process.env.SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'audio/mpeg',
      'x-upsert': 'true',
    },
    body: buf,
  });
  if (!res.ok) throw new Error(`Storage upload failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return path;
}

async function deleteFromStorage(storagePath) {
  if (!storagePath) return;
  try {
    await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` },
    });
  } catch (_) { /* best-effort */ }
}

// Pull the spoken-out script out of the draft. Video drafts produce
// `creative.vo_script` (continuous voiceover). For non-video drafts there's no
// natural VO source — fall back to primary_text_final if present.
function scriptFromDraft(draft) {
  const c = draft?.creative;
  if (c && typeof c === 'object' && typeof c.vo_script === 'string' && c.vo_script.trim()) {
    return c.vo_script.trim();
  }
  if (typeof draft?.primary_text_final === 'string' && draft.primary_text_final.trim()) {
    return draft.primary_text_final.trim();
  }
  return null;
}

exports.handler = withGate(async (event, { user }) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  try {
    if (action === 'generate') {
      if (!process.env.ELEVENLABS_API_KEY) return reply(500, { error: 'ELEVENLABS_API_KEY not configured' });
      if (!body.draft_id) return reply(400, { error: 'draft_id required' });

      const drafts = await sbSelect(
        'mktg_drafts',
        `id=eq.${encodeURIComponent(body.draft_id)}&user_id=eq.${user.id}&select=*&limit=1`
      );
      const draft = drafts?.[0];
      if (!draft) return reply(404, { error: 'draft not found' });

      const script = scriptFromDraft(draft);
      if (!script) return reply(400, { error: 'no vo_script on this draft (need creative.vo_script or primary_text_final)' });
      const text = script.length > MAX_CHARS ? script.slice(0, MAX_CHARS) : script;

      const voice = body.voice_id || process.env.ELEVENLABS_AD_VOICE_ID || DEFAULT_AD_VOICE;

      const elRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
          voice_settings: PUNCHY_VOICE_SETTINGS,
        }),
      });
      if (!elRes.ok) {
        const errText = await elRes.text();
        return reply(elRes.status, { error: `ElevenLabs ${elRes.status}: ${errText.slice(0, 300)}` });
      }
      const buf = Buffer.from(await elRes.arrayBuffer());

      // If a previous VO existed for this draft, delete the old object so the
      // bucket doesn't accumulate dead MP3s on regeneration.
      if (draft.voiceover_storage_path) await deleteFromStorage(draft.voiceover_storage_path);

      const storagePath = await uploadMp3({ userId: user.id, draftId: draft.id, buf });

      const label = body.label || draft.voiceover_label || draft.objective || 'Voiceover';
      const updated = await sbUpdate(
        'mktg_drafts',
        `id=eq.${encodeURIComponent(draft.id)}&user_id=eq.${user.id}`,
        {
          voiceover_storage_path: storagePath,
          voiceover_voice_id:     voice,
          voiceover_label:        label,
          voiceover_generated_at: new Date().toISOString(),
          updated_at:             new Date().toISOString(),
        }
      );

      logUsage({ user_id: user.id, provider: 'elevenlabs', action: 'mktg_vo', model: MODEL_ID, chars: text.length });

      return reply(200, {
        draft: Array.isArray(updated) ? updated[0] : updated,
        public_url: publicUrlFor(storagePath),
        voice_id: voice,
        bytes: buf.length,
      });
    }

    if (action === 'list') {
      const rows = await sbSelect(
        'mktg_drafts',
        `user_id=eq.${user.id}&voiceover_storage_path=not.is.null&order=voiceover_generated_at.desc&limit=200&select=id,objective,campaign_id,format,status,voiceover_storage_path,voiceover_voice_id,voiceover_label,voiceover_generated_at`
      );
      const voiceovers = rows.map((r) => ({
        draft_id:      r.id,
        label:         r.voiceover_label || r.objective || 'Voiceover',
        public_url:    publicUrlFor(r.voiceover_storage_path),
        voice_id:      r.voiceover_voice_id,
        generated_at:  r.voiceover_generated_at,
        objective:     r.objective,
        campaign_id:   r.campaign_id,
        format:        r.format,
        status:        r.status,
      }));
      return reply(200, { voiceovers });
    }

    if (action === 'delete') {
      if (!body.draft_id) return reply(400, { error: 'draft_id required' });
      const drafts = await sbSelect(
        'mktg_drafts',
        `id=eq.${encodeURIComponent(body.draft_id)}&user_id=eq.${user.id}&select=voiceover_storage_path&limit=1`
      );
      const path = drafts?.[0]?.voiceover_storage_path;
      if (path) await deleteFromStorage(path);
      await sbUpdate(
        'mktg_drafts',
        `id=eq.${encodeURIComponent(body.draft_id)}&user_id=eq.${user.id}`,
        {
          voiceover_storage_path: null,
          voiceover_voice_id:     null,
          voiceover_generated_at: null,
          // keep voiceover_label so a re-render uses the same label by default
          updated_at: new Date().toISOString(),
        }
      );
      return reply(200, { success: true });
    }

    return reply(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('[mktg-vo]', e);
    return reply(500, { error: e.message || 'Server error' });
  }
});
