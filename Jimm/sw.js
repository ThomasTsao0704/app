// ═══════════════════════════════════════════════════════════
//  Trading Journal Pro — Service Worker v2.0
//  Strategies:
//    1. App Shell  → Cache First (HTML/CSS/JS)
//    2. Google Fonts → Stale-While-Revalidate
//    3. Everything else → Network First with fallback
// ═══════════════════════════════════════════════════════════

const CACHE_NAME = 'tjp-v2.0.0';
const FONT_CACHE = 'tjp-fonts-v1';

// App Shell — always cached on install
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
];

// Google Fonts to pre-cache
const FONT_URLS = [
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap',
];

// ──────────────────────────────────────
//  INSTALL — cache app shell
// ──────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing v2.0.0...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching app shell');
      return cache.addAll(SHELL_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ──────────────────────────────────────
//  ACTIVATE — clean old caches
// ──────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== FONT_CACHE)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ──────────────────────────────────────
//  FETCH — routing strategy
// ──────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET and chrome-extension requests
  if (event.request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // Strategy 1: Google Fonts → Stale-While-Revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(event.request, FONT_CACHE));
    return;
  }

  // Strategy 2: App Shell → Cache First
  if (SHELL_ASSETS.some(a => url.pathname.endsWith(a.replace('./', '')))) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Strategy 3: Everything else → Network First
  event.respondWith(networkFirst(event.request));
});

// ──────────────────────────────────────
//  STRATEGIES
// ──────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline — app shell not cached yet', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Fallback to index.html for navigation requests
    if (request.mode === 'navigate') {
      return caches.match('./index.html');
    }
    return new Response('Network error', { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || await fetchPromise || new Response('Font unavailable', { status: 503 });
}

// ──────────────────────────────────────
//  BACKGROUND SYNC — queued actions
// ──────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-trades') {
    console.log('[SW] Background sync triggered');
    // Future: sync to remote backend if added
  }
});

// ──────────────────────────────────────
//  PUSH NOTIFICATIONS (placeholder)
// ──────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Trading Journal Pro', {
      body: data.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/badge-72.png',
      tag: 'tjp-notification',
      requireInteraction: false,
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});

// ──────────────────────────────────────
//  MESSAGE CHANNEL — communicate with app
// ──────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_NAME });
  }
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0]?.postMessage({ cleared: true });
    });
  }
});
