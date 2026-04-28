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
