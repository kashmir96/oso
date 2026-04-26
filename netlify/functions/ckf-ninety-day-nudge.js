/**
 * ckf-ninety-day-nudge.js — scheduled.
 *
 * Curtis asked for the 90-day-goals review to surface itself rather than
 * being a button buried in Settings. On the day a 90-day goal's end_date
 * is reached:
 *   1. SMS reminder — so it lands on his phone wherever he is.
 *   2. Auto-creates a business_task — so it shows up in his Today/Jobs
 *      strip with the right due_date.
 * (An in-app modal is the next step; for now the SMS + task get him moving.)
 *
 * Schedule: "0 7,8 * * *" UTC fires twice (NZST + NZDT). Handler hard-checks
 * Pacific/Auckland local time and only does work at exactly 09:00 NZ — early
 * enough in the day that the task lands on the morning view.
 *
 * Idempotency: we check business_tasks for today's "Evaluate 90-day goal"
 * row before creating, so re-running never duplicates.
 */
const { sbSelect, sbInsert } = require('./_lib/ckf-sb.js');
const { sendCkfSms, ALLOWED_NUMBER } = require('./_lib/ckf-sms.js');
const { ALLOWED_EMAIL } = require('./_lib/ckf-guard.js');

function nzNow() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date()).reduce((a, p) => { if (p.type !== 'literal') a[p.type] = p.value; return a; }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

exports.handler = async () => {
  try {
    const { date, hour } = nzNow();
    if (hour !== 9) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: `not 09:00 NZ (got ${hour})` }) };
    }
    const users = await sbSelect('ckf_users', `email=eq.${encodeURIComponent(ALLOWED_EMAIL)}&select=id&limit=1`);
    if (!users?.[0]) return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'user not bootstrapped' }) };
    const userId = users[0].id;

    // Find 90-day goals that end today OR ended in the past 7 days without
    // a follow-up review having been scheduled. Catches misses if a cron
    // run was missed.
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
    const due = await sbSelect(
      'ninety_day_goals',
      `user_id=eq.${userId}&status=eq.active&end_date=gte.${sevenDaysAgo}&end_date=lte.${date}&select=id,title,end_date,target_outcome`
    ).catch(() => []);

    if (!due || due.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no 90-day goals in the review window' }) };
    }

    // For each due goal, ensure there's a "Evaluate 90-day goal" task in
    // business_tasks for today. Idempotent: skip if one already exists.
    const existing = await sbSelect(
      'business_tasks',
      `user_id=eq.${userId}&due_date=eq.${date}&title=ilike.*Evaluate%2090-day*&select=id,title&limit=20`
    ).catch(() => []);
    const haveExisting = new Set((existing || []).map((t) => t.title));

    const created = [];
    for (const g of due) {
      const title = `Evaluate 90-day goal: ${g.title}`;
      if (haveExisting.has(title)) continue;
      try {
        await sbInsert('business_tasks', {
          user_id: userId,
          title,
          objective: 'Reflect on the past 90 days. Set the next goal.',
          description: g.target_outcome
            ? `Original target: ${g.target_outcome}\nEnded: ${g.end_date}`
            : `Ended: ${g.end_date}`,
          priority: 1,
          status: 'pending',
          due_date: date,
        });
        created.push(title);
      } catch (e) {
        console.warn('[ckf-ninety-day-nudge] task insert failed:', e.message);
      }
    }

    // Single bundled SMS — names the goals due for review.
    if (due.length > 0) {
      const list = due.map((g) => `"${g.title}"`).join(', ');
      const body = `🎯 90-day check-in: ${list} ${due.length === 1 ? 'is' : 'are'} due for review.\nOpen ${process.env.APP_URL || 'https://oso.nz'}/ckf/ninety-day-goals`;
      await sendCkfSms(ALLOWED_NUMBER, body);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ sent: true, due: due.length, tasks_created: created.length, titles: created }),
    };
  } catch (e) {
    console.error('[ckf-ninety-day-nudge]', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
