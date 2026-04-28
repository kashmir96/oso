/**
 * mktg-products.js — manage PrimalPantry products + their per-slot seed images.
 *
 * Each product has 7 fixed seed-image slots that future AI generators
 * (Gemini / OpenAI / Claude vision) pull from:
 *   front, back, side1, side2, texture_pack, texture_skin, label
 *
 * Image binaries live in the existing private "mktg-uploads" bucket. The
 * mktg_products.seed_images JSONB column maps slot → { path, mime, uploaded_at }.
 *
 * Actions:
 *   list                                            -> { products }
 *   get             { id }                          -> { product, signed_urls }
 *   create          { id, name, ...optional }       -> { product }
 *   update          { id, patch }                   -> { product }
 *   delete          { id }                          -> { success }
 *   upload_seed     { product_id, slot,
 *                     data_base64, mime_type }      -> { product, signed_url }
 *   delete_seed     { product_id, slot }            -> { product }
 *   signed_url_seed { product_id, slot }            -> { url, expires_in }
 */
const crypto = require('crypto');
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

const STORAGE_BUCKET = 'mktg-uploads';
const SIGNED_URL_TTL = 300; // 5 minutes
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const VALID_SLOTS = new Set([
  'front', 'back', 'side1', 'side2', 'texture_pack', 'texture_skin', 'label',
]);

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

async function uploadToStorage({ userId, productId, slot, dataBase64, mimeType }) {
  const buf = Buffer.from(dataBase64, 'base64');
  if (buf.length === 0) throw new Error('Empty image payload');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error(`Image too large (${buf.length} bytes; max ${MAX_IMAGE_BYTES})`);
  const ext = extForMime(mimeType);
  const path = `${userId}/products/${productId}/${slot}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
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

async function deleteFromStorage(storagePath) {
  if (!storagePath) return;
  await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` },
  }).catch(() => {});
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
  const signed = json.signedURL || json.signedUrl;
  if (!signed) throw new Error('No signedURL in response');
  return `${process.env.SUPABASE_URL}/storage/v1${signed}`;
}

async function fetchProduct(id) {
  const rows = await sbSelect(
    'mktg_products',
    `id=eq.${encodeURIComponent(id)}&select=*&limit=1`
  );
  return rows?.[0] || null;
}

async function signAllSlots(seedImages) {
  const out = {};
  if (!seedImages || typeof seedImages !== 'object') return out;
  await Promise.all(Object.entries(seedImages).map(async ([slot, info]) => {
    if (!info?.path) return;
    try { out[slot] = await mintSignedUrl(info.path); } catch { /* leave unset */ }
  }));
  return out;
}

exports.handler = withGate(async (event, { user }) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  try {
    if (action === 'list') {
      const products = await sbSelect('mktg_products', 'select=*&order=name.asc');
      return reply(200, { products });
    }

    if (action === 'get') {
      if (!body.id) return reply(400, { error: 'id required' });
      const product = await fetchProduct(body.id);
      if (!product) return reply(404, { error: 'product not found' });
      const signed_urls = await signAllSlots(product.seed_images);
      return reply(200, { product, signed_urls });
    }

    if (action === 'create') {
      const { id, name } = body;
      if (!id || !name) return reply(400, { error: 'id and name required' });
      const existing = await fetchProduct(id);
      if (existing) return reply(409, { error: 'product id already exists' });
      const row = {
        id, name,
        full_name:      body.full_name || null,
        tagline:        body.tagline || null,
        description:    body.description || null,
        price_from_nzd: body.price_from_nzd || null,
        size:           body.size || null,
        format:         body.format || null,
        url_slug:       body.url_slug || null,
        notes:          body.notes || null,
        status:         body.status || 'active',
        seed_images:    {},
      };
      const product = await sbInsert('mktg_products', row);
      return reply(200, { product });
    }

    if (action === 'update') {
      if (!body.id) return reply(400, { error: 'id required' });
      const patch = body.patch || {};
      // Block direct edits to seed_images via this action — use upload_seed/delete_seed
      delete patch.seed_images;
      delete patch.id;
      patch.updated_at = new Date().toISOString();
      const updated = await sbUpdate(
        'mktg_products',
        `id=eq.${encodeURIComponent(body.id)}`,
        patch
      );
      const product = Array.isArray(updated) ? updated[0] : updated;
      return reply(200, { product });
    }

    if (action === 'delete') {
      if (!body.id) return reply(400, { error: 'id required' });
      const product = await fetchProduct(body.id);
      if (product?.seed_images && typeof product.seed_images === 'object') {
        for (const info of Object.values(product.seed_images)) {
          if (info?.path) await deleteFromStorage(info.path);
        }
      }
      await sbDelete('mktg_products', `id=eq.${encodeURIComponent(body.id)}`);
      return reply(200, { success: true });
    }

    if (action === 'upload_seed') {
      const { product_id, slot, data_base64, mime_type } = body;
      if (!product_id) return reply(400, { error: 'product_id required' });
      if (!VALID_SLOTS.has(slot)) return reply(400, { error: `slot must be one of ${[...VALID_SLOTS].join(', ')}` });
      if (!data_base64) return reply(400, { error: 'data_base64 required' });
      if (!VALID_IMAGE_MIME.has(mime_type)) return reply(400, { error: `mime_type must be one of ${[...VALID_IMAGE_MIME].join(', ')}` });

      const product = await fetchProduct(product_id);
      if (!product) return reply(404, { error: 'product not found' });

      const stored = await uploadToStorage({
        userId: user.id, productId: product_id, slot,
        dataBase64: data_base64, mimeType: mime_type,
      });

      // Replace previous slot upload (best-effort; don't fail the request if storage delete fails).
      const prev = product.seed_images?.[slot];
      if (prev?.path && prev.path !== stored.storage_path) await deleteFromStorage(prev.path);

      const seed_images = {
        ...(product.seed_images || {}),
        [slot]: {
          path: stored.storage_path,
          mime: mime_type,
          uploaded_at: new Date().toISOString(),
        },
      };

      const updated = await sbUpdate(
        'mktg_products',
        `id=eq.${encodeURIComponent(product_id)}`,
        { seed_images, updated_at: new Date().toISOString() }
      );
      const updatedProduct = Array.isArray(updated) ? updated[0] : updated;
      let signed_url = null;
      try { signed_url = await mintSignedUrl(stored.storage_path); } catch { /* client can re-fetch */ }
      return reply(200, { product: updatedProduct, signed_url });
    }

    if (action === 'delete_seed') {
      const { product_id, slot } = body;
      if (!product_id) return reply(400, { error: 'product_id required' });
      if (!VALID_SLOTS.has(slot)) return reply(400, { error: 'invalid slot' });
      const product = await fetchProduct(product_id);
      if (!product) return reply(404, { error: 'product not found' });
      const prev = product.seed_images?.[slot];
      if (prev?.path) await deleteFromStorage(prev.path);
      const seed_images = { ...(product.seed_images || {}) };
      delete seed_images[slot];
      const updated = await sbUpdate(
        'mktg_products',
        `id=eq.${encodeURIComponent(product_id)}`,
        { seed_images, updated_at: new Date().toISOString() }
      );
      return reply(200, { product: Array.isArray(updated) ? updated[0] : updated });
    }

    if (action === 'signed_url_seed') {
      const { product_id, slot } = body;
      if (!product_id) return reply(400, { error: 'product_id required' });
      if (!VALID_SLOTS.has(slot)) return reply(400, { error: 'invalid slot' });
      const product = await fetchProduct(product_id);
      const path = product?.seed_images?.[slot]?.path;
      if (!path) return reply(404, { error: 'no upload in slot' });
      const url = await mintSignedUrl(path);
      return reply(200, { url, expires_in: SIGNED_URL_TTL });
    }

    return reply(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('[mktg-products]', e);
    return reply(500, { error: e.message || 'Server error' });
  }
});
