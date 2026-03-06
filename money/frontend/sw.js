// ── FX Intelligence · Service Worker v4 (static build) ──────────────────────
// All data is pre-generated in data.js – no API calls needed.
// Strategy:
//   App shell + data.js → cache-first  (pre-cached on install)
//   CDN libs             → cache-first  (pre-cached on install)
// ─────────────────────────────────────────────────────────────────────────────

const STATIC_CACHE = 'fx-static-v4';
const CDN_CACHE    = 'fx-cdn-v2';

// App shell files to pre-cache on install
const APP_SHELL = [
  '/',
  '/data.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// CDN assets to pre-cache (exact versioned URLs)
const CDN_PRECACHE = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=IBM+Plex+Sans+TC:wght@300;400;500&display=swap',
];

// CDN hostnames for runtime cache-first
const CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'unpkg.com',
  'cdn.jsdelivr.net',
];

// ── Install: pre-cache app shell + CDN libs ───────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    Promise.all([
      // App shell — must succeed
      caches.open(STATIC_CACHE).then(c => c.addAll(APP_SHELL)),

      // CDN libs — best-effort (allSettled so one failure doesn't block install)
      caches.open(CDN_CACHE).then(cache =>
        Promise.allSettled(
          CDN_PRECACHE.map(url =>
            fetch(url, { mode: 'cors', credentials: 'omit' })
              .then(r => { if (r.ok) cache.put(url, r); })
              .catch(() => {})
          )
        )
      ),
    ]).then(() => self.skipWaiting())
  );
});

// ── Activate: purge stale caches ──────────────────────────────────────────────
self.addEventListener('activate', e => {
  const keep = new Set([STATIC_CACHE, CDN_CACHE]);
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !keep.has(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: request routing ────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // CDN assets → cache-first
  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    e.respondWith(cdnFirst(request));
    return;
  }

  // Same-origin (app shell + data.js) → cache-first, then network
  e.respondWith(appShellFirst(request));
});

// ── Strategy: cache-first (CDN) ───────────────────────────────────────────────
async function cdnFirst(request) {
  const cache  = await caches.open(CDN_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const resp = await fetch(request, { mode: 'cors', credentials: 'omit' });
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch {
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

// ── Strategy: cache-first (app shell) ────────────────────────────────────────
async function appShellFirst(request) {
  const cache  = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const resp = await fetch(request);
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch {
    // SPA fallback for navigation requests
    const fallback = await cache.match('/');
    return fallback || new Response('Offline', { status: 503 });
  }
}
