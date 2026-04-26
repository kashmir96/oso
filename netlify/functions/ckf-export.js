/**
 * ckf-export.js — full user data dump as JSON.
 *
 * Returns every CKF table for the calling user as a single JSON blob the
 * frontend turns into a downloadable file. Sensitive fields (password hash,
 * salt, OAuth tokens) are stripped — this is a personal-use export, not a
 * full-fidelity DB backup.
 */
const { sbSelect } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

const TABLES = [
  { name: 'goals', select: '*' },
  { name: 'goal_logs', select: '*' },
  { name: 'routine_tasks', select: '*' },
  { name: 'daily_task_logs', select: '*' },
  { name: 'diary_entries', select: '*' },
  { name: 'ckf_memory_facts', select: '*' },
  { name: 'ckf_conversations', select: '*' },
  { name: 'ckf_messages', select: '*' },
  { name: 'ckf_errands', select: '*' },
  { name: 'ckf_meals', select: '*' },
  { name: 'ckf_meals_shares', select: 'id,label,share_token,expires_at,revoked,created_at' },
  { name: 'ckf_swipefile_items', select: '*' },
  { name: 'whoop_metrics', select: '*' },
  { name: 'weekly_summaries', select: '*' },
  { name: 'ninety_day_goals', select: '*' },
  { name: 'monthly_milestones', select: '*' },
  { name: 'weekly_actions', select: '*' },
  { name: 'business_tasks', select: '*' },
  { name: 'routine_suggestions', select: '*' },
  { name: 'ckf_api_usage', select: 'id,provider,action,model,input_tokens,output_tokens,audio_seconds,chars,cost_usd,occurred_at' },
];

exports.handler = withGate(async (event, { user }) => {
  const out = {
    exported_at: new Date().toISOString(),
    user: { id: user.id, email: user.email },
    tables: {},
  };
  for (const t of TABLES) {
    try {
      const rows = await sbSelect(t.name, `user_id=eq.${user.id}&order=created_at.asc.nullslast&limit=10000&select=${t.select}`);
      out.tables[t.name] = rows || [];
    } catch (e) {
      out.tables[t.name] = { error: e.message };
    }
  }
  return reply(200, out);
});
