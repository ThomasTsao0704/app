// ── FX Intelligence · Service Worker ──────────────────────────────────────────
const STATIC_CACHE = 'fx-static-v2';
const CDN_CACHE    = 'fx-cdn-v1';

// App shell to precache on install
const PRECACHE = ['/'];

// CDN hostnames to cache-first at runtime
const CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'unpkg.com',
  'cdn.jsdelivr.net',
];

// ── Install: precache app shell ───────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())   // activate immediately
  );
});

// ── Activate: purge old caches ────────────────────────────────────────────────
self.addEventListener('activate', e => {
  const keep = new Set([STATIC_CACHE, CDN_CACHE]);
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !keep.has(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())  // take control without reload
  );
});

// ── Fetch: routing strategy ───────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1. API calls: always network, never cache
  if (url.pathname.startsWith('/api/')) return;

  // 2. CDN assets: cache-first (versioned, rarely change)
  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    e.respondWith(
      caches.open(CDN_CACHE).then(cache =>
        cache.match(request).then(hit => {
          if (hit) return hit;
          return fetch(request).then(resp => {
            if (resp.ok) cache.put(request, resp.clone());
            return resp;
          });
        })
      )
    );
    return;
  }

  // 3. Same-origin (app shell): network-first, cache as offline fallback
  e.respondWith(
    fetch(request)
      .then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(STATIC_CACHE).then(c => c.put(request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(request))
  );
});
