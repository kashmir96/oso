// Thin fetch wrapper that injects the CKF session token.
const STORAGE_KEY = 'ckf_token';

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
