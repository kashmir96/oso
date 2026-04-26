// Thin fetch wrapper that injects the CKF session token.
const STORAGE_KEY = 'ckf_token';

// Cross-component pub/sub: any mutating action fires this so live strips
// (Today, Errands, Coming up) refresh without a manual reload.
export function notifyChanged() {
  invalidateCache();
  try { window.dispatchEvent(new CustomEvent('ckf-data-changed')); } catch {}
}

// ── Tiny SWR-style cache for read-only calls ──
// Page navigations re-mount components and re-fire their fetches. Caching the
// prior response keyed by (endpoint + body) lets the new mount paint instantly
// with stale data, then refresh in the background. Mutations call
// invalidateCache() to wipe everything.
const _cache = new Map();
const DEFAULT_TTL = 30_000;

export function invalidateCache() { _cache.clear(); }

// callCached — same shape as call() but returns cached if fresh; always
// kicks off a background refresh so the next visit is current.
export async function callCached(endpoint, body, ttlMs = DEFAULT_TTL) {
  const key = endpoint + ':' + JSON.stringify(body || {});
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && (now - hit.t) < ttlMs) {
    // Background refresh — don't block on it
    call(endpoint, body)
      .then((d) => _cache.set(key, { t: Date.now(), data: d }))
      .catch(() => {});
    return hit.data;
  }
  const data = await call(endpoint, body);
  _cache.set(key, { t: Date.now(), data });
  return data;
}

export function getToken() {
  return localStorage.getItem(STORAGE_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(STORAGE_KEY, t);
  else localStorage.removeItem(STORAGE_KEY);
}

export async function call(endpoint, body) {
  const token = getToken();
  const res = await fetch(`/.netlify/functions/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-CKF-Token': token } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok) {
    const msg = json?.error || `Request failed: ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return json;
}
