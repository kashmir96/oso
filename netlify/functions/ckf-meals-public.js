/**
 * ckf-meals-public.js — public endpoint for the trainer share page.
 *
 * Auth: the share_token in the URL/body acts as the credential. We verify it
 * exists, isn't revoked, and isn't expired, then look up the owning user_id.
 *
 * Actions:
 *   info      — { share_token } → { label, owner_email, expired }
 *   list      — { share_token } → recent meals (read-only)
 *   upload    — { share_token, image_base64, mime_type, notes, meal_type, meal_date }
 *               → uploads to Storage, runs AI estimate, writes a meal row
 *               source = 'share', share_id linked back so Curtis sees what
 *               the trainer logged.
 *
 * Strict scope: this function ONLY accepts image uploads + reads the meal
 * list. It does NOT expose the diary, goals, conversations, or anything else.
 */
const { sbSelect, sbInsert } = require('./_lib/ckf-sb.js');
const { uploadObject } = require('./_lib/ckf-storage.js');
const { estimateMealFromImage } = require('./_lib/ckf-meals-ai.js');

const BUCKET = 'ckf-meals';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
function reply(statusCode, data) { return { statusCode, headers: HEADERS, body: JSON.stringify(data) }; }

function nzToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date()); }

async function resolveShare(token) {
  if (!token || typeof token !== 'string') return null;
  const rows = await sbSelect(
    'ckf_meals_shares',
    `share_token=eq.${encodeURIComponent(token)}&revoked=eq.false&select=id,user_id,label,expires_at&limit=1`
  );
  const s = rows?.[0];
  if (!s) return null;
  if (s.expires_at && new Date(s.expires_at) < new Date()) return null;
  return s;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST only' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action, share_token } = body;

  const share = await resolveShare(share_token);
  if (!share) return reply(401, { error: 'Invalid or expired share link' });

  if (action === 'info') {
    return reply(200, { label: share.label || 'Meals', expires_at: share.expires_at || null });
  }

  if (action === 'list') {
    const limit = Math.min(Number(body.limit) || 30, 100);
    const rows = await sbSelect(
      'ckf_meals',
      `user_id=eq.${share.user_id}&order=meal_date.desc,created_at.desc&limit=${limit}&select=id,meal_date,meal_type,image_url,notes,ai_label,ai_calories,ai_protein_g,ai_carbs_g,ai_fat_g,ai_ingredients,ai_confidence,manual_label,manual_calories,manual_protein_g,manual_carbs_g,manual_fat_g,manual_ingredients,source,created_at`
    );
    return reply(200, { meals: rows });
  }

  if (action === 'upload') {
    const { image_base64, mime_type, notes, meal_type, meal_date } = body;
    if (!image_base64) return reply(400, { error: 'image_base64 required' });
    const buf = Buffer.from(image_base64, 'base64');
    if (buf.length === 0) return reply(400, { error: 'Empty image' });
    if (buf.length > 5 * 1024 * 1024) return reply(413, { error: 'Image too large (5MB max)' });

    const ext = (mime_type || '').includes('png') ? 'png' : (mime_type || '').includes('webp') ? 'webp' : 'jpg';
    const path = `${share.user_id}/share-${share.id.slice(0, 8)}-${Date.now()}.${ext}`;
    const { public_url } = await uploadObject({ bucket: BUCKET, path, buffer: buf, contentType: mime_type || 'image/jpeg' });

    let ai = null;
    try {
      ai = await estimateMealFromImage({ imageBase64: image_base64, mimeType: mime_type, hint: notes });
    } catch (e) { console.error('[ckf-meals-public] AI failed', e.message); }

    const row = await sbInsert('ckf_meals', {
      user_id: share.user_id,
      meal_date: meal_date || nzToday(),
      meal_type: meal_type || null,
      image_url: public_url,
      storage_path: path,
      notes: notes || null,
      ai_label: ai?.label || null,
      ai_calories: ai?.calories ?? null,
      ai_protein_g: ai?.protein_g ?? null,
      ai_carbs_g: ai?.carbs_g ?? null,
      ai_fat_g: ai?.fat_g ?? null,
      ai_ingredients: ai?.ingredients || [],
      ai_confidence: ai?.confidence || null,
      ai_raw: ai?.raw || null,
      source: 'share',
      share_id: share.id,
    });

    return reply(200, { meal: row });
  }

  return reply(400, { error: 'Unknown action' });
};
