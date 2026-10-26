/*
 * Offline support. The editor runs in the browser, so once the app shell and its static assets
 * have been cached it works without a network connection. API requests (the server edition's
 * sign-in, sync and AI) always go to the network and are never cached.
 *
 * - Page navigations: network first, falling back to the cached shell when offline.
 * - Hashed build assets (/_next/static) and the MediaPipe runtime: cache first (immutable).
 * - Other same-origin GETs: stale-while-revalidate.
 */
const VERSION = 'v1';
// The app may live under a sub-path (e.g. /pose-studio/ on GitHub Pages): the scope is its root.
const BASE = new URL(self.registration.scope).pathname;
const SHELL = `pose-studio-shell-${VERSION}`;
const ASSETS = `pose-studio-assets-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll([BASE, `${BASE}manifest.webmanifest`])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pose-studio-') && k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(BASE, res.clone());
    return res;
  } catch {
    return (await cache.match(BASE)) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  const update = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit ?? Response.error());
  return hit ?? update;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const path = url.pathname.slice(BASE.length - 1); // keep the leading slash
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE) || path.startsWith('/api/')) return;
  if (request.mode === 'navigate') event.respondWith(networkFirst(request));
  else if (path.startsWith('/_next/static/') || path.startsWith('/mediapipe/')) event.respondWith(cacheFirst(request));
  else event.respondWith(staleWhileRevalidate(request));
});
