/**
 * ckf-diary.js — diary CRUD + AI summary on save.
 * Actions: get, save, list, recent, get_yesterday_tasks, mark_yesterday_task.
 *
 * `save` is the canonical entry point used after the user submits the form.
 * It (a) upserts the row, (b) calls the AI for a summary + recommendations,
 * (c) writes ai_summary + ai_actions, and (d) creates routine_suggestions rows
 * for each AI-proposed habit (status: pending — Curtis must approve).
 */
const { sbSelect, sbInsert, sbUpdate } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');
const { summariseDiary } = require('./_lib/ckf-ai.js');

const DIARY_FIELDS = [
  'personal_good','personal_bad','wasted_time','time_saving_opportunities',
  'eighty_twenty','simplify_tomorrow','social_reflection','personal_lessons',
  'physical_reflection','mental_reflection','spiritual_reflection','growth_opportunities',
  'tomorrow_personal_tasks',
  'business_wins','business_losses','business_activity','business_lessons',
  'tomorrow_business_tasks','marketing_objectives','delegation_notes','bottlenecks',
  'change_tomorrow',
];

function pickFields(src) {
  const out = {};
  for (const k of DIARY_FIELDS) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

async function getEntry(userId, date) {
  const rows = await sbSelect(
    'diary_entries',
    `user_id=eq.${userId}&date=eq.${date}&select=*&limit=1`
  );
  return rows?.[0] || null;
}

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  if (action === 'get') {
    const { date } = body;
    if (!date) return reply(400, { error: 'date required' });
    const entry = await getEntry(user.id, date);
    return reply(200, { entry });
  }

  if (action === 'list') {
    const limit = Math.min(Number(body.limit) || 60, 365);
    const rows = await sbSelect(
      'diary_entries',
      `user_id=eq.${user.id}&order=date.desc&limit=${limit}&select=id,date,eighty_twenty,personal_bad,bottlenecks,ai_summary`
    );
    return reply(200, { entries: rows });
  }

  if (action === 'recent') {
    const limit = Math.min(Number(body.limit) || 5, 30);
    const rows = await sbSelect(
      'diary_entries',
      `user_id=eq.${user.id}&order=date.desc&limit=${limit}&select=*`
    );
    return reply(200, { entries: rows });
  }

  if (action === 'get_yesterday_tasks') {
    // Find the most recent entry strictly before today and return its tomorrow_personal_tasks
    // and tomorrow_business_tasks for status check-in.
    const { today } = body;
    if (!today) return reply(400, { error: 'today required (YYYY-MM-DD)' });
    const rows = await sbSelect(
      'diary_entries',
      `user_id=eq.${user.id}&date=lt.${today}&order=date.desc&limit=1&select=id,date,tomorrow_personal_tasks,tomorrow_business_tasks`
    );
    return reply(200, { yesterday: rows?.[0] || null });
  }

  if (action === 'mark_yesterday_task') {
    // Mark a single task in either personal or business list as done/skipped.
    const { entry_id, list, index, done } = body;
    if (!entry_id || !list || index == null || done == null) return reply(400, { error: 'missing fields' });
    if (!['tomorrow_personal_tasks', 'tomorrow_business_tasks'].includes(list)) return reply(400, { error: 'bad list' });
    const rows = await sbSelect('diary_entries', `id=eq.${entry_id}&user_id=eq.${user.id}&select=*&limit=1`);
    const entry = rows?.[0];
    if (!entry) return reply(404, { error: 'entry not found' });
    const arr = Array.isArray(entry[list]) ? [...entry[list]] : [];
    if (!arr[index]) return reply(400, { error: 'task index out of range' });
    arr[index] = { ...arr[index], done: !!done };
    await sbUpdate('diary_entries', `id=eq.${entry_id}&user_id=eq.${user.id}`, { [list]: arr });
    return reply(200, { success: true });
  }

  if (action === 'save') {
    const { date } = body;
    if (!date) return reply(400, { error: 'date required' });
    const patch = pickFields(body);

    // Upsert
    let entry = await getEntry(user.id, date);
    if (entry) {
      const updated = await sbUpdate('diary_entries', `id=eq.${entry.id}&user_id=eq.${user.id}`, patch);
      entry = updated?.[0] || entry;
    } else {
      entry = await sbInsert('diary_entries', { user_id: user.id, date, ...patch });
    }

    // AI summary — best effort. If it fails, the entry still persists.
    let aiResult = null;
    try {
      const recent = await sbSelect(
        'diary_entries',
        `user_id=eq.${user.id}&date=lt.${date}&order=date.desc&limit=5&select=date,eighty_twenty,personal_bad,bottlenecks,growth_opportunities,physical_reflection,mental_reflection`
      );
      aiResult = await summariseDiary({ entry, recentEntries: recent });

      await sbUpdate('diary_entries', `id=eq.${entry.id}&user_id=eq.${user.id}`, {
        ai_summary: aiResult.summary || null,
        ai_actions: aiResult.actions || [],
      });
      entry.ai_summary = aiResult.summary || null;
      entry.ai_actions = aiResult.actions || [];

      // Persist proposed habit changes as pending suggestions for approval
      const suggestions = Array.isArray(aiResult.routine_suggestions) ? aiResult.routine_suggestions : [];
      for (const s of suggestions) {
        if (!s?.suggestion) continue;
        await sbInsert('routine_suggestions', {
          user_id: user.id,
          source_type: 'diary',
          source_id: entry.id,
          suggestion: s.suggestion,
          reason: s.reason || null,
        });
      }
    } catch (e) {
      console.error('[ckf-diary] AI summary failed:', e.message);
    }

    return reply(200, { entry, ai: aiResult });
  }

  return reply(400, { error: 'Unknown action' });
});
