/**
 * ckf-phone-respond.js — turn-by-turn webhook.
 *
 * Twilio calls this with the user's transcribed speech in `SpeechResult` after
 * each <Gather>. We feed it through the same chat pipeline as the web UI
 * (using today's personal conversation, scoped to Curtis's user_id), then
 * speak the reply and re-gather for the next turn.
 *
 * Caller-ID is re-validated on every turn to be safe.
 *
 * Hard cap: replies are clipped to ~600 chars before <Say> so Twilio's
 * synthesis doesn't drag for 30+ seconds. Curtis can ask "go deeper" if he
 * wants more.
 */
const { sbSelect, sbInsert } = require('./_lib/ckf-sb.js');
const { xmlReply, parseFormBody, isAllowedCaller, sayThenGather, reject, hangup } = require('./_lib/ckf-twiml.js');
const { ALLOWED_EMAIL } = require('./_lib/ckf-guard.js');
const { runChat } = require('./ckf-chat.js');

const REPLY_CHAR_CAP = 600;

function nzToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date()); }

async function getOrCreateTodayConversation(userId) {
  const date = nzToday();
  const rows = await sbSelect(
    'ckf_conversations',
    `user_id=eq.${userId}&scope=eq.personal&nz_date=eq.${date}&order=started_at.desc&limit=1&select=*`
  );
  if (rows?.[0]) return rows[0];
  return await sbInsert('ckf_conversations', {
    user_id: userId, nz_date: date, primary_mode: 'therapist', scope: 'personal',
  });
}

function clipForVoice(text) {
  if (!text) return '';
  let t = text.trim();
  // Strip markdown bullets / headers — Twilio Polly reads them literally.
  t = t.replace(/^[-*•]\s+/gm, '').replace(/^#+\s+/gm, '').replace(/[*_`]/g, '');
  if (t.length <= REPLY_CHAR_CAP) return t;
  // Cut at the last sentence boundary before the cap.
  const slice = t.slice(0, REPLY_CHAR_CAP);
  const lastPeriod = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
  return (lastPeriod > 100 ? slice.slice(0, lastPeriod + 1) : slice) + ' …';
}

exports.handler = async (event) => {
  const body = parseFormBody(event.body || '');
  const from = (body.From || '').trim();
  if (!isAllowedCaller(from)) return xmlReply(reject("This line is private. Goodbye."));

  const speech = (body.SpeechResult || '').trim();
  if (!speech) {
    // No speech — Curtis went quiet or it timed out. End politely.
    return xmlReply(hangup('Talk later.'));
  }

  try {
    const users = await sbSelect('ckf_users', `email=eq.${encodeURIComponent(ALLOWED_EMAIL)}&select=id&limit=1`);
    if (!users?.[0]) return xmlReply(hangup("I'm not set up yet. Try again later."));
    const userId = users[0].id;

    const conversation = await getOrCreateTodayConversation(userId);
    const result = await runChat({
      userId, conversation,
      userMessageText: speech,
    });
    const reply = clipForVoice(result?.text || '...');

    return xmlReply(sayThenGather({
      actionPath: '/.netlify/functions/ckf-phone-respond',
      sayText: reply,
      gatherPrompt: '',
    }));
  } catch (e) {
    console.error('[ckf-phone-respond]', e);
    return xmlReply(hangup("Something went wrong on my end. Try again in a sec."));
  }
};
