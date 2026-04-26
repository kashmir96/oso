/**
 * mktg-upload.js — capture pasted text, links, screenshot descriptions, AND
 * image binaries directly from the marketing chat composer.
 *
 * Image binaries land in a private Supabase Storage bucket ("mktg-uploads").
 * The chat function later fetches them as base64 for Claude vision.
 *
 * Actions:
 *   create        { kind: 'text'|'link'|'screenshot'|'image', text_body?, url?,
 *                   data_base64?, mime_type?, caption?, tags?,
 *                   target_table?, target_id?, conversation_id? }
 *     -> { upload, signed_url? }      (signed_url present for kind=image)
 *
 *   list          { conversation_id?, target_table?, target_id?, limit? }
 *     -> { uploads }
 *
 *   update        { id, caption?, tags?, target_table?, target_id? }
 *     -> { upload }
 *
 *   delete        { id }
 *     -> { success }
 *
 *   signed_url    { id }              (mints a 5-min signed URL for display)
 *     -> { url, expires_in }
 */
const crypto = require('crypto');
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

const VALID_TARGET_TABLES = new Set([
  'mktg_ads','mktg_concepts','mktg_production_scripts','mktg_campaigns',
]);
const VALID_KINDS = new Set(['text','link','screenshot','image']);

const STORAGE_BUCKET = 'mktg-uploads';
const SIGNED_URL_TTL = 300; // 5 minutes
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB cap — Claude vision limit is ~5 MB

const VALID_IMAGE_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
]);

function extForMime(mime) {
  switch (mime) {
    case 'image/png':  return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    case 'image/gif':  return 'gif';
    default:           return 'bin';
  }
}

async function uploadToStorage({ userId, dataBase64, mimeType }) {
  const buf = Buffer.from(dataBase64, 'base64');
  if (buf.length === 0) throw new Error('Empty image payload');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error(`Image too large (${buf.length} bytes; max ${MAX_IMAGE_BYTES})`);
  const ext = extForMime(mimeType);
  const path = `${userId}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const url = `${process.env.SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': mimeType,
      'x-upsert': 'true',
    },
    body: buf,
  });
  if (!res.ok) throw new Error(`Storage upload failed: ${res.status} ${await res.text()}`);
  return { storage_path: path, bytes: buf.length };
}

async function mintSignedUrl(storagePath) {
  const url = `${process.env.SUPABASE_URL}/storage/v1/object/sign/${STORAGE_BUCKET}/${storagePath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: SIGNED_URL_TTL }),
  });
  if (!res.ok) throw new Error(`Sign URL failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  // Supabase returns a relative path "/object/sign/<bucket>/<path>?token=…"
  const signed = json.signedURL || json.signedUrl;
  if (!signed) throw new Error('No signedURL in response');
  return `${process.env.SUPABASE_URL}/storage/v1${signed}`;
}

exports.handler = withGate(async (event, { user }) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  try {
    if (action === 'create') {
      const {
        kind, text_body, url, data_base64, mime_type,
        caption, tags, target_table, target_id, conversation_id,
      } = body;
      if (!VALID_KINDS.has(kind)) return reply(400, { error: 'kind must be text|link|screenshot|image' });
      if (kind === 'text' && !text_body) return reply(400, { error: 'text_body required for kind=text' });
      if (kind === 'link' && !url) return reply(400, { error: 'url required for kind=link' });
      if (kind === 'screenshot' && !caption && !text_body) {
        return reply(400, { error: 'screenshot requires caption (description) or text_body (OCR/transcribed text)' });
      }
      if (kind === 'image') {
        if (!data_base64) return reply(400, { error: 'data_base64 required for kind=image' });
        if (!VALID_IMAGE_MIME.has(mime_type)) return reply(400, { error: `mime_type must be one of ${[...VALID_IMAGE_MIME].join(', ')}` });
      }
      if (target_table && !VALID_TARGET_TABLES.has(target_table)) {
        return reply(400, { error: 'invalid target_table' });
      }

      let storage_path = null;
      if (kind === 'image') {
        const stored = await uploadToStorage({
          userId: user.id, dataBase64: data_base64, mimeType: mime_type,
        });
        storage_path = stored.storage_path;
      }

      const upload = await sbInsert('mktg_uploads', {
        user_id:         user.id,
        kind,
        text_body:       text_body || null,
        url:             url || null,
        storage_path,
        mime_type:       kind === 'image' ? mime_type : null,
        caption:         caption || null,
        tags:            Array.isArray(tags) ? tags : [],
        target_table:    target_table || null,
        target_id:       target_id || null,
        conversation_id: conversation_id || null,
      });

      let signed_url = null;
      if (kind === 'image' && storage_path) {
        try { signed_url = await mintSignedUrl(storage_path); } catch (e) { /* surface as null; client can re-fetch */ }
      }
      return reply(200, { upload, signed_url });
    }

    if (action === 'signed_url') {
      if (!body.id) return reply(400, { error: 'id required' });
      const rows = await sbSelect(
        'mktg_uploads',
        `id=eq.${encodeURIComponent(body.id)}&user_id=eq.${user.id}&select=storage_path&limit=1`
      );
      const row = rows?.[0];
      if (!row) return reply(404, { error: 'upload not found' });
      if (!row.storage_path) return reply(400, { error: 'upload has no storage_path (not an image?)' });
      const url = await mintSignedUrl(row.storage_path);
      return reply(200, { url, expires_in: SIGNED_URL_TTL });
    }

    if (action === 'list') {
      const filters = [`user_id=eq.${user.id}`, 'select=*'];
      if (body.conversation_id) filters.push(`conversation_id=eq.${encodeURIComponent(body.conversation_id)}`);
      if (body.target_table)    filters.push(`target_table=eq.${encodeURIComponent(body.target_table)}`);
      if (body.target_id)       filters.push(`target_id=eq.${encodeURIComponent(body.target_id)}`);
      const limit = Math.min(body.limit || 50, 200);
      filters.push(`order=created_at.desc&limit=${limit}`);
      return reply(200, { uploads: await sbSelect('mktg_uploads', filters.join('&')) });
    }

    if (action === 'update') {
      if (!body.id) return reply(400, { error: 'id required' });
      const patch = {};
      if (body.caption !== undefined)      patch.caption = body.caption;
      if (Array.isArray(body.tags))        patch.tags = body.tags;
      if (body.target_table !== undefined) {
        if (body.target_table && !VALID_TARGET_TABLES.has(body.target_table)) return reply(400, { error: 'invalid target_table' });
        patch.target_table = body.target_table || null;
      }
      if (body.target_id !== undefined)    patch.target_id = body.target_id || null;
      const updated = await sbUpdate(
        'mktg_uploads',
        `id=eq.${encodeURIComponent(body.id)}&user_id=eq.${user.id}`,
        patch
      );
      return reply(200, { upload: Array.isArray(updated) ? updated[0] : updated });
    }

    if (action === 'delete') {
      if (!body.id) return reply(400, { error: 'id required' });
      // Best-effort: also drop the storage object if there is one. We continue
      // even if the storage delete fails so the row never sticks orphaned.
      const rows = await sbSelect(
        'mktg_uploads',
        `id=eq.${encodeURIComponent(body.id)}&user_id=eq.${user.id}&select=storage_path&limit=1`
      );
      const path = rows?.[0]?.storage_path;
      if (path) {
        try {
          await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` },
          });
        } catch (_) {}
      }
      await sbDelete('mktg_uploads', `id=eq.${encodeURIComponent(body.id)}&user_id=eq.${user.id}`);
      return reply(200, { success: true });
    }

    return reply(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('[mktg-upload]', e);
    return reply(500, { error: e.message || 'Server error' });
  }
});
