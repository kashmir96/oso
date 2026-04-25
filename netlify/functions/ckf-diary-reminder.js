/**
 * ckf-diary-reminder.js — scheduled.
 *
 * Cron in netlify.toml fires twice (08:00 + 09:00 UTC) to cover NZST and NZDT.
 * The handler computes the local Pacific/Auckland hour and only sends at exactly 21:00.
 * If a diary entry already exists for today's NZ date for cfairweather1996@gmail.com,
 * no SMS is sent.
 *
 * SMS body: hard-coded; recipient hard-coded inside _lib/ckf-sms.js.
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
  const parts = fmt.formatToParts(new Date()).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value; return acc;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

exports.handler = async () => {
  try {
    const { date, hour } = nzNow();
    if (hour !== 21) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: `not 21:00 NZ (got ${hour})` }) };
    }

    const users = await sbSelect(
      'ckf_users',
      `email=eq.${encodeURIComponent(ALLOWED_EMAIL)}&select=id&limit=1`
    );
    if (!users?.[0]) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'user not bootstrapped yet' }) };
    }
    const userId = users[0].id;

    const existing = await sbSelect(
      'diary_entries',
      `user_id=eq.${userId}&date=eq.${date}&select=id&limit=1`
    );
    if (existing?.[0]) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'entry already exists for today' }) };
    }

    const url = `${process.env.APP_URL || 'https://oso.nz'}/ckf/chat`;
    const body = `Diary time, Curtis. Tonight: ${url}`;
    await sendCkfSms(ALLOWED_NUMBER, body);

    return { statusCode: 200, body: JSON.stringify({ sent: true, to: ALLOWED_NUMBER, date }) };
  } catch (e) {
    console.error('[ckf-diary-reminder]', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
