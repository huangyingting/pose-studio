/*
 * Offline support. The editor runs in the browser, so once the app shell and its static assets
 * have been cached it works without a network connection. API requests (the server edition's
 * sign-in, sync and AI) always go to the network and are never cached.
 *
 * - Page navigations: network first, falling back to the cached shell when offline.
 * - Hashed build assets (/_next/static) and the MediaPipe runtime: cache first (immutable).
 * - The motion library (/motions: its index and files change with a release, by the same names):
 *   network first, the kept copy offline.
 * - Once the worker runs, the page asks it to keep what it loaded before (its first visit's build
 *   assets), the characters' pictures and all of the motion library (the templates are made of
 *   it), a few files at a time.
 * - Other same-origin GETs: stale-while-revalidate.
 */
const VERSION = 'v2';
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

async function networkFirstAsset(request) {
  const cache = await caches.open(ASSETS);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) ?? Response.error();
  }
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

async function keep(loaded) {
  const cache = await caches.open(ASSETS);
  const kept = async (url) => {
    if (await cache.match(url)) return true;
    try {
      const res = await fetch(url);
      if (res.ok) await cache.put(url, res);
      return true;
    } catch {
      return false; // (Offline: kept next time.)
    }
  };
  for (const url of loaded) {
    const u = new URL(url);
    if (u.origin === self.location.origin && u.pathname.startsWith(BASE) && !u.pathname.startsWith(`${BASE}api/`)) await kept(url);
  }
  const index = await networkFirstAsset(new Request(`${BASE}motions/index.json`));
  if (!index.ok) return;
  const motions = (await index.json()).map(({ id }) => `${BASE}motions/${encodeURIComponent(id.slice(id.indexOf(':') + 1))}.json`);
  // (A few at a time; all stop when offline.)
  const next = async () => {
    for (let url; (url = motions.shift()); ) if (!(await kept(url))) motions.length = 0;
  };
  await Promise.all([next(), next(), next(), next()]);
}

self.addEventListener('message', (event) => {
  if (Array.isArray(event.data?.keep)) event.waitUntil(keep(event.data.keep));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const path = url.pathname.slice(BASE.length - 1); // keep the leading slash
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE) || path.startsWith('/api/')) return;
  if (request.mode === 'navigate') event.respondWith(networkFirst(request));
  else if (path.startsWith('/_next/static/') || path.startsWith('/mediapipe/')) event.respondWith(cacheFirst(request));
  else if (path.startsWith('/motions/')) event.respondWith(networkFirstAsset(request));
  else event.respondWith(staleWhileRevalidate(request));
});
