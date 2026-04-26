/**
 * ckf-streak-nudge.js — scheduled.
 *
 * Evening SMS reminder if any active checkbox goal hasn't been ticked today.
 * Fires once per day at 20:00 NZ. Restraint goals are excluded — those
 * auto-tick anyway and the only manual action is logging a fail.
 *
 * Schedule: "0 7,8 * * *" UTC fires twice (NZST + NZDT). The handler hard-
 * checks Pacific/Auckland local hour and only sends at exactly 20:00.
 *
 * Body: "🔥 Streaks at risk tonight: <name> (X days), <name> (Y days)…"
 * One SMS for all at-risk goals — bundled, not spammy.
 */
const { sbSelect } = require('./_lib/ckf-sb.js');
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
    if (hour !== 20) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: `not 20:00 NZ (got ${hour})` }) };
    }
    const users = await sbSelect('ckf_users', `email=eq.${encodeURIComponent(ALLOWED_EMAIL)}&select=id&limit=1`);
    if (!users?.[0]) return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'user not bootstrapped' }) };
    const userId = users[0].id;

    // Active checkbox goals where today isn't yet ticked.
    const goals = await sbSelect(
      'goals',
      `user_id=eq.${userId}&status=eq.active&goal_type=eq.checkbox&select=id,name,current_value,last_completed_at`
    );
    const atRisk = (goals || []).filter((g) => g.last_completed_at !== date);
    if (atRisk.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'all checkbox goals ticked' }) };
    }

    const list = atRisk
      .map((g) => `${g.name}${g.current_value ? ` (${g.current_value} day${g.current_value === 1 ? '' : 's'})` : ''}`)
      .join(', ');
    const body = `🔥 Streaks at risk tonight: ${list}.\nOpen ${process.env.APP_URL || 'https://oso.nz'}/ckf`;
    await sendCkfSms(ALLOWED_NUMBER, body);

    return { statusCode: 200, body: JSON.stringify({ sent: true, count: atRisk.length, names: atRisk.map((g) => g.name) }) };
  } catch (e) {
    console.error('[ckf-streak-nudge]', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
