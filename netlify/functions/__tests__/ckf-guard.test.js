// Auth gate tests — verify the email check is enforced even when token resolves.
// Run: node --test netlify/functions/__tests__/ckf-guard.test.js
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

// Stub out _lib/ckf-sb.js with an in-memory fake before requiring the guard.
const realResolve = Module._resolve_lookupPaths || Module._resolveLookupPaths;
const realLoad = Module._load;

let fakeUsers = [];
Module._load = function (request, parent, ...rest) {
  if (request.endsWith('ckf-sb.js') || request.endsWith('ckf-sb')) {
    return {
      sbSelect: async (table, query) => {
        if (table !== 'ckf_users') return [];
        const m = query && query.match(/session_token=eq\.([^&]+)/);
        const token = m ? decodeURIComponent(m[1]) : null;
        return fakeUsers.filter((u) => u.session_token === token);
      },
      sbInsert: async () => ({}), sbUpdate: async () => [], sbDelete: async () => true,
      sbFetch: async () => ({}),
    };
  }
  return realLoad.call(this, request, parent, ...rest);
};

const { requireCurtis, ALLOWED_EMAIL } = require('../_lib/ckf-guard.js');

test('rejects a request with no token', async () => {
  await assert.rejects(
    () => requireCurtis({ headers: {} }),
    (e) => e.statusCode === 401
  );
});

test('rejects a token whose user is not Curtis', async () => {
  fakeUsers = [{
    id: 'imposter', email: 'someone-else@example.com',
    session_token: 'TOKEN_X', session_expires_at: null,
  }];
  await assert.rejects(
    () => requireCurtis({ headers: { 'x-ckf-token': 'TOKEN_X' } }),
    (e) => e.statusCode === 403
  );
});

test('rejects an expired session', async () => {
  fakeUsers = [{
    id: 'curtis', email: ALLOWED_EMAIL,
    session_token: 'TOKEN_E', session_expires_at: '2020-01-01T00:00:00Z',
  }];
  await assert.rejects(
    () => requireCurtis({ headers: { authorization: 'Bearer TOKEN_E' } }),
    (e) => e.statusCode === 401
  );
});

test('accepts Curtis with a valid unexpired token', async () => {
  fakeUsers = [{
    id: 'curtis', email: ALLOWED_EMAIL,
    session_token: 'TOKEN_OK', session_expires_at: null,
  }];
  const { user } = await requireCurtis({ headers: { 'x-ckf-token': 'TOKEN_OK' } });
  assert.strictEqual(user.email, ALLOWED_EMAIL);
});

// Restore original module loader
test.after(() => { Module._load = realLoad; });
