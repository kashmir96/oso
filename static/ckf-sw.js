// Tiny service worker — caches the CKF app shell so launching the PWA while
// offline at least shows the UI. API calls (POST) won't work offline, but
// the shell + cached static assets render immediately.
//
// Cache name bumps on every deploy via the build URL fingerprint Vite emits;
// for simplicity we cache by URL and let stale-while-revalidate keep things
// fresh.

const SHELL = 'ckf-shell-v3';
const SHELL_URLS = [
  '/ckf/',
  '/ckf/index.html',
  '/ckf-icon.svg',
  '/ckf-manifest.webmanifest',
];

// Paths whose responses should always come from the network when available
// (with cache fallback for offline). The SPA shell HTML is in here because
// stale shell HTML still references the previous deploy's bundle filenames,
// which causes "I deployed but mobile still sees the old UI" bugs.
function isNetworkFirst(url) {
  return url.pathname === '/ckf/' || url.pathname === '/ckf/index.html';
}

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

  // Same-origin /ckf/ and built assets.
  // - SPA shell HTML (/ckf/, /ckf/index.html): NETWORK-FIRST so a deploy is
  //   immediately visible to the user. Falls back to cache if offline.
  // - Everything else (hashed bundle assets, icon, manifest): stale-while-
  //   revalidate. Hashed filenames mean cache hits are always correct for
  //   that build — refresh in background for the next visit.
  if (url.origin === self.location.origin && (url.pathname.startsWith('/ckf/') || url.pathname === '/ckf-icon.svg' || url.pathname === '/ckf-manifest.webmanifest')) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);

      if (isNetworkFirst(url)) {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cached = await cache.match(req);
          if (cached) return cached;
          const shell = await cache.match('/ckf/index.html');
          if (shell) return shell;
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      }

      // stale-while-revalidate for everything else
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);
      if (cached) return cached;
      const fresh = await network;
      if (fresh) return fresh;
      const shell = await cache.match('/ckf/index.html');
      if (shell) return shell;
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    })());
  }
});
