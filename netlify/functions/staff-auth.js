/**
 * staff-auth.js
 *
 * Staff authentication & user management with TOTP 2FA and activity logging.
 * Actions: login, change-password, verify-totp, setup-totp,
 *          list-users, create-user, update-user, delete-user,
 *          log-activity, get-activity-log, seed
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const crypto = require('crypto');

// ── Password helpers ──
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}
function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── TOTP helpers (RFC 6238, no external deps) ──
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    result += BASE32_CHARS[parseInt(chunk, 2)];
  }
  return result;
}

function base32Decode(str) {
  let bits = '';
  for (const c of str.toUpperCase()) {
    const idx = BASE32_CHARS.indexOf(c);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTOTPSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function generateTOTP(secret, timeStep) {
  const key = base32Decode(secret);
  const time = Buffer.alloc(8);
  time.writeUInt32BE(0, 0);
  time.writeUInt32BE(timeStep, 4);
  const hmac = crypto.createHmac('sha1', key).update(time).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1000000;
  return code.toString().padStart(6, '0');
}

function verifyTOTP(secret, code) {
  const now = Math.floor(Date.now() / 1000 / 30);
  for (let i = -1; i <= 1; i++) {
    if (generateTOTP(secret, now + i) === code) return true;
  }
  return false;
}

function generateOTPAuthURL(username, secret) {
  return `otpauth://totp/PrimalPantry:${encodeURIComponent(username)}?secret=${secret}&issuer=PrimalPantry&algorithm=SHA1&digits=6&period=30`;
}

// ── HTTP helpers ──
const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function reply(statusCode, data) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(data) };
}

async function sbFetch(url, opts = {}) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
  };
  return fetch(`${SUPABASE_URL}${url}`, {
    ...opts,
    headers: { ...defaultHeaders, ...opts.headers },
  });
}

// ── Activity logging ──
async function logActivity(staffId, staffUsername, action, detail) {
  try {
    await sbFetch('/rest/v1/staff_activity_log', {
      method: 'POST',
      body: JSON.stringify({ staff_id: staffId, staff_username: staffUsername, action, detail }),
    });
  } catch (e) {
    console.error('[staff-auth] Failed to log activity:', e.message);
  }
}

// ── Staff lookups ──
async function getStaffByToken(token) {
  if (!token) return null;
  const res = await sbFetch(`/rest/v1/staff?session_token=eq.${encodeURIComponent(token)}&select=*`);
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

async function getStaffByUsername(username) {
  const res = await sbFetch(`/rest/v1/staff?username=eq.${encodeURIComponent(username)}&select=*`);
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

// ── Seed initial accounts ──
async function seedAccounts() {
  const res = await sbFetch('/rest/v1/staff?select=id&limit=1');
  const rows = await res.json();
  if (rows && rows.length > 0) return false;

  const accounts = [
    { username: 'Kashmir', display_name: 'Kashmir (Curtis)', password: '1532Milo2631!', role: 'owner', can_manage_users: true, must_change_password: false },
    { username: 'Linda', display_name: 'Linda (Mum)', password: 'ChangeMe1!', role: 'admin', can_manage_users: true, must_change_password: true },
    { username: 'Kerry', display_name: 'Kerry', password: 'ChangeMe1!', role: 'staff', can_manage_users: false, must_change_password: true },
    { username: 'Trixy', display_name: 'Trixy', password: 'ChangeMe1!', role: 'staff', can_manage_users: false, must_change_password: true },
  ];

  const rows_to_insert = accounts.map(a => {
    const salt = generateSalt();
    return {
      username: a.username,
      display_name: a.display_name,
      password_hash: hashPassword(a.password, salt),
      salt,
      role: a.role,
      can_manage_users: a.can_manage_users,
      must_change_password: a.must_change_password,
      totp_secret: null,
      totp_enabled: false,
    };
  });

  await sbFetch('/rest/v1/staff', {
    method: 'POST',
    body: JSON.stringify(rows_to_insert),
  });
  return true;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, '');
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body); } catch { return reply(400, { error: 'Invalid JSON' }); }

  const { action } = body;

  // ── LOGIN ──
  if (action === 'login') {
    await seedAccounts();

    const { username, password } = body;
    if (!username || !password) return reply(400, { error: 'Username and password required' });

    const staff = await getStaffByUsername(username);
    if (!staff) return reply(401, { error: 'Invalid username or password' });

    const hash = hashPassword(password, staff.salt);
    if (hash !== staff.password_hash) return reply(401, { error: 'Invalid username or password' });

    // Generate session token
    const token = generateToken();
    await sbFetch(`/rest/v1/staff?id=eq.${staff.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ session_token: token }),
    });

    await logActivity(staff.id, staff.username, 'login', `${staff.display_name} logged in`);

    const response = {
      success: true,
      token,
      staff: {
        id: staff.id,
        username: staff.username,
        display_name: staff.display_name,
        role: staff.role,
        can_manage_users: staff.can_manage_users,
        must_change_password: staff.must_change_password,
      },
    };

    // Check TOTP status
    if (!staff.must_change_password) {
      if (!staff.totp_enabled) {
        // Generate a new secret for setup
        const secret = staff.totp_secret || generateTOTPSecret();
        if (!staff.totp_secret) {
          await sbFetch(`/rest/v1/staff?id=eq.${staff.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ totp_secret: secret }),
          });
        }
        response.needs_totp_setup = true;
        response.totp_secret = secret;
        response.totp_uri = generateOTPAuthURL(staff.username, secret);
      } else {
        // Skip 2FA if remembered within 7 days
        const remembered = body.totp_remembered;
        const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
        if (remembered && (Date.now() - Number(remembered)) < SEVEN_DAYS) {
          // 2FA already verified recently, skip
        } else {
          response.needs_totp_verify = true;
        }
      }
    }

    return reply(200, response);
  }

  // ── VERIFY TOTP (login step 2) ──
  if (action === 'verify-totp') {
    const { token, code } = body;
    if (!token || !code) return reply(400, { error: 'Token and code required' });

    const staff = await getStaffByToken(token);
    if (!staff) return reply(401, { error: 'Invalid session' });
    if (!staff.totp_secret) return reply(400, { error: 'TOTP not configured' });

    if (!verifyTOTP(staff.totp_secret, code.toString().padStart(6, '0'))) {
      return reply(401, { error: 'Invalid code. Check your authenticator app and try again.' });
    }

    return reply(200, { success: true });
  }

  // ── SETUP TOTP (first-time enrollment) ──
  if (action === 'setup-totp') {
    const { token, code } = body;
    if (!token || !code) return reply(400, { error: 'Token and code required' });

    const staff = await getStaffByToken(token);
    if (!staff) return reply(401, { error: 'Invalid session' });
    if (!staff.totp_secret) return reply(400, { error: 'No TOTP secret found — try logging in again' });

    if (!verifyTOTP(staff.totp_secret, code.toString().padStart(6, '0'))) {
      return reply(401, { error: 'Invalid code. Make sure you scanned the QR code and entered the current 6-digit code.' });
    }

    await sbFetch(`/rest/v1/staff?id=eq.${staff.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ totp_enabled: true }),
    });

    await logActivity(staff.id, staff.username, 'totp_setup', `${staff.display_name} set up 2FA`);

    return reply(200, { success: true });
  }

  // ── CHANGE PASSWORD ──
  if (action === 'change-password') {
    const { token, new_password } = body;
    if (!token || !new_password) return reply(400, { error: 'Token and new_password required' });
    if (new_password.length < 6) return reply(400, { error: 'Password must be at least 6 characters' });

    const staff = await getStaffByToken(token);
    if (!staff) return reply(401, { error: 'Invalid session' });

    const salt = generateSalt();
    const password_hash = hashPassword(new_password, salt);

    await sbFetch(`/rest/v1/staff?id=eq.${staff.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ password_hash, salt, must_change_password: false }),
    });

    await logActivity(staff.id, staff.username, 'password_change', `${staff.display_name} changed their password`);

    return reply(200, { success: true });
  }

  // ── LIST USERS (admin only) ──
  if (action === 'list-users') {
    const { token } = body;
    const admin = await getStaffByToken(token);
    if (!admin || !admin.can_manage_users) return reply(403, { error: 'Not authorised' });

    const res = await sbFetch('/rest/v1/staff?select=id,username,display_name,role,can_manage_users,must_change_password,totp_enabled,created_at&order=id.asc');
    const users = await res.json();
    return reply(200, { success: true, users });
  }

  // ── CREATE USER (admin only) ──
  if (action === 'create-user') {
    const { token, username, display_name, role, can_manage_users } = body;
    const admin = await getStaffByToken(token);
    if (!admin || !admin.can_manage_users) return reply(403, { error: 'Not authorised' });

    if (can_manage_users && admin.role !== 'owner' && admin.role !== 'admin') {
      return reply(403, { error: 'Only owner/admin can grant user management permissions' });
    }

    if (!username || !display_name) return reply(400, { error: 'username and display_name required' });

    const existing = await getStaffByUsername(username);
    if (existing) return reply(409, { error: 'Username already exists' });

    const tempPassword = 'ChangeMe1!';
    const salt = generateSalt();

    const res = await sbFetch('/rest/v1/staff', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        username,
        display_name,
        password_hash: hashPassword(tempPassword, salt),
        salt,
        role: role || 'staff',
        can_manage_users: can_manage_users || false,
        must_change_password: true,
        totp_secret: null,
        totp_enabled: false,
      }),
    });

    const data = await res.json();
    if (!res.ok) return reply(500, { error: JSON.stringify(data) });

    await logActivity(admin.id, admin.username, 'user_create', `Created user "${username}" (${display_name})`);

    return reply(200, { success: true, temp_password: tempPassword });
  }

  // ── UPDATE USER (admin only) ──
  if (action === 'update-user') {
    const { token, user_id, display_name, role, can_manage_users, reset_password, reset_totp } = body;
    const admin = await getStaffByToken(token);
    if (!admin || !admin.can_manage_users) return reply(403, { error: 'Not authorised' });

    const updates = {};
    if (display_name !== undefined) updates.display_name = display_name;
    if (role !== undefined) updates.role = role;
    if (can_manage_users !== undefined) updates.can_manage_users = can_manage_users;

    if (reset_password) {
      const salt = generateSalt();
      updates.password_hash = hashPassword('ChangeMe1!', salt);
      updates.salt = salt;
      updates.must_change_password = true;
    }

    if (reset_totp) {
      updates.totp_secret = null;
      updates.totp_enabled = false;
    }

    await sbFetch(`/rest/v1/staff?id=eq.${user_id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });

    const details = [];
    if (reset_password) details.push('reset password');
    if (reset_totp) details.push('reset 2FA');
    if (display_name) details.push(`renamed to "${display_name}"`);
    if (role) details.push(`role → ${role}`);
    await logActivity(admin.id, admin.username, 'user_update', `Updated user #${user_id}: ${details.join(', ') || 'settings changed'}`);

    return reply(200, { success: true, password_reset: reset_password ? 'ChangeMe1!' : undefined });
  }

  // ── DELETE USER (admin only) ──
  if (action === 'delete-user') {
    const { token, user_id } = body;
    const admin = await getStaffByToken(token);
    if (!admin || !admin.can_manage_users) return reply(403, { error: 'Not authorised' });

    if (admin.id === user_id) return reply(400, { error: "Can't delete your own account" });

    // Get username before deleting
    const targetRes = await sbFetch(`/rest/v1/staff?id=eq.${user_id}&select=username,display_name`);
    const targets = await targetRes.json();
    const targetName = targets && targets[0] ? targets[0].display_name || targets[0].username : `#${user_id}`;

    await sbFetch(`/rest/v1/staff?id=eq.${user_id}`, { method: 'DELETE' });

    await logActivity(admin.id, admin.username, 'user_delete', `Deleted user "${targetName}"`);

    return reply(200, { success: true });
  }

  // ── LOG ACTIVITY (from frontend) ──
  if (action === 'log-activity') {
    const { token, activity_action, detail } = body;
    const staff = await getStaffByToken(token);
    if (!staff) return reply(401, { error: 'Invalid session' });

    if (!activity_action || !detail) return reply(400, { error: 'activity_action and detail required' });

    await logActivity(staff.id, staff.username, activity_action, detail);
    return reply(200, { success: true });
  }

  // ── GET ACTIVITY LOG (owner only) ──
  if (action === 'get-activity-log') {
    const { token, staff_filter, limit: logLimit } = body;
    const admin = await getStaffByToken(token);
    if (!admin || admin.role !== 'owner') return reply(403, { error: 'Owner access required' });

    let url = `/rest/v1/staff_activity_log?select=*&order=created_at.desc&limit=${logLimit || 100}`;
    if (staff_filter) {
      url += `&staff_username=eq.${encodeURIComponent(staff_filter)}`;
    }

    const res = await sbFetch(url);
    const logs = await res.json();
    return reply(200, { success: true, logs: Array.isArray(logs) ? logs : [] });
  }

  return reply(400, { error: 'Unknown action' });
};
