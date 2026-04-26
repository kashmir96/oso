/**
 * ckf-phone-incoming.js — Twilio Voice webhook for inbound calls.
 *
 * Wire as the "A CALL COMES IN" webhook on your Twilio number:
 *   https://oso.nz/.netlify/functions/ckf-phone-incoming  (HTTP POST)
 *
 * Caller-ID gate: only +64272415215 (Curtis) gets through. Anyone else hears
 * a polite refusal and the call hangs up.
 *
 * On accept: short greeting → <Gather speech> → posts speech to ckf-phone-respond
 * which runs the chat loop and re-gathers.
 */
const { xmlReply, parseFormBody, isAllowedCaller, sayThenGather, reject } = require('./_lib/ckf-twiml.js');

exports.handler = async (event) => {
  const body = parseFormBody(event.body || '');
  const from = (body.From || '').trim();
  if (!isAllowedCaller(from)) {
    return xmlReply(reject("This line is private. Goodbye."));
  }
  // Greet + open the loop. The greeting is generic — the AI takes over on the
  // first round of speech.
  return xmlReply(sayThenGather({
    actionPath: '/.netlify/functions/ckf-phone-respond',
    sayText: 'Hey Curtis. What\'s on your mind?',
    gatherPrompt: '',
  }));
};
