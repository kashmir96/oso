/**
 * staff-auth.js
 *
 * Staff authentication & user management.
 * Actions: login, change-password, list-users, create-user, update-user, delete-user, seed
 *
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const crypto = require('crypto');

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}
function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

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
  if (rows && rows.length > 0) return false; // already seeded

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
    // Auto-seed on first login attempt
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

    return reply(200, {
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
    });
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

    return reply(200, { success: true });
  }

  // ── LIST USERS (admin only) ──
  if (action === 'list-users') {
    const { token } = body;
    const admin = await getStaffByToken(token);
    if (!admin || !admin.can_manage_users) return reply(403, { error: 'Not authorised' });

    const res = await sbFetch('/rest/v1/staff?select=id,username,display_name,role,can_manage_users,must_change_password,created_at&order=id.asc');
    const users = await res.json();
    return reply(200, { success: true, users });
  }

  // ── CREATE USER (admin only) ──
  if (action === 'create-user') {
    const { token, username, display_name, role, can_manage_users } = body;
    const admin = await getStaffByToken(token);
    if (!admin || !admin.can_manage_users) return reply(403, { error: 'Not authorised' });

    // Only owner can create admins with manage permissions
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
      }),
    });

    const data = await res.json();
    if (!res.ok) return reply(500, { error: JSON.stringify(data) });

    return reply(200, { success: true, temp_password: tempPassword });
  }

  // ── UPDATE USER (admin only) ──
  if (action === 'update-user') {
    const { token, user_id, display_name, role, can_manage_users, reset_password } = body;
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

    await sbFetch(`/rest/v1/staff?id=eq.${user_id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });

    return reply(200, { success: true, password_reset: reset_password ? 'ChangeMe1!' : undefined });
  }

  // ── DELETE USER (admin only) ──
  if (action === 'delete-user') {
    const { token, user_id } = body;
    const admin = await getStaffByToken(token);
    if (!admin || !admin.can_manage_users) return reply(403, { error: 'Not authorised' });

    // Can't delete yourself
    if (admin.id === user_id) return reply(400, { error: "Can't delete your own account" });

    await sbFetch(`/rest/v1/staff?id=eq.${user_id}`, { method: 'DELETE' });
    return reply(200, { success: true });
  }

  return reply(400, { error: 'Unknown action' });
};
