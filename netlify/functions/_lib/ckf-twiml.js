// Tiny TwiML response builder. Twilio webhooks expect Content-Type: text/xml
// (or application/xml). All <Say> text is XML-escaped.

const VOICE = process.env.TWILIO_VOICE || 'Polly.Brian-Neural';
const ALLOWED_CALLER = '+64272415215'; // Curtis's number, hard-locked
const APP_URL = (process.env.APP_URL || 'https://oso.nz').replace(/\/$/, '');

function escapeXml(s) {
  return String(s == null ? '' : s).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

function xmlReply(twiml) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body: twiml,
  };
}

// Parse Twilio's application/x-www-form-urlencoded body into a plain object.
function parseFormBody(body) {
  if (!body) return {};
  const out = {};
  const pairs = body.split('&');
  for (const p of pairs) {
    const [k, v] = p.split('=');
    if (!k) continue;
    out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent((v || '').replace(/\+/g, ' '));
  }
  return out;
}

function isAllowedCaller(from) {
  return from === ALLOWED_CALLER;
}

// Build a <Gather> turn that listens for speech and posts to actionPath when done.
function gather({ actionPath, prompt, hangupOnSilence = true, timeoutSec = 6 }) {
  const action = `${APP_URL}${actionPath}`;
  const promptXml = prompt
    ? `<Say voice="${VOICE}">${escapeXml(prompt)}</Say>`
    : '';
  const noInput = hangupOnSilence
    ? `<Say voice="${VOICE}">Talk to you later.</Say><Hangup/>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${escapeXml(action)}" method="POST" speechTimeout="auto" timeout="${timeoutSec}" language="en-NZ">
    ${promptXml}
  </Gather>
  ${noInput}
</Response>`;
}

// Speak a reply, then re-gather. Used for the turn-by-turn loop.
function sayThenGather({ actionPath, sayText, gatherPrompt }) {
  const action = `${APP_URL}${actionPath}`;
  const say = sayText ? `<Say voice="${VOICE}">${escapeXml(sayText)}</Say>` : '';
  const prompt = gatherPrompt ? `<Say voice="${VOICE}">${escapeXml(gatherPrompt)}</Say>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${say}
  <Gather input="speech" action="${escapeXml(action)}" method="POST" speechTimeout="auto" timeout="6" language="en-NZ">
    ${prompt}
  </Gather>
  <Say voice="${VOICE}">Goodnight.</Say>
  <Hangup/>
</Response>`;
}

function reject(reasonText) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${VOICE}">${escapeXml(reasonText || 'This number is private.')}</Say>
  <Hangup/>
</Response>`;
}

function hangup(text) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${text ? `<Say voice="${VOICE}">${escapeXml(text)}</Say>` : ''}
  <Hangup/>
</Response>`;
}

module.exports = { xmlReply, parseFormBody, isAllowedCaller, gather, sayThenGather, reject, hangup, VOICE, ALLOWED_CALLER };
