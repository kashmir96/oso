/**
 * ckf-weekly-cron.js — scheduled.
 *
 * Sundays at 17:00 NZ (cron 05:00 UTC, with NZDT/NZST tolerance).
 * Generates the weekly summary using the same flow as the on-demand
 * /ckf-weekly action so it's ready when Curtis opens the app on Sunday
 * evening.
 */
const { sbSelect, sbInsert, sbUpdate } = require('./_lib/ckf-sb.js');
const { ALLOWED_EMAIL } = require('./_lib/ckf-guard.js');
const { summariseWeek } = require('./_lib/ckf-ai.js');

function nzNow() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date()).reduce((a, p) => { if (p.type !== 'literal') a[p.type] = p.value; return a; }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,    // 'Sun' .. 'Sat' in en-CA short
    hour: Number(parts.hour),
  };
}

function startOfNzWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const dow = d.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

exports.handler = async () => {
  try {
    const { date, weekday, hour } = nzNow();
    // Run only on Sunday at 17:00 NZ. Cron fires twice (NZST + NZDT tolerance);
    // the hour gate makes the actual generate idempotent.
    if (weekday !== 'Sun' || hour !== 17) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: `weekday=${weekday} hour=${hour}` }) };
    }
    const users = await sbSelect('ckf_users', `email=eq.${encodeURIComponent(ALLOWED_EMAIL)}&select=id&limit=1`);
    if (!users?.[0]) return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'user not bootstrapped' }) };
    const userId = users[0].id;

    const weekStart = startOfNzWeek(date);
    const weekEnd = addDays(weekStart, 6);

    // Idempotency: if a row already exists for this week_start, refresh it
    // (overwrite with the fresh AI pass).
    const entries = await sbSelect(
      'diary_entries',
      `user_id=eq.${userId}&date=gte.${weekStart}&date=lte.${weekEnd}&order=date.asc&select=*`
    );
    const taskLogs = await sbSelect(
      'daily_task_logs',
      `user_id=eq.${userId}&date=gte.${weekStart}&date=lte.${weekEnd}&select=*`
    );
    const goalLogs = await sbSelect(
      'goal_logs',
      `user_id=eq.${userId}&created_at=gte.${weekStart}T00:00:00Z&created_at=lte.${weekEnd}T23:59:59Z&select=*`
    );

    const ai = await summariseWeek({ weekStart, weekEnd, entries, taskLogs, goalLogs });

    const payload = {
      user_id: userId,
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
      `user_id=eq.${userId}&week_start=eq.${weekStart}&select=id&limit=1`
    );
    if (existing?.[0]) {
      await sbUpdate('weekly_summaries', `id=eq.${existing[0].id}`, payload);
    } else {
      await sbInsert('weekly_summaries', payload);
    }

    return { statusCode: 200, body: JSON.stringify({ generated: true, week_start: weekStart }) };
  } catch (e) {
    console.error('[ckf-weekly-cron]', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
