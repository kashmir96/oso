/**
 * ckf-meals-public.js — public endpoint for the trainer share page.
 *
 * Auth: the share_token in the URL/body acts as the credential. We verify it
 * exists, isn't revoked, and isn't expired, then look up the owning user_id.
 *
 * Trainer permissions: READ + EDIT existing meals only. Cannot create or
 * delete. The owner uploads via the in-app /meals page or the chat composer;
 * the trainer corrects what the AI got wrong (portion size, label, macros).
 *
 * Actions:
 *   info      — { share_token } → { label, expires_at }
 *   list      — { share_token } → recent meals (read)
 *   update    — { share_token, id, manual_label, manual_calories,
 *                manual_protein_g, manual_carbs_g, manual_fat_g, notes }
 *               Patches manual_* + notes only. Cannot delete, cannot
 *               touch image_url, cannot create.
 *
 * Strict scope: this function ONLY reads + edits a fixed set of meal fields.
 * It never exposes diary, goals, conversations, or anything else. Public
 * access points stop here.
 */
const { sbSelect, sbUpdate } = require('./_lib/ckf-sb.js');

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

  if (action === 'whoop_recent') {
    const days = Math.min(Math.max(Number(body.days) || 14, 1), 60);
    const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
    const rows = await sbSelect(
      'whoop_metrics',
      `user_id=eq.${share.user_id}&date=gte.${since}&order=date.desc&limit=${days}&select=date,recovery_score,hrv_rmssd_ms,resting_heart_rate,strain,sleep_performance,sleep_hours,sleep_efficiency`
    );
    return reply(200, { days, metrics: rows });
  }

  if (action === 'update') {
    const { id } = body;
    if (!id) return reply(400, { error: 'id required' });
    // Verify the meal belongs to the share owner before patching.
    const meal = (await sbSelect(
      'ckf_meals',
      `id=eq.${id}&user_id=eq.${share.user_id}&select=id&limit=1`
    ))?.[0];
    if (!meal) return reply(404, { error: 'meal not found' });

    // Only manual_* fields + notes are editable by the trainer. Everything
    // else (image, AI estimates, source, owner) is locked.
    const allowed = ['manual_label','manual_calories','manual_protein_g','manual_carbs_g','manual_fat_g','manual_ingredients','notes','meal_type'];
    const patch = {};
    for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
    if (Object.keys(patch).length === 0) return reply(400, { error: 'no editable fields supplied' });

    const rows = await sbUpdate('ckf_meals', `id=eq.${meal.id}`, patch);
    return reply(200, { meal: rows?.[0] });
  }

  return reply(400, { error: 'Unknown action' });
};
