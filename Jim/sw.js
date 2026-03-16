// ════════════════════════════════════════════════════════════
//  sw.js  ─  Service Worker  (放在專案根目錄 / index.html 同層)
// ════════════════════════════════════════════════════════════
const SHELL_VER  = 'shell-v1.0.0';
const API_CACHE  = 'api-v1';
const IMG_CACHE  = 'img-v1';
const API_URL    = 'https://rss-aggregator.s01yg3642.workers.dev/api';

const SHELL_ASSETS = [
  './',
  './index.html',
  './db.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// ── Install：預快取 Shell ─────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_VER)
      .then(c => c.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] install cache failed', err))
  );
});

// ── Activate：清除舊版 Cache ──────────────────────────────
self.addEventListener('activate', event => {
  const keep = [SHELL_VER, API_CACHE, IMG_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch 攔截 ────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = request.url;

  // 跳過 non-GET、chrome-extension、browser-sync 等
  if (request.method !== 'GET') return;
  if (!url.startsWith('http'))   return;

  // 1. Worker API → Network-first，離線回傳 offline JSON
  if (url.startsWith(API_URL)) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // 2. Shell 靜態資源 → Cache-first
  if (isShell(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 3. 圖片 → Stale-While-Revalidate（限 10MB 總量）
  if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)) {
    event.respondWith(staleWhileRevalidate(request, IMG_CACHE));
    return;
  }

  // 4. 其餘 → 直接 Network（不快取）
});

function isShell(url) {
  return SHELL_ASSETS.some(a => {
    const abs = new URL(a, self.location.href).href;
    return url === abs || url.endsWith(a.replace('./', '/'));
  });
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) caches.open(SHELL_VER).then(c => c.put(req, res.clone()));
    return res;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(req, cacheName) {
  try {
    const res = await fetch(req.clone(), {
      signal: AbortSignal.timeout(18000),
    });
    if (res.ok) {
      caches.open(cacheName).then(c => c.put(req, res.clone()));
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    // 完全離線：回傳空殼，讓 app.js 從 IDB 補資料
    return new Response(
      JSON.stringify({ ok: false, offline: true, sources: [] }),
      {
        status:  200,
        headers: {
          'Content-Type':  'application/json',
          'X-SW-Offline':  'true',
        },
      }
    );
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fresh  = fetch(req)
    .then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached ?? (await fresh) ?? new Response('', { status: 404 });
}

// ── Background Sync ───────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-rss') {
    event.waitUntil(backgroundFetchRSS());
  }
});

async function backgroundFetchRSS() {
  try {
    const res  = await fetch(API_URL, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return;
    const data = await res.json();
    // 通知所有分頁
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.postMessage({ type: 'RSS_UPDATED', data }));
  } catch (e) {
    console.warn('[SW] bg sync failed:', e.message);
  }
}

// ── Periodic Background Sync（每 30 分鐘，需瀏覽器支援）───
self.addEventListener('periodicsync', event => {
  if (event.tag === 'periodic-rss') {
    event.waitUntil(backgroundFetchRSS());
  }
});

// ── Push 通知 ─────────────────────────────────────────────
self.addEventListener('push', event => {
  const payload = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(payload.title ?? '情報中心', {
      body:    payload.body ?? '',
      icon:    './icons/icon-192.png',
      badge:   './icons/badge-72.png',
      data:    { url: payload.url ?? './' },
      actions: [
        { action: 'open',    title: '開啟文章' },
        { action: 'dismiss', title: '略過' },
      ],
      tag:     'news-' + (payload.id ?? Date.now()),
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action !== 'dismiss') {
    const target = event.notification.data?.url ?? './';
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(wins => {
          const existing = wins.find(w => w.url === target);
          return existing ? existing.focus() : self.clients.openWindow(target);
        })
    );
  }
});
