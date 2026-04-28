/**
 * mktg-assets.js — AI-generated asset pipeline (images now, video + captions
 * later). Saves into the public mktg-assets bucket and persists a row in
 * mktg_generated_assets so the Creative ResultCard + Assistant queue can
 * surface the asset.
 *
 * Phase 1 actions:
 *   generate_image { prompt, creative_id?, n?, size?, seed_asset_id? }
 *     -> { assets: [{ asset_id, public_url, ... }], cost_usd }
 *   list { creative_id?, kind?, limit? } -> { assets: [...] }
 *   delete { asset_id } -> { success: true }
 *
 * Phase 2 (placeholder) -- video via Gemini Veo + captions via ElevenLabs
 * STT will land in this same file.
 *
 * Provider selection:
 *   Image generation defaults to OpenAI gpt-image-1. Curtis must add
 *   OPENAI_API_KEY in Netlify env vars before this works. If a seed image
 *   is passed (seed_asset_id), uses gpt-image-1 with image edit endpoint
 *   for image-to-image variation -- the foundation for AI b-roll from
 *   existing product photos.
 */
const crypto = require('node:crypto');
const { sbSelect, sbInsert, sbUpdate } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');
const { logUsage } = require('./_lib/ckf-usage.js');

const BUCKET = 'mktg-assets';
const OPENAI_IMAGE_MODEL = 'gpt-image-1';
// Cost estimates (per image, standard quality). gpt-image-1 list price ~$0.04
// for 1024x1024 standard. Use as best-effort telemetry; not authoritative.
const OPENAI_IMAGE_COSTS = {
  '1024x1024': 0.04,
  '1024x1536': 0.06,
  '1536x1024': 0.06,
  '1024x1792': 0.06,
  '1792x1024': 0.06,
};

// Veo (Gemini) video model. Veo 2 is in preview. Long-running.
// Per-second list price varies; ~$0.50/sec for Veo 2 standard at time of
// writing. Update when official pricing stabilises.
const GEMINI_VIDEO_MODEL = 'veo-2.0-generate-001';
const GEMINI_VIDEO_COST_PER_SEC = 0.50;

function publicUrlFor(storagePath) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

async function uploadToBucket({ userId, kind, buf, mimeType, ext }) {
  const path = `${userId}/${kind}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const url = `${process.env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      apikey: process.env.SUPABASE_SERVICE_KEY,
      'Content-Type': mimeType,
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
    await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        apikey: process.env.SUPABASE_SERVICE_KEY,
      },
    });
  } catch (_) { /* best-effort */ }
}

// Generate one or more images via OpenAI. Returns array of buffers + meta.
async function generateOpenAIImage({ prompt, n = 1, size = '1024x1024', seedAssetUrl }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  const headers = {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  };
  // Cap n at 4 to keep latency bounded; gpt-image-1 supports up to 10 but
  // 4 is the sweet spot before the function risks the 26s timeout.
  const safeN = Math.max(1, Math.min(4, parseInt(n, 10) || 1));
  let endpoint, body;
  if (seedAssetUrl) {
    // Image edit / variation path. Pull the seed bytes, send via FormData.
    const seedRes = await fetch(seedAssetUrl);
    if (!seedRes.ok) throw new Error(`Failed to fetch seed image: ${seedRes.status}`);
    const seedBuf = Buffer.from(await seedRes.arrayBuffer());
    const form = new FormData();
    form.append('model', OPENAI_IMAGE_MODEL);
    form.append('prompt', prompt);
    form.append('n', String(safeN));
    form.append('size', size);
    form.append('image', new Blob([seedBuf], { type: 'image/png' }), 'seed.png');
    endpoint = 'https://api.openai.com/v1/images/edits';
    const elRes = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!elRes.ok) throw new Error(`OpenAI image edit ${elRes.status}: ${(await elRes.text()).slice(0, 300)}`);
    const json = await elRes.json();
    return decodeOpenAIImageResponse(json, size);
  }
  endpoint = 'https://api.openai.com/v1/images/generations';
  body = { model: OPENAI_IMAGE_MODEL, prompt, n: safeN, size };
  const elRes = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!elRes.ok) throw new Error(`OpenAI image generation ${elRes.status}: ${(await elRes.text()).slice(0, 300)}`);
  const json = await elRes.json();
  return decodeOpenAIImageResponse(json, size);
}

function decodeOpenAIImageResponse(json, size) {
  const items = (json.data || []).map((d) => {
    if (d.b64_json) return { buf: Buffer.from(d.b64_json, 'base64'), mime: 'image/png' };
    if (d.url) return { url: d.url, mime: 'image/png' };
    return null;
  }).filter(Boolean);
  return { items, size };
}

// ─── Gemini Veo: long-running video generation ─────────────────────────────
// Submit returns an operation name; we poll separately + download bytes
// when ready. Whole flow: submit -> stash row at status='pending' with
// provider_operation_id -> cron (or client) polls -> on done, download the
// MP4 -> upload to mktg-assets bucket -> stamp row ready.
async function submitVeoJob({ prompt, durationSec = 5, aspectRatio = '16:9', seedImageUrl }) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
  const body = {
    instances: [{ prompt }],
    parameters: { aspectRatio, sampleCount: 1, durationSeconds: durationSec },
  };
  if (seedImageUrl) {
    // Image-to-video: pass the seed as a base64-encoded image alongside the
    // prompt. Veo accepts this in the instance object as `image: { bytesBase64Encoded, mimeType }`.
    const seedRes = await fetch(seedImageUrl);
    if (!seedRes.ok) throw new Error(`Failed to fetch seed image: ${seedRes.status}`);
    const seedBuf = Buffer.from(await seedRes.arrayBuffer());
    body.instances[0].image = {
      bytesBase64Encoded: seedBuf.toString('base64'),
      mimeType: 'image/png',
    };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VIDEO_MODEL}:predictLongRunning?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Veo submit ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const json = await res.json();
  if (!json.name) throw new Error('Veo submit returned no operation name');
  return { operationId: json.name };
}

// Poll one operation. Returns { status, videoUrl?, error? }.
async function pollVeoOperation(operationId) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
  const url = `https://generativelanguage.googleapis.com/v1beta/${operationId}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    return { status: 'failed', error: `Veo poll ${res.status}: ${text.slice(0, 300)}` };
  }
  const json = await res.json();
  if (!json.done) return { status: 'pending' };
  if (json.error) return { status: 'failed', error: json.error?.message || JSON.stringify(json.error).slice(0, 300) };
  // Response shape varies; both observed paths handled.
  const samples = json.response?.generatedSamples || json.response?.predictions || [];
  const first = samples[0];
  const videoUrl = first?.video?.uri || first?.videoUri || first?.uri;
  if (!videoUrl) return { status: 'failed', error: 'Veo done but no video uri in response' };
  return { status: 'ready', videoUrl };
}

// ─── ElevenLabs Speech-to-Text → SRT/VTT captions ──────────────────────────
// Takes a creative's voiceover MP3, sends to ElevenLabs STT (scribe_v1),
// gets back word-level timestamps, formats as SRT or VTT, uploads to the
// mktg-assets bucket. Used for Phase 3 captions.
const ELEVENLABS_STT_MODEL = 'scribe_v1';
// Cost: ~$0.40 per hour of audio at scribe_v1 list. Stamped on each row.
const ELEVENLABS_STT_COST_PER_SEC = 0.40 / 3600;

async function transcribeWithElevenLabs(audioUrl) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not configured');
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`Failed to fetch audio: ${audioRes.status}`);
  const audioBuf = Buffer.from(await audioRes.arrayBuffer());
  const form = new FormData();
  form.append('model_id', ELEVENLABS_STT_MODEL);
  form.append('file', new Blob([audioBuf], { type: 'audio/mpeg' }), 'voiceover.mp3');
  form.append('timestamps_granularity', 'word');
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    body: form,
  });
  if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}

// Pack words into SRT cues. Splits on punctuation + ~5s windows so the
// captions don't pile up in one block. Returns { srt, vtt, durationSec }.
function buildCaptionsFromWords(sttJson) {
  const words = Array.isArray(sttJson?.words) ? sttJson.words : [];
  if (words.length === 0) {
    return { srt: '1\n00:00:00,000 --> 00:00:01,000\n(no speech detected)\n', vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n(no speech detected)\n', durationSec: 0 };
  }
  // Group words into cues: break on terminal punctuation or every ~5 seconds.
  const cues = [];
  let cur = { start: words[0].start, end: words[0].end, text: '' };
  for (const w of words) {
    const tok = w.text || '';
    if (!cur.text) cur.start = w.start;
    cur.text += (cur.text ? ' ' : '') + tok.trim();
    cur.end = w.end;
    const isTerminal = /[.!?]$/.test(tok.trim());
    const isLong     = (cur.end - cur.start) >= 5;
    if (isTerminal || isLong) {
      if (cur.text.trim()) cues.push({ ...cur, text: cur.text.trim() });
      cur = { start: w.end, end: w.end, text: '' };
    }
  }
  if (cur.text.trim()) cues.push({ ...cur, text: cur.text.trim() });

  function fmtSrt(t) {
    if (typeof t !== 'number') t = 0;
    const ms = Math.floor((t % 1) * 1000);
    const s  = Math.floor(t) % 60;
    const m  = Math.floor(t / 60) % 60;
    const h  = Math.floor(t / 3600);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
  }
  function fmtVtt(t) { return fmtSrt(t).replace(',', '.'); }

  const srt = cues.map((c, i) => `${i + 1}\n${fmtSrt(c.start)} --> ${fmtSrt(c.end)}\n${c.text}\n`).join('\n');
  const vtt = `WEBVTT\n\n${cues.map((c) => `${fmtVtt(c.start)} --> ${fmtVtt(c.end)}\n${c.text}\n`).join('\n')}`;
  const durationSec = cues[cues.length - 1]?.end || 0;
  return { srt, vtt, durationSec };
}

// Download a Veo video URL (signed) and upload to our bucket. Returns the
// new storage_path + bytes count.
async function downloadAndStoreVeoVideo({ userId, videoUrl }) {
  // Veo signed URLs require the API key for download.
  const sep = videoUrl.includes('?') ? '&' : '?';
  const downloadUrl = `${videoUrl}${sep}key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Veo video download ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const storage_path = await uploadToBucket({
    userId, kind: 'video', buf, mimeType: 'video/mp4', ext: 'mp4',
  });
  return { storage_path, bytes: buf.length };
}

exports.handler = withGate(async (event, { user }) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  try {
    if (action === 'generate_image') {
      if (!body.prompt) return reply(400, { error: 'prompt required' });

      // If a seed asset is passed, fetch its public URL to use as image-to-image base.
      let seedAssetUrl = null;
      if (body.seed_asset_id) {
        const rows = await sbSelect(
          'mktg_generated_assets',
          `asset_id=eq.${encodeURIComponent(body.seed_asset_id)}&select=storage_path,user_id&limit=1`
        );
        const seed = rows?.[0];
        if (!seed) return reply(404, { error: 'seed asset not found' });
        if (seed.user_id && seed.user_id !== user.id) return reply(403, { error: 'seed belongs to another user' });
        seedAssetUrl = publicUrlFor(seed.storage_path);
      }

      const size = body.size || '1024x1024';
      const t0 = Date.now();
      let result;
      try {
        result = await generateOpenAIImage({
          prompt: body.prompt, n: body.n, size, seedAssetUrl,
        });
      } catch (e) { return reply(500, { error: e.message || 'image generation failed' }); }

      // For each returned item, upload + persist a row.
      const persisted = [];
      const costPerImage = OPENAI_IMAGE_COSTS[size] || 0.04;
      for (const item of result.items) {
        let buf;
        if (item.buf) buf = item.buf;
        else if (item.url) {
          const r = await fetch(item.url);
          if (!r.ok) continue;
          buf = Buffer.from(await r.arrayBuffer());
        } else continue;
        const storage_path = await uploadToBucket({
          userId: user.id, kind: 'image', buf, mimeType: 'image/png', ext: 'png',
        });
        const row = await sbInsert('mktg_generated_assets', {
          user_id: user.id,
          creative_id: body.creative_id || null,
          kind: 'image',
          provider: 'openai',
          model: OPENAI_IMAGE_MODEL,
          prompt: body.prompt,
          seed_asset_id: body.seed_asset_id || null,
          storage_path,
          mime_type: 'image/png',
          size_bytes: buf.length,
          width: parseInt(size.split('x')[0], 10) || null,
          height: parseInt(size.split('x')[1], 10) || null,
          cost_usd: costPerImage,
          status: 'ready',
          ready_at: new Date().toISOString(),
        });
        const rowOne = Array.isArray(row) ? row[0] : row;
        persisted.push({
          asset_id: rowOne?.asset_id,
          public_url: publicUrlFor(storage_path),
          width: parseInt(size.split('x')[0], 10),
          height: parseInt(size.split('x')[1], 10),
          cost_usd: costPerImage,
        });
      }

      logUsage({
        user_id: user.id, provider: 'openai', action: 'image_gen',
        model: OPENAI_IMAGE_MODEL,
        chars: (body.prompt || '').length,
      });

      return reply(200, {
        ok: true, assets: persisted,
        cost_usd: persisted.length * costPerImage,
        latency_ms: Date.now() - t0,
      });
    }

    // ── Video: submit, check, poll-many ─────────────────────────────────
    if (action === 'generate_video') {
      if (!body.prompt) return reply(400, { error: 'prompt required' });
      const durationSec = Math.max(2, Math.min(8, parseInt(body.duration_sec, 10) || 5));
      let seedAssetUrl = null;
      if (body.seed_asset_id) {
        const rows = await sbSelect(
          'mktg_generated_assets',
          `asset_id=eq.${encodeURIComponent(body.seed_asset_id)}&select=storage_path,user_id&limit=1`
        );
        const seed = rows?.[0];
        if (!seed) return reply(404, { error: 'seed asset not found' });
        if (seed.user_id && seed.user_id !== user.id) return reply(403, { error: 'seed belongs to another user' });
        seedAssetUrl = publicUrlFor(seed.storage_path);
      }
      let submission;
      try {
        submission = await submitVeoJob({
          prompt: body.prompt,
          durationSec,
          aspectRatio: body.aspect_ratio || '16:9',
          seedImageUrl: seedAssetUrl,
        });
      } catch (e) { return reply(500, { error: e.message || 'Veo submit failed' }); }
      const row = await sbInsert('mktg_generated_assets', {
        user_id: user.id,
        creative_id: body.creative_id || null,
        kind: 'video',
        provider: 'gemini',
        model: GEMINI_VIDEO_MODEL,
        prompt: body.prompt,
        seed_asset_id: body.seed_asset_id || null,
        provider_operation_id: submission.operationId,
        storage_path: '__pending__',  // sentinel; replaced when ready
        mime_type: 'video/mp4',
        duration_sec: durationSec,
        cost_usd: durationSec * GEMINI_VIDEO_COST_PER_SEC,
        status: 'pending',
      });
      const r1 = Array.isArray(row) ? row[0] : row;
      return reply(200, {
        ok: true,
        asset_id: r1?.asset_id,
        operation_id: submission.operationId,
        eta_seconds: 30 + durationSec * 5,  // best-effort estimate
        cost_usd: durationSec * GEMINI_VIDEO_COST_PER_SEC,
      });
    }

    // Check (and finalise if ready) a single video job. Used by the chat
    // client polling. Idempotent: safe to call after the asset is already
    // ready; just returns the current state.
    if (action === 'check_video') {
      if (!body.asset_id) return reply(400, { error: 'asset_id required' });
      const rows = await sbSelect(
        'mktg_generated_assets',
        `asset_id=eq.${encodeURIComponent(body.asset_id)}&user_id=eq.${user.id}&select=*&limit=1`
      );
      const a = rows?.[0];
      if (!a) return reply(404, { error: 'asset not found' });
      if (a.status === 'ready') {
        return reply(200, { status: 'ready', public_url: publicUrlFor(a.storage_path), asset: a });
      }
      if (a.status !== 'pending' || !a.provider_operation_id) {
        return reply(200, { status: a.status, error: a.error || null, asset: a });
      }
      let pollResult;
      try { pollResult = await pollVeoOperation(a.provider_operation_id); }
      catch (e) { return reply(500, { error: e.message || 'poll failed' }); }
      if (pollResult.status === 'pending') return reply(200, { status: 'pending' });
      if (pollResult.status === 'failed') {
        await sbUpdate('mktg_generated_assets', `asset_id=eq.${encodeURIComponent(body.asset_id)}`, {
          status: 'failed', error: pollResult.error || 'unknown error',
        });
        return reply(200, { status: 'failed', error: pollResult.error });
      }
      // status === 'ready' -- download + upload + finalise.
      try {
        const { storage_path, bytes } = await downloadAndStoreVeoVideo({
          userId: user.id, videoUrl: pollResult.videoUrl,
        });
        await sbUpdate('mktg_generated_assets', `asset_id=eq.${encodeURIComponent(body.asset_id)}`, {
          storage_path, size_bytes: bytes, status: 'ready', ready_at: new Date().toISOString(),
        });
        return reply(200, { status: 'ready', public_url: publicUrlFor(storage_path) });
      } catch (e) {
        await sbUpdate('mktg_generated_assets', `asset_id=eq.${encodeURIComponent(body.asset_id)}`, {
          status: 'failed', error: e.message || 'download failed',
        });
        return reply(500, { error: e.message || 'download failed' });
      }
    }

    // ── Captions: ElevenLabs STT on the creative's voiceover MP3 ─────────
    // Produces both SRT and VTT files in one call, persists each as its
    // own asset row so the editor can pick whichever format their tool
    // accepts. Curtis hits this from the chat ("generate captions") or
    // from the button on the Creative ResultCard's voiceover panel.
    if (action === 'generate_captions') {
      if (!body.creative_id) return reply(400, { error: 'creative_id required' });
      const rows = await sbSelect(
        'mktg_creatives',
        `creative_id=eq.${encodeURIComponent(body.creative_id)}&select=user_id,voiceover_storage_path&limit=1`
      );
      const c = rows?.[0];
      if (!c) return reply(404, { error: 'creative not found' });
      if (c.user_id && c.user_id !== user.id) return reply(403, { error: 'creative belongs to another user' });
      if (!c.voiceover_storage_path) {
        return reply(400, { error: 'creative has no voiceover -- generate one first' });
      }
      const audioUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/mktg-vo/${c.voiceover_storage_path}`;
      let stt;
      try { stt = await transcribeWithElevenLabs(audioUrl); }
      catch (e) { return reply(500, { error: e.message || 'STT failed' }); }
      const { srt, vtt, durationSec } = buildCaptionsFromWords(stt);

      const persisted = [];
      for (const fmt of ['srt','vtt']) {
        const text = fmt === 'srt' ? srt : vtt;
        const storage_path = await uploadToBucket({
          userId: user.id, kind: 'caption', buf: Buffer.from(text, 'utf8'),
          mimeType: fmt === 'srt' ? 'application/x-subrip' : 'text/vtt',
          ext: fmt,
        });
        const row = await sbInsert('mktg_generated_assets', {
          user_id: user.id,
          creative_id: body.creative_id,
          kind: fmt === 'srt' ? 'caption_srt' : 'caption_vtt',
          provider: 'elevenlabs',
          model: ELEVENLABS_STT_MODEL,
          prompt: null,
          seed_asset_id: null,
          storage_path,
          mime_type: fmt === 'srt' ? 'application/x-subrip' : 'text/vtt',
          size_bytes: Buffer.byteLength(text, 'utf8'),
          duration_sec: durationSec,
          cost_usd: durationSec * ELEVENLABS_STT_COST_PER_SEC,
          status: 'ready',
          ready_at: new Date().toISOString(),
        });
        const r1 = Array.isArray(row) ? row[0] : row;
        persisted.push({
          asset_id: r1?.asset_id, format: fmt,
          public_url: publicUrlFor(storage_path),
          duration_sec: durationSec,
        });
      }
      logUsage({
        user_id: user.id, provider: 'elevenlabs', action: 'stt',
        model: ELEVENLABS_STT_MODEL, chars: Math.round(durationSec) || 0,
      });
      return reply(200, {
        ok: true, captions: persisted,
        cost_usd: durationSec * ELEVENLABS_STT_COST_PER_SEC * 2,  // 2 outputs but same transcription
        latency_ms: null,
      });
    }

    // ── B-roll auto-gen: one image per broll_shot in the creative's script ─
    // The wrap_script stage produces a broll_shots array on
    // creative.components.script.broll_shots. This action turns each entry
    // into an AI-generated still by running them in parallel through
    // OpenAI gpt-image-1. Brand-prefixes the prompts so generations stay
    // on PrimalPantry visual register. Caps at 6 to fit in the timeout.
    if (action === 'generate_broll_for_creative') {
      if (!body.creative_id) return reply(400, { error: 'creative_id required' });
      const rows = await sbSelect(
        'mktg_creatives',
        `creative_id=eq.${encodeURIComponent(body.creative_id)}&select=user_id,components,brief&limit=1`
      );
      const c = rows?.[0];
      if (!c) return reply(404, { error: 'creative not found' });
      if (c.user_id && c.user_id !== user.id) return reply(403, { error: 'creative belongs to another user' });

      // Pull broll_shots from the script. Allow override via body.shots.
      const shots = Array.isArray(body.shots) && body.shots.length
        ? body.shots
        : (c.components?.script?.broll_shots || c.components?.script?.shot_list || []);
      if (!Array.isArray(shots) || shots.length === 0) {
        return reply(400, { error: 'no broll_shots on this creative -- run the script wrap stage first or pass shots[]' });
      }
      const cap = Math.min(parseInt(body.cap, 10) || 6, 6);
      const limited = shots.slice(0, cap);
      const size = body.size || '1024x1536';   // 9:16 default for vertical b-roll
      // Brand-prefix every prompt so the generations stay on register.
      const brandPrefix = body.brand_prefix || 'PrimalPantry NZ tallow skincare brand visual style: warm, plain-spoken, kiwi-coded. ';
      // Optional seed (existing product photo) for image-to-image variations.
      let seedUrl = null;
      if (body.seed_asset_id) {
        const seedRows = await sbSelect(
          'mktg_generated_assets',
          `asset_id=eq.${encodeURIComponent(body.seed_asset_id)}&select=storage_path,user_id&limit=1`
        );
        if (seedRows?.[0]) seedUrl = publicUrlFor(seedRows[0].storage_path);
      }

      // Run them in parallel. Each call should complete in 5-10s; 6 in
      // parallel finishes inside the 26s timeout.
      const t0 = Date.now();
      const tasks = limited.map((shot) => (async () => {
        try {
          const prompt = `${brandPrefix}${shot}`;
          const result = await generateOpenAIImage({ prompt, n: 1, size, seedAssetUrl: seedUrl });
          const item = result.items[0];
          if (!item) return null;
          let buf;
          if (item.buf) buf = item.buf;
          else if (item.url) {
            const r = await fetch(item.url);
            if (!r.ok) return null;
            buf = Buffer.from(await r.arrayBuffer());
          } else return null;
          const storage_path = await uploadToBucket({
            userId: user.id, kind: 'image', buf, mimeType: 'image/png', ext: 'png',
          });
          const row = await sbInsert('mktg_generated_assets', {
            user_id: user.id,
            creative_id: body.creative_id,
            kind: 'image',
            provider: 'openai',
            model: OPENAI_IMAGE_MODEL,
            prompt,
            seed_asset_id: body.seed_asset_id || null,
            storage_path,
            mime_type: 'image/png',
            size_bytes: buf.length,
            width: parseInt(size.split('x')[0], 10) || null,
            height: parseInt(size.split('x')[1], 10) || null,
            cost_usd: OPENAI_IMAGE_COSTS[size] || 0.06,
            status: 'ready',
            ready_at: new Date().toISOString(),
          });
          const r1 = Array.isArray(row) ? row[0] : row;
          return { asset_id: r1?.asset_id, public_url: publicUrlFor(storage_path), prompt };
        } catch (e) {
          console.error('[broll]', shot, e?.message || e);
          return { error: e?.message || String(e), prompt: shot };
        }
      })());
      const results = await Promise.all(tasks);
      const ok    = results.filter((r) => r && !r.error);
      const fails = results.filter((r) => r && r.error);
      logUsage({
        user_id: user.id, provider: 'openai', action: 'broll_batch',
        model: OPENAI_IMAGE_MODEL, chars: limited.join(' ').length,
      });
      return reply(200, {
        ok: true,
        generated: ok.length, failed: fails.length, requested: limited.length,
        assets: ok,
        failures: fails,
        cost_usd: ok.length * (OPENAI_IMAGE_COSTS[size] || 0.06),
        latency_ms: Date.now() - t0,
      });
    }

    // ── Upload finished asset (production team uploads the rendered video) ─
    // After the assistant produces the actual creative file, they upload it
    // here so it lives alongside the AI-generated drafts in mktg-assets.
    // Curtis can then re-use it / link it / share it.
    if (action === 'upload_finished_asset') {
      if (!body.creative_id) return reply(400, { error: 'creative_id required' });
      if (!body.data_base64)  return reply(400, { error: 'data_base64 required' });
      const mime = body.mime_type || 'video/mp4';
      const ext  = (body.filename && body.filename.split('.').pop()) || (mime.split('/')[1] || 'bin');
      const kind = mime.startsWith('video/') ? 'video' : (mime.startsWith('image/') ? 'image' : 'video');

      // Authorise: ensure creative belongs to this user (or is global).
      const rows = await sbSelect(
        'mktg_creatives',
        `creative_id=eq.${encodeURIComponent(body.creative_id)}&select=user_id&limit=1`
      );
      const cv = rows?.[0];
      if (!cv) return reply(404, { error: 'creative not found' });
      if (cv.user_id && cv.user_id !== user.id) return reply(403, { error: 'creative belongs to another user' });

      const buf = Buffer.from(body.data_base64, 'base64');
      if (buf.length === 0) return reply(400, { error: 'empty file payload' });
      // Cap at ~50 MB so the function's body-size limit doesn't bite. Larger
      // files should go through a signed-upload-URL flow (Phase 4.1).
      if (buf.length > 50 * 1024 * 1024) {
        return reply(400, { error: 'file too large (>50MB) -- need signed-upload-URL flow for big videos' });
      }
      const storage_path = await uploadToBucket({
        userId: user.id, kind, buf, mimeType: mime, ext,
      });
      const row = await sbInsert('mktg_generated_assets', {
        user_id: user.id,
        creative_id: body.creative_id,
        kind,
        provider: 'upload',
        model: 'finished_asset',
        prompt: body.notes || null,
        storage_path,
        mime_type: mime,
        size_bytes: buf.length,
        cost_usd: 0,
        status: 'ready',
        ready_at: new Date().toISOString(),
      });
      const r1 = Array.isArray(row) ? row[0] : row;
      return reply(200, {
        ok: true,
        asset_id: r1?.asset_id,
        public_url: publicUrlFor(storage_path),
        kind, bytes: buf.length,
      });
    }

    if (action === 'list') {
      const filters = [`user_id=eq.${user.id}`, 'select=*', 'order=created_at.desc'];
      if (body.creative_id) filters.push(`creative_id=eq.${encodeURIComponent(body.creative_id)}`);
      if (body.kind)        filters.push(`kind=eq.${encodeURIComponent(body.kind)}`);
      filters.push(`limit=${Math.min(parseInt(body.limit, 10) || 50, 200)}`);
      const rows = await sbSelect('mktg_generated_assets', filters.join('&'));
      const enriched = rows.map((r) => ({ ...r, public_url: publicUrlFor(r.storage_path) }));
      return reply(200, { assets: enriched });
    }

    if (action === 'delete') {
      if (!body.asset_id) return reply(400, { error: 'asset_id required' });
      const rows = await sbSelect(
        'mktg_generated_assets',
        `asset_id=eq.${encodeURIComponent(body.asset_id)}&select=user_id,storage_path&limit=1`
      );
      const a = rows?.[0];
      if (!a) return reply(404, { error: 'asset not found' });
      if (a.user_id && a.user_id !== user.id) return reply(403, { error: 'asset belongs to another user' });
      await deleteFromStorage(a.storage_path);
      await sbUpdate('mktg_generated_assets', `asset_id=eq.${encodeURIComponent(body.asset_id)}`, {
        status: 'deleted',
      });
      return reply(200, { success: true });
    }

    return reply(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('[mktg-assets]', e);
    return reply(500, { error: e.message || 'Server error' });
  }
});

// Internal exports for other server modules (chat tool dispatcher uses these
// to bypass the auth gate when called from within an authenticated context).
exports.publicUrlFor = publicUrlFor;
exports.generateOpenAIImage = generateOpenAIImage;
exports.uploadToBucket = uploadToBucket;
