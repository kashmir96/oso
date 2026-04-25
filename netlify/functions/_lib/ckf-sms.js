// CKF SMS sender. The recipient is hard-coded — this is intentional, not
// configurable via env. The sender REFUSES any other number as a defensive guard,
// because the surrounding repo has functions that fan out to multiple numbers.
const ALLOWED_NUMBER = '+64272415215';

class SmsError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function ensureEnv() {
  const missing = [];
  if (!process.env.TWILIO_SID) missing.push('TWILIO_SID');
  if (!process.env.TWILIO_API) missing.push('TWILIO_API');
  if (!process.env.TWILIO_FROM_NUMBER) missing.push('TWILIO_FROM_NUMBER');
  if (missing.length) throw new SmsError(`Missing Twilio env vars: ${missing.join(', ')}`, 'env');
}

async function sendCkfSms(to, body) {
  if (to !== ALLOWED_NUMBER) {
    throw new SmsError(`CKF SMS refused: recipient ${to} is not the allowed number`, 'recipient');
  }
  if (!body || !body.trim()) throw new SmsError('Empty SMS body', 'body');
  ensureEnv();

  const SID = process.env.TWILIO_SID;
  const TOKEN = process.env.TWILIO_API;
  const FROM = process.env.TWILIO_FROM_NUMBER;

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: FROM, To: to, Body: body }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new SmsError(`Twilio responded ${res.status}: ${text}`, 'twilio');
  }
  return res.json();
}

module.exports = { ALLOWED_NUMBER, SmsError, sendCkfSms };
