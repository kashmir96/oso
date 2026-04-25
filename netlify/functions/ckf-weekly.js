/**
 * ckf-weekly.js — weekly_summaries.
 * Actions: list, get, generate.
 *
 * `generate` pulls the past 7 days of diary entries, task logs, and goal logs
 * and asks the AI for a structured weekly review. Idempotent per (user, week_start).
 */
const { sbSelect, sbInsert, sbUpdate } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');
const { summariseWeek } = require('./_lib/ckf-ai.js');

function nzDate(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' });
  return fmt.format(d); // YYYY-MM-DD
}

function startOfNzWeek(dateStr) {
  // Treat Monday as the start of the week.
  const d = new Date(dateStr + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon, ...
  const offset = dow === 0 ? -6 : 1 - dow;
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() + offset);
  return start.toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  if (action === 'list') {
    const rows = await sbSelect(
      'weekly_summaries',
      `user_id=eq.${user.id}&order=week_start.desc&limit=26&select=*`
    );
    return reply(200, { summaries: rows });
  }

  if (action === 'get') {
    const { week_start } = body;
    if (!week_start) return reply(400, { error: 'week_start required' });
    const rows = await sbSelect(
      'weekly_summaries',
      `user_id=eq.${user.id}&week_start=eq.${week_start}&select=*&limit=1`
    );
    return reply(200, { summary: rows?.[0] || null });
  }

  if (action === 'generate') {
    const today = body.today || nzDate();
    const weekStart = body.week_start || startOfNzWeek(today);
    const weekEnd = addDays(weekStart, 6);

    const entries = await sbSelect(
      'diary_entries',
      `user_id=eq.${user.id}&date=gte.${weekStart}&date=lte.${weekEnd}&order=date.asc&select=*`
    );
    const taskLogs = await sbSelect(
      'daily_task_logs',
      `user_id=eq.${user.id}&date=gte.${weekStart}&date=lte.${weekEnd}&select=*`
    );
    const goalLogs = await sbSelect(
      'goal_logs',
      `user_id=eq.${user.id}&created_at=gte.${weekStart}T00:00:00Z&created_at=lte.${weekEnd}T23:59:59Z&select=*`
    );

    const ai = await summariseWeek({ weekStart, weekEnd, entries, taskLogs, goalLogs });

    const payload = {
      user_id: user.id,
      week_start: weekStart,
      week_end: weekEnd,
      summary: ai.summary || null,
      wins: ai.wins || null,
      losses: ai.losses || null,
      bottlenecks: ai.bottlenecks || null,
      routine_suggestions: ai.routine_suggestions || null,
      goal_progress_summary: ai.goal_progress_summary || {},
      business_summary: ai.business_summary || null,
      personal_summary: ai.personal_summary || null,
    };

    const existing = await sbSelect(
      'weekly_summaries',
      `user_id=eq.${user.id}&week_start=eq.${weekStart}&select=id&limit=1`
    );
    let row;
    if (existing?.[0]) {
      const updated = await sbUpdate('weekly_summaries', `id=eq.${existing[0].id}`, payload);
      row = updated?.[0];
    } else {
      row = await sbInsert('weekly_summaries', payload);
    }

    return reply(200, { summary: row });
  }

  return reply(400, { error: 'Unknown action' });
});
