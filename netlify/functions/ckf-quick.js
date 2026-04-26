/**
 * ckf-quick.js — single-shot Q&A endpoint for iOS Shortcuts / Siri.
 *
 * Auth: same X-CKF-Token header as the rest of the app.
 *
 * Body: { text: "..." }   OR  POST text/plain with the question as the body.
 *
 * Behaviour: opens today's personal conversation if needed, sends the message
 * through the same chat pipeline as the web UI, returns just the reply text
 * so a Shortcut can pipe it straight to "Speak Text".
 *
 * Response: { text }   (also CORS-open + plain-text-friendly Accept handling)
 */
const { sbSelect, sbInsert } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');
const { runChat } = require('./ckf-chat.js');

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

exports.handler = withGate(async (event, { user }) => {
  let text = '';
  const ct = (event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase();
  if (ct.includes('application/json')) {
    try {
      const body = JSON.parse(event.body || '{}');
      text = body.text || body.q || '';
    } catch { return reply(400, { error: 'Invalid JSON' }); }
  } else {
    text = (event.body || '').toString();
  }
  text = (text || '').trim();
  if (!text) return reply(400, { error: 'text required' });

  const conv = await getOrCreateTodayConversation(user.id);
  const result = await runChat({ userId: user.id, conversation: conv, userMessageText: text });
  return reply(200, { text: result.text || '', conversation_id: conv.id });
});
