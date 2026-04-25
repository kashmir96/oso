/**
 * ckf-auth.js — login + logout for the CKF Second Brain.
 *
 * Single-user system. The first time anyone hits `action: 'login'` with the
 * allowed email, the row is created with the supplied password. After that,
 * normal hash check applies. If you forget the password, run `action: 'reset'`
 * with the SUPABASE service key from a privileged context (out of scope here).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
const crypto = require('crypto');
const { sbSelect, sbInsert, sbUpdate } = require('./_lib/ckf-sb.js');
const { ALLOWED_EMAIL, reply, HEADERS } = require('./_lib/ckf-guard.js');

const SESSION_TTL_DAYS = 30;

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}
function generateSalt() { return crypto.randomBytes(16).toString('hex'); }
function generateToken() { return crypto.randomBytes(32).toString('hex'); }

async function getUserByEmail(email) {
  const rows = await sbSelect(
    'ckf_users',
    `email=eq.${encodeURIComponent(email)}&select=*&limit=1`
  );
  return rows?.[0] || null;
}

async function getUserByToken(token) {
  const rows = await sbSelect(
    'ckf_users',
    `session_token=eq.${encodeURIComponent(token)}&select=id,email,session_expires_at&limit=1`
  );
  return rows?.[0] || null;
}

async function login(body) {
  const { email, password } = body;
  if (!email || !password) return reply(400, { error: 'Email and password required' });
  if (email !== ALLOWED_EMAIL) return reply(403, { error: 'Forbidden' });
  if (password.length < 8) return reply(400, { error: 'Password must be at least 8 characters' });

  let user = await getUserByEmail(email);

  // First-run bootstrap: seed the single allowed user with this password.
  if (!user) {
    const salt = generateSalt();
    user = await sbInsert('ckf_users', {
      email,
      password_hash: hashPassword(password, salt),
      salt,
      must_change_password: false,
    });
  } else {
    if (hashPassword(password, user.salt) !== user.password_hash) {
      return reply(401, { error: 'Invalid email or password' });
    }
  }

  const token = generateToken();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400e3).toISOString();
  await sbUpdate('ckf_users', `id=eq.${user.id}`, {
    session_token: token,
    session_expires_at: expires,
  });

  return reply(200, {
    success: true,
    token,
    expires_at: expires,
    user: { id: user.id, email: user.email },
  });
}

async function logout(body) {
  const { token } = body;
  if (!token) return reply(400, { error: 'Token required' });
  const u = await getUserByToken(token);
  if (u) await sbUpdate('ckf_users', `id=eq.${u.id}`, { session_token: null, session_expires_at: null });
  return reply(200, { success: true });
}

async function check(body) {
  const { token } = body;
  if (!token) return reply(401, { error: 'No token' });
  const u = await getUserByToken(token);
  if (!u) return reply(401, { error: 'Invalid token' });
  if (u.email !== ALLOWED_EMAIL) return reply(403, { error: 'Forbidden' });
  if (u.session_expires_at && new Date(u.session_expires_at) < new Date()) {
    return reply(401, { error: 'Session expired' });
  }
  return reply(200, { user: { id: u.id, email: u.email } });
}

async function changePassword(body) {
  const { token, current_password, new_password } = body;
  if (!token || !current_password || !new_password) return reply(400, { error: 'Missing fields' });
  if (new_password.length < 8) return reply(400, { error: 'New password must be at least 8 characters' });
  const u = await getUserByToken(token);
  if (!u) return reply(401, { error: 'Invalid token' });
  const full = (await sbSelect('ckf_users', `id=eq.${u.id}&select=*&limit=1`))[0];
  if (hashPassword(current_password, full.salt) !== full.password_hash) {
    return reply(401, { error: 'Current password wrong' });
  }
  const newSalt = generateSalt();
  await sbUpdate('ckf_users', `id=eq.${u.id}`, {
    password_hash: hashPassword(new_password, newSalt),
    salt: newSalt,
  });
  return reply(200, { success: true });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;
  try {
    if (action === 'login') return await login(body);
    if (action === 'logout') return await logout(body);
    if (action === 'check') return await check(body);
    if (action === 'change-password') return await changePassword(body);
    return reply(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('[ckf-auth]', e);
    return reply(500, { error: e.message || 'Server error' });
  }
};
