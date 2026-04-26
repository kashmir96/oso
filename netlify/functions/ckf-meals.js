/**
 * ckf-meals.js — gated CRUD for meals + share-link management.
 *
 * Actions:
 *   list                 — recent meals for the user
 *   get                  — one by id
 *   create               — accepts { image_base64, mime_type, notes, meal_type, meal_date, log_to_goal_id }
 *                          uploads image to Storage, runs the vision AI, stores the row,
 *                          optionally logs the calorie value to a goal_logs row
 *   update               — patch manual_* fields, notes, meal_type, log_to_goal_id
 *   delete               — removes row + Storage object
 *   list_shares          — share tokens for the trainer
 *   create_share         — { label } → returns { share_token, share_url }
 *   revoke_share         — { id }
 */
const crypto = require('crypto');
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');
const { uploadObject, deleteObject } = require('./_lib/ckf-storage.js');
const { estimateMealFromImage } = require('./_lib/ckf-meals-ai.js');

const APP_URL = (process.env.APP_URL || 'https://oso.nz').replace(/\/$/, '');
const BUCKET = 'ckf-meals';

function nzToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date()); }

function randToken(bytes = 16) { return crypto.randomBytes(bytes).toString('hex'); }

async function logCaloriesToGoal({ userId, goalId, calories, mealId, mealDate }) {
  if (!goalId || calories == null) return null;
  const goal = (await sbSelect('goals', `id=eq.${goalId}&user_id=eq.${userId}&select=id,name,timeframe,aggregate&limit=1`))?.[0];
  if (!goal) return null;
  const log = await sbInsert('goal_logs', {
    goal_id: goalId,
    user_id: userId,
    value: calories,
    note: `meal: ${mealId.slice(0, 8)}`,
    for_date: mealDate || nzToday(),
  });
  return log;
}

async function uploadImage({ userId, imageBase64, mimeType }) {
  const buf = Buffer.from(imageBase64, 'base64');
  if (buf.length === 0) throw new Error('Empty image');
  const ext = (mimeType || 'image/jpeg').includes('png') ? 'png'
    : (mimeType || 'image/jpeg').includes('webp') ? 'webp' : 'jpg';
  const path = `${userId}/${randToken(8)}-${Date.now()}.${ext}`;
  const out = await uploadObject({ bucket: BUCKET, path, buffer: buf, contentType: mimeType || 'image/jpeg' });
  return out;
}

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  if (action === 'list') {
    const limit = Math.min(Number(body.limit) || 50, 200);
    const rows = await sbSelect(
      'ckf_meals',
      `user_id=eq.${user.id}&order=meal_date.desc,created_at.desc&limit=${limit}&select=*`
    );
    return reply(200, { meals: rows });
  }

  if (action === 'get') {
    if (!body.id) return reply(400, { error: 'id required' });
    const m = (await sbSelect('ckf_meals', `id=eq.${body.id}&user_id=eq.${user.id}&select=*&limit=1`))?.[0];
    if (!m) return reply(404, { error: 'not found' });
    return reply(200, { meal: m });
  }

  if (action === 'create') {
    const { image_base64, mime_type, notes, meal_type, meal_date, log_to_goal_id } = body;
    if (!image_base64) return reply(400, { error: 'image_base64 required' });
    const mealDate = meal_date || nzToday();

    const { path, public_url } = await uploadImage({ userId: user.id, imageBase64: image_base64, mimeType: mime_type });

    let ai = null;
    try {
      ai = await estimateMealFromImage({ imageBase64: image_base64, mimeType: mime_type, hint: notes });
    } catch (e) {
      console.error('[ckf-meals] AI estimate failed:', e.message);
    }

    const row = await sbInsert('ckf_meals', {
      user_id: user.id,
      meal_date: mealDate,
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
      log_to_goal_id: log_to_goal_id || null,
      source: 'me',
    });

    if (log_to_goal_id && ai?.calories != null) {
      await logCaloriesToGoal({ userId: user.id, goalId: log_to_goal_id, calories: ai.calories, mealId: row.id, mealDate });
    }

    return reply(200, { meal: row });
  }

  if (action === 'update') {
    const { id, ...patch } = body;
    if (!id) return reply(400, { error: 'id required' });
    delete patch.action;
    const allowed = ['meal_type','meal_date','notes','manual_label','manual_calories','manual_protein_g','manual_carbs_g','manual_fat_g','manual_ingredients','log_to_goal_id'];
    const clean = {};
    for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
    const rows = await sbUpdate('ckf_meals', `id=eq.${id}&user_id=eq.${user.id}`, clean);
    return reply(200, { meal: rows?.[0] });
  }

  if (action === 'delete') {
    if (!body.id) return reply(400, { error: 'id required' });
    const m = (await sbSelect('ckf_meals', `id=eq.${body.id}&user_id=eq.${user.id}&select=storage_path&limit=1`))?.[0];
    if (m?.storage_path) {
      try { await deleteObject({ bucket: BUCKET, path: m.storage_path }); } catch (e) { console.error('[ckf-meals] delete obj failed', e.message); }
    }
    await sbDelete('ckf_meals', `id=eq.${body.id}&user_id=eq.${user.id}`);
    return reply(200, { success: true });
  }

  // ── Share links ──
  if (action === 'list_shares') {
    const rows = await sbSelect('ckf_meals_shares', `user_id=eq.${user.id}&order=created_at.desc&select=*`);
    return reply(200, { shares: rows });
  }

  if (action === 'create_share') {
    const token = randToken(16);
    const row = await sbInsert('ckf_meals_shares', {
      user_id: user.id,
      share_token: token,
      label: body.label || 'Trainer',
      expires_at: body.expires_at || null,
    });
    return reply(200, {
      share: row,
      share_url: `${APP_URL}/ckf-meals.html#${token}`,
    });
  }

  if (action === 'revoke_share') {
    if (!body.id) return reply(400, { error: 'id required' });
    await sbUpdate('ckf_meals_shares', `id=eq.${body.id}&user_id=eq.${user.id}`, { revoked: true });
    return reply(200, { success: true });
  }

  return reply(400, { error: 'Unknown action' });
});
