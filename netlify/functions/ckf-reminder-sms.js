/**
 * ckf-reminder-sms.js — scheduled every 5 minutes.
 *
 * Finds open errands where remind_at has passed AND sms_remind = true AND
 * sms_sent_at IS NULL, sends an SMS via the existing CKF SMS helper (which
 * hard-locks the recipient), then marks sms_sent_at.
 *
 * Looks back at most 1 hour to avoid spamming if the cron lapses or a row is
 * created with a remind_at far in the past.
 */
const { sbSelect, sbUpdate } = require('./_lib/ckf-sb.js');
const { sendCkfSms, ALLOWED_NUMBER } = require('./_lib/ckf-sms.js');
const { ALLOWED_EMAIL } = require('./_lib/ckf-guard.js');

const APP_URL = (process.env.APP_URL || 'https://oso.nz').replace(/\/$/, '');
const LOOKBACK_MS = 60 * 60 * 1000; // 1h grace

exports.handler = async () => {
  try {
    const users = await sbSelect('ckf_users', `email=eq.${encodeURIComponent(ALLOWED_EMAIL)}&select=id&limit=1`);
    if (!users?.[0]) return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'user not bootstrapped' }) };
    const userId = users[0].id;

    const now = new Date();
    const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();
    const nowIso = now.toISOString();

    const due = await sbSelect(
      'ckf_errands',
      `user_id=eq.${userId}&status=eq.open&sms_remind=eq.true&sms_sent_at=is.null&remind_at=lte.${encodeURIComponent(nowIso)}&remind_at=gte.${encodeURIComponent(since)}&order=remind_at.asc&select=id,title,description,remind_at`
    );

    if (!due || due.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, count: 0 }) };
    }

    const sent = [];
    for (const e of due) {
      const lines = [
        `⏰ ${e.title}`,
      ];
      if (e.description) lines.push(e.description.slice(0, 200));
      lines.push(`Open in CKF: ${APP_URL}/ckf/errands`);
      try {
        await sendCkfSms(ALLOWED_NUMBER, lines.join('\n'));
        await sbUpdate('ckf_errands', `id=eq.${e.id}`, { sms_sent_at: now.toISOString() });
        sent.push(e.id);
      } catch (err) {
        console.error('[ckf-reminder-sms] send failed for', e.id, err.message);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ sent_count: sent.length, sent }) };
  } catch (e) {
    console.error('[ckf-reminder-sms]', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
