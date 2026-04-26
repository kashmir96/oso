/**
 * ckf-search.js — gated. Searches across the whole CKF dataset.
 *
 * Returns grouped hits per source: diary, memory, swipefile, goals, errands,
 * meals, business_tasks, messages.
 *
 * One action: { action: 'search', q, limit_per }
 */
const { sbSelect } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

function ilikeAny(q) {
  return encodeURIComponent(`*${q.replace(/[%*]/g, '')}*`);
}

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const q = (body.q || '').trim();
  if (!q) return reply(200, { q: '', results: {} });
  const limit = Math.min(Number(body.limit_per) || 8, 25);
  const safe = ilikeAny(q);

  const userFilter = `user_id=eq.${user.id}`;

  const [diary, memory, swipe, goals, errands, meals, biz, messages] = await Promise.all([
    sbSelect('diary_entries',
      `${userFilter}&or=(personal_good.ilike.${safe},personal_bad.ilike.${safe},eighty_twenty.ilike.${safe},simplify_tomorrow.ilike.${safe},social_reflection.ilike.${safe},personal_lessons.ilike.${safe},physical_reflection.ilike.${safe},mental_reflection.ilike.${safe},spiritual_reflection.ilike.${safe},growth_opportunities.ilike.${safe},business_wins.ilike.${safe},business_losses.ilike.${safe},business_lessons.ilike.${safe},bottlenecks.ilike.${safe},change_tomorrow.ilike.${safe},unfiltered.ilike.${safe},ai_summary.ilike.${safe})&order=date.desc&limit=${limit}&select=id,date,ai_summary,personal_bad,bottlenecks,unfiltered`
    ).catch(() => []),
    sbSelect('ckf_memory_facts',
      `${userFilter}&archived=eq.false&fact.ilike.${safe}&order=importance.desc,created_at.desc&limit=${limit}&select=id,fact,topic,importance,created_at`
    ).catch(() => []),
    sbSelect('ckf_swipefile_items',
      `${userFilter}&archived=eq.false&or=(title.ilike.${safe},source_text.ilike.${safe},why_it_matters.ilike.${safe},author.ilike.${safe})&order=importance.desc,created_at.desc&limit=${limit}&select=id,kind,title,why_it_matters,author,source_url,category,created_at`
    ).catch(() => []),
    sbSelect('goals',
      `${userFilter}&name.ilike.${safe}&order=created_at.desc&limit=${limit}&select=id,name,category,goal_type,current_value,target_value,unit,status`
    ).catch(() => []),
    sbSelect('ckf_errands',
      `${userFilter}&or=(title.ilike.${safe},description.ilike.${safe})&order=status.asc,created_at.desc&limit=${limit}&select=id,title,description,status,due_date,remind_at,category`
    ).catch(() => []),
    sbSelect('ckf_meals',
      `${userFilter}&or=(ai_label.ilike.${safe},manual_label.ilike.${safe},notes.ilike.${safe})&order=meal_date.desc&limit=${limit}&select=id,meal_date,ai_label,manual_label,ai_calories,manual_calories,image_url,notes`
    ).catch(() => []),
    sbSelect('business_tasks',
      `${userFilter}&or=(title.ilike.${safe},description.ilike.${safe},objective.ilike.${safe})&order=created_at.desc&limit=${limit}&select=id,title,description,objective,status,due_date,priority`
    ).catch(() => []),
    sbSelect('ckf_messages',
      `${userFilter}&content_text.ilike.${safe}&order=created_at.desc&limit=${limit}&select=id,conversation_id,role,content_text,created_at`
    ).catch(() => []),
  ]);

  return reply(200, {
    q,
    results: {
      diary: diary || [],
      memory: memory || [],
      swipefile: swipe || [],
      goals: goals || [],
      errands: errands || [],
      meals: meals || [],
      business_tasks: biz || [],
      messages: messages || [],
    },
  });
});
