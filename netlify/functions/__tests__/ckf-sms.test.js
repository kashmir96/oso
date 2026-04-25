// SMS guard tests — verify recipient lock and env handling.
// Run: node --test netlify/functions/__tests__/ckf-sms.test.js
const test = require('node:test');
const assert = require('node:assert');

const { sendCkfSms, ALLOWED_NUMBER, SmsError } = require('../_lib/ckf-sms.js');

test('refuses any recipient that is not the allowed number', async () => {
  await assert.rejects(
    () => sendCkfSms('+15558675309', 'hi'),
    (e) => e instanceof SmsError && e.code === 'recipient'
  );
});

test('refuses an empty body', async () => {
  await assert.rejects(
    () => sendCkfSms(ALLOWED_NUMBER, ''),
    (e) => e instanceof SmsError && e.code === 'body'
  );
});

test('reports missing env vars before contacting Twilio', async () => {
  const prev = { sid: process.env.TWILIO_SID, api: process.env.TWILIO_API, from: process.env.TWILIO_FROM_NUMBER };
  delete process.env.TWILIO_SID; delete process.env.TWILIO_API; delete process.env.TWILIO_FROM_NUMBER;
  try {
    await assert.rejects(
      () => sendCkfSms(ALLOWED_NUMBER, 'hi'),
      (e) => e instanceof SmsError && e.code === 'env'
    );
  } finally {
    if (prev.sid) process.env.TWILIO_SID = prev.sid;
    if (prev.api) process.env.TWILIO_API = prev.api;
    if (prev.from) process.env.TWILIO_FROM_NUMBER = prev.from;
  }
});

test('hard-coded number is +64272415215', () => {
  assert.strictEqual(ALLOWED_NUMBER, '+64272415215');
});
