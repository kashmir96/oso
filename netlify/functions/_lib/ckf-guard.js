// CKF auth gate. ALL access requires a valid session token AND email match.
// Use as: const { user } = await requireCurtis(event);  -> throws { statusCode, body } on failure
const { sbSelect } = require('./ckf-sb.js');

const ALLOWED_EMAIL = 'cfairweather1996@gmail.com';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function reply(statusCode, data) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(data) };
}

class GateError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function extractToken(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  // Fallback to header used by the React client
  return event.headers?.['x-ckf-token'] || event.headers?.['X-CKF-Token'] || null;
}

async function requireCurtis(event) {
  const token = extractToken(event);
  if (!token) throw new GateError(401, 'Missing token');
  const rows = await sbSelect(
    'ckf_users',
    `session_token=eq.${encodeURIComponent(token)}&select=id,email,session_expires_at&limit=1`
  );
  if (!rows || rows.length === 0) throw new GateError(401, 'Invalid session');
  const user = rows[0];
  // Defence in depth: hard-check email even though token is per-user.
  if (user.email !== ALLOWED_EMAIL) throw new GateError(403, 'Forbidden');
  if (user.session_expires_at && new Date(user.session_expires_at) < new Date()) {
    throw new GateError(401, 'Session expired');
  }
  return { user };
}

// Wrap a handler so gate errors become proper HTTP replies.
function withGate(handler) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return reply(200, {});
    try {
      const { user } = await requireCurtis(event);
      return await handler(event, { user });
    } catch (e) {
      if (e instanceof GateError) return reply(e.statusCode, { error: e.message });
      console.error('[ckf]', e);
      return reply(500, { error: e.message || 'Server error' });
    }
  };
}

module.exports = { ALLOWED_EMAIL, GateError, requireCurtis, withGate, reply, HEADERS };
