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

// Pull the spoken-out script out of a mktg_creatives row. The new pipeline
// stores the full script at components.script.full_script for video, and
// the body at components.body for ads. We voice over either -- ads tend to
// be ~80-160 words which is fine read aloud as a dialog/script line.
function scriptFromCreative(creative) {
  const c = creative?.components;
  if (!c || typeof c !== 'object') return null;
  if (c.script?.full_script && typeof c.script.full_script === 'string' && c.script.full_script.trim()) {
    return c.script.full_script.trim();
  }
  if (typeof c.body === 'string' && c.body.trim()) {
    return c.body.trim();
  }
  return null;
}

// Render via ElevenLabs + upload to the public mktg-vo bucket. Shared by
// the draft path and the creative path so the voice + settings + storage
// layout stays identical.
async function renderAndUpload({ userId, ownerId, scriptText, voiceIdOverride }) {
  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }
  const text = scriptText.length > MAX_CHARS ? scriptText.slice(0, MAX_CHARS) : scriptText;
  const voice = voiceIdOverride || process.env.ELEVENLABS_AD_VOICE_ID || DEFAULT_AD_VOICE;
  const elRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: PUNCHY_VOICE_SETTINGS }),
  });
  if (!elRes.ok) {
    const errText = await elRes.text();
    const e = new Error(`ElevenLabs ${elRes.status}: ${errText.slice(0, 300)}`);
    e.statusCode = elRes.status;
    throw e;
  }
  const buf = Buffer.from(await elRes.arrayBuffer());
  // ownerId is reused as the second path segment so drafts and creatives
  // share the same on-disk layout: <userId>/<ownerId>/<ts>-<rnd>.mp3
  const storagePath = await uploadMp3({ userId, draftId: ownerId, buf });
  return { storagePath, voice, bytes: buf.length };
}

// Expose the inner render + upload + URL helpers so other server-side modules
// (like _lib/mktg-pipeline.js, called from chat) can produce voiceovers
// without re-entering through the auth gate.
exports.renderAndUpload = renderAndUpload;
exports.publicUrlFor    = publicUrlFor;
exports.deleteFromStorage = deleteFromStorage;
exports.scriptFromCreative = scriptFromCreative;

exports.handler = withGate(async (event, { user }) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  try {
    if (action === 'generate') {
      if (!body.draft_id) return reply(400, { error: 'draft_id required' });

      const drafts = await sbSelect(
        'mktg_drafts',
        `id=eq.${encodeURIComponent(body.draft_id)}&user_id=eq.${user.id}&select=*&limit=1`
      );
      const draft = drafts?.[0];
      if (!draft) return reply(404, { error: 'draft not found' });

      const script = scriptFromDraft(draft);
      if (!script) return reply(400, { error: 'no vo_script on this draft (need creative.vo_script or primary_text_final)' });

      let result;
      try {
        result = await renderAndUpload({
          userId: user.id, ownerId: draft.id,
          scriptText: script, voiceIdOverride: body.voice_id,
        });
      } catch (e) {
        return reply(e.statusCode || 500, { error: e.message || 'render failed' });
      }

      // Drop the previous MP3 for this draft (regeneration).
      if (draft.voiceover_storage_path) await deleteFromStorage(draft.voiceover_storage_path);

      const label = body.label || draft.voiceover_label || draft.objective || 'Voiceover';
      const updated = await sbUpdate(
        'mktg_drafts',
        `id=eq.${encodeURIComponent(draft.id)}&user_id=eq.${user.id}`,
        {
          voiceover_storage_path: result.storagePath,
          voiceover_voice_id:     result.voice,
          voiceover_label:        label,
          voiceover_generated_at: new Date().toISOString(),
          updated_at:             new Date().toISOString(),
        }
      );

      logUsage({ user_id: user.id, provider: 'elevenlabs', action: 'mktg_vo', model: MODEL_ID, chars: script.length });

      return reply(200, {
        draft: Array.isArray(updated) ? updated[0] : updated,
        public_url: publicUrlFor(result.storagePath),
        voice_id: result.voice,
        bytes: result.bytes,
      });
    }

    // ── Creative-agent path (mktg_creatives row) ─────────────────────────
    // Same voice + settings + bucket as the draft path, just pointed at
    // the new pipeline's table. Curtis hits this from the "Voiceover"
    // step at the end of the Creative pipeline.
    if (action === 'generate_creative') {
      if (!body.creative_id) return reply(400, { error: 'creative_id required' });

      // creatives created by the pipeline have user_id set OR null (global
      // brand assets). Match either to be flexible.
      const rows = await sbSelect(
        'mktg_creatives',
        `creative_id=eq.${encodeURIComponent(body.creative_id)}&select=*&limit=1`
      );
      const creative = rows?.[0];
      if (!creative) return reply(404, { error: 'creative not found' });
      // If the row has a user_id, ensure it matches the caller. Null user_id
      // = global asset, anyone signed-in can generate.
      if (creative.user_id && creative.user_id !== user.id) {
        return reply(403, { error: 'creative belongs to another user' });
      }

      const script = scriptFromCreative(creative);
      if (!script) {
        return reply(400, { error: 'no script on this creative (need components.script.full_script or components.body)' });
      }

      let result;
      try {
        result = await renderAndUpload({
          userId: user.id, ownerId: creative.creative_id,
          scriptText: script, voiceIdOverride: body.voice_id,
        });
      } catch (e) {
        return reply(e.statusCode || 500, { error: e.message || 'render failed' });
      }

      if (creative.voiceover_storage_path) await deleteFromStorage(creative.voiceover_storage_path);

      const label = body.label || creative.voiceover_label || creative.brief?.objective || 'Voiceover';
      const updated = await sbUpdate(
        'mktg_creatives',
        `creative_id=eq.${encodeURIComponent(creative.creative_id)}`,
        {
          voiceover_storage_path: result.storagePath,
          voiceover_voice_id:     result.voice,
          voiceover_label:        label,
          voiceover_generated_at: new Date().toISOString(),
          updated_at:             new Date().toISOString(),
        }
      );

      logUsage({ user_id: user.id, provider: 'elevenlabs', action: 'mktg_vo_creative', model: MODEL_ID, chars: script.length });

      return reply(200, {
        creative: Array.isArray(updated) ? updated[0] : updated,
        public_url: publicUrlFor(result.storagePath),
        voice_id: result.voice,
        bytes: result.bytes,
      });
    }

    if (action === 'delete_creative') {
      if (!body.creative_id) return reply(400, { error: 'creative_id required' });
      const rows = await sbSelect(
        'mktg_creatives',
        `creative_id=eq.${encodeURIComponent(body.creative_id)}&select=user_id,voiceover_storage_path&limit=1`
      );
      const c = rows?.[0];
      if (!c) return reply(404, { error: 'creative not found' });
      if (c.user_id && c.user_id !== user.id) return reply(403, { error: 'creative belongs to another user' });
      if (c.voiceover_storage_path) await deleteFromStorage(c.voiceover_storage_path);
      await sbUpdate(
        'mktg_creatives',
        `creative_id=eq.${encodeURIComponent(body.creative_id)}`,
        {
          voiceover_storage_path: null,
          voiceover_voice_id:     null,
          voiceover_generated_at: null,
          updated_at: new Date().toISOString(),
        }
      );
      return reply(200, { success: true });
    }

    if (action === 'list') {
      // Pull from BOTH tables. Drafts (legacy wizard) + creatives (new pipeline)
      // share the same VO bucket and column names; the UI just gets a
      // `kind` discriminator + the appropriate id field so deletes go to
      // the right table.
      const [drafts, creatives] = await Promise.all([
        sbSelect(
          'mktg_drafts',
          `user_id=eq.${user.id}&voiceover_storage_path=not.is.null&order=voiceover_generated_at.desc&limit=200&select=id,objective,campaign_id,format,status,voiceover_storage_path,voiceover_voice_id,voiceover_label,voiceover_generated_at`
        ),
        sbSelect(
          'mktg_creatives',
          `voiceover_storage_path=not.is.null&order=voiceover_generated_at.desc&limit=200&select=creative_id,brief,creative_type,status,voiceover_storage_path,voiceover_voice_id,voiceover_label,voiceover_generated_at`
        ),
      ]);
      const fromDrafts = drafts.map((r) => ({
        kind:          'draft',
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
      const fromCreatives = creatives.map((r) => ({
        kind:          'creative',
        creative_id:   r.creative_id,
        label:         r.voiceover_label || r.brief?.objective || 'Voiceover',
        public_url:    publicUrlFor(r.voiceover_storage_path),
        voice_id:      r.voiceover_voice_id,
        generated_at:  r.voiceover_generated_at,
        objective:     r.brief?.objective || null,
        creative_type: r.creative_type,
        format:        r.brief?.format || null,
        status:        r.status,
      }));
      const voiceovers = [...fromCreatives, ...fromDrafts]
        .sort((a, b) => new Date(b.generated_at) - new Date(a.generated_at));
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
