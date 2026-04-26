// Tiny service worker — caches the CKF app shell so launching the PWA while
// offline at least shows the UI. API calls (POST) won't work offline, but
// the shell + cached static assets render immediately.
//
// Cache name bumps on every deploy via the build URL fingerprint Vite emits;
// for simplicity we cache by URL and let stale-while-revalidate keep things
// fresh.

const SHELL = 'ckf-shell-v2';
const SHELL_URLS = [
  '/ckf/',
  '/ckf/index.html',
  '/ckf-icon.svg',
  '/ckf-manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(SHELL_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('ckf-shell-') && k !== SHELL).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GET. POST/PUT/DELETE goes straight to network — no API caching.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Same-origin /ckf/ and built assets: stale-while-revalidate.
  if (url.origin === self.location.origin && (url.pathname.startsWith('/ckf/') || url.pathname === '/ckf-icon.svg' || url.pathname === '/ckf-manifest.webmanifest')) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);
      // Return cache immediately if we have one; let network refresh in background.
      if (cached) return cached;
      // Otherwise wait for network — and if that fails, fall back to /ckf/index.html (SPA shell).
      const fresh = await network;
      if (fresh) return fresh;
      const shell = await cache.match('/ckf/index.html');
      if (shell) return shell;
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    })());
  }
});
