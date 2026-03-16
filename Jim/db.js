// ════════════════════════════════════════════════════════════
//  db.js  ─  IndexedDB 封裝層 (johnnews v2)
// ════════════════════════════════════════════════════════════
const DB_NAME = 'johnnews';
const DB_VER  = 2;

let _db = null;

export async function openDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = ({ target, oldVersion }) => {
      const db = target.result;
      if (oldVersion < 1) {
        const art = db.createObjectStore('articles', { keyPath: 'id' });
        art.createIndex('by_pubDate',   'pubDate',   { unique: false });
        art.createIndex('by_source',    'sourceKey', { unique: false });
        art.createIndex('by_fetchedAt', 'fetchedAt', { unique: false });
      }
      if (oldVersion < 2) {
        db.createObjectStore('sources',  { keyPath: 'key' });
        db.createObjectStore('userdata', { keyPath: 'id'  });
        db.createObjectStore('meta',     { keyPath: 'key' });
      }
    };

    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

// ── 通用工具 ──────────────────────────────────────────────
function idb(req) {
  return new Promise((res, rej) => {
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

async function tx(storeName, mode, fn) {
  const db    = await openDB();
  const store = db.transaction(storeName, mode).objectStore(storeName);
  return fn(store);
}

// ── articles ──────────────────────────────────────────────
export async function saveArticles(items) {
  if (!items.length) return;
  const db    = await openDB();
  const store = db.transaction('articles', 'readwrite').objectStore('articles');
  for (const item of items) store.put(item);
  return new Promise((res, rej) => {
    store.transaction.oncomplete = () => res();
    store.transaction.onerror    = e  => rej(e.target.error);
  });
}

export async function getArticlesBySource(sourceKey, limit = 200) {
  return tx('articles', 'readonly', store => {
    return new Promise(resolve => {
      const results = [];
      const req = store.index('by_pubDate')
                       .openCursor(null, 'prev'); // newest first
      req.onsuccess = ({ target }) => {
        const cursor = target.result;
        if (!cursor || results.length >= limit) return resolve(results);
        if (!sourceKey || cursor.value.sourceKey === sourceKey)
          results.push(cursor.value);
        cursor.continue();
      };
      req.onerror = () => resolve(results);
    });
  });
}

export async function getAllArticles(limit = 2000) {
  return tx('articles', 'readonly', store => {
    return new Promise(resolve => {
      const results = [];
      const req = store.index('by_pubDate').openCursor(null, 'prev');
      req.onsuccess = ({ target }) => {
        const cursor = target.result;
        if (!cursor || results.length >= limit) return resolve(results);
        results.push(cursor.value);
        cursor.continue();
      };
      req.onerror = () => resolve(results);
    });
  });
}

export async function pruneArticles(ttlHours = 48) {
  const cutoff = Date.now() - ttlHours * 3_600_000;
  return tx('articles', 'readwrite', store => {
    return new Promise(resolve => {
      const req = store.index('by_fetchedAt')
                       .openCursor(IDBKeyRange.upperBound(cutoff));
      req.onsuccess = ({ target }) => {
        const cursor = target.result;
        if (!cursor) return resolve();
        cursor.delete();
        cursor.continue();
      };
      req.onerror = () => resolve();
    });
  });
}

export async function getArticleCount() {
  return tx('articles', 'readonly', s => idb(s.count()));
}

// ── sources ───────────────────────────────────────────────
export async function saveSources(rows) {
  if (!rows.length) return;
  const db    = await openDB();
  const store = db.transaction('sources', 'readwrite').objectStore('sources');
  for (const r of rows) store.put(r);
  return new Promise((res, rej) => {
    store.transaction.oncomplete = () => res();
    store.transaction.onerror    = e  => rej(e.target.error);
  });
}

export async function getSources() {
  return tx('sources', 'readonly', s => idb(s.getAll()));
}

export async function updateSource(key, patch) {
  return tx('sources', 'readwrite', async s => {
    const rec = await idb(s.get(key));
    if (rec) s.put({ ...rec, ...patch });
  });
}

// ── userdata (singleton doc id='me') ──────────────────────
export async function getUserdata() {
  const rec = await tx('userdata', 'readonly', s => idb(s.get('me')));
  return rec ?? { id: 'me', bookmarks: [], readIds: [], keywords: [], prefs: {} };
}

export async function saveUserdata(patch) {
  const cur = await getUserdata();
  const next = {
    ...cur,
    ...patch,
    bookmarks: patch.bookmarks ?? cur.bookmarks,
    readIds:   patch.readIds   ?? cur.readIds,
    keywords:  patch.keywords  ?? cur.keywords,
    prefs:     { ...cur.prefs, ...(patch.prefs ?? {}) },
  };
  return tx('userdata', 'readwrite', s => s.put(next));
}

// ── meta ──────────────────────────────────────────────────
export async function getMeta(key) {
  const rec = await tx('meta', 'readonly', s => idb(s.get(key)));
  return rec?.value;
}

export async function setMeta(key, value) {
  return tx('meta', 'readwrite', s => s.put({ key, value }));
}

// ── 穩定 Article ID ───────────────────────────────────────
export function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++)
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
