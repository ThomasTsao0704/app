# 情報中心 PWA  v2.0

個人化 RSS 資訊聚合中心，完整 PWA 版本。

---

## 📁 專案結構

```
johnnews-pwa/
├── index.html          主應用程式（含全部邏輯）
├── sw.js               Service Worker
├── db.js               IndexedDB 封裝層
├── manifest.json       PWA Manifest
├── icons/
│   ├── icon-72.png
│   ├── icon-96.png
│   ├── icon-128.png
│   ├── icon-144.png
│   ├── icon-152.png
│   ├── icon-192.png    ← 主要 icon（Android / Chrome）
│   ├── icon-384.png
│   ├── icon-512.png    ← 啟動畫面（Android）
│   └── badge-72.png    ← Push 通知 badge
└── README.md
```

---

## 🚀 部署方式

> **重要**：Service Worker 需要 **HTTPS** 或 **localhost** 才能運作。

### 方式 A — Cloudflare Pages（推薦）

1. 將整個資料夾上傳至 GitHub repo
2. 前往 [Cloudflare Pages](https://pages.cloudflare.com/)
3. 連接 repo，Build 設定全部留空（純靜態）
4. 部署完成後，你的網址即為 `https://xxx.pages.dev`

### 方式 B — 本機開發測試

```bash
# 需要 Python 3
python3 -m http.server 8080
# 瀏覽器打開 http://localhost:8080
```

### 方式 C — 放到已有的 Cloudflare Tunnel 網域

將所有檔案放至你的靜態資源目錄，確保：
- `sw.js` 與 `index.html` 在**同一層目錄**
- Server 回應 `sw.js` 的 `Content-Type: application/javascript`

---

## ⚙️ 設定 Worker URL

打開 `index.html`，找到：

```js
const WORKER_URL = "https://rss-aggregator.s01yg3642.workers.dev/api";
```

換成你自己的 Cloudflare Worker 網址。

---

## 📦 PWA 功能說明

| 功能 | 說明 |
|------|------|
| **離線快取** | Service Worker Cache-first 快取 Shell 資源，離線仍可開啟 |
| **IndexedDB 持久化** | RSS 文章、來源設定、使用者偏好全存入 IDB，48h TTL 自動清除 |
| **增量更新** | 5 分鐘快取新鮮期，同頁多次刷新不重複打 API |
| **Background Sync** | 離線期間排隊，網路恢復後自動同步 RSS |
| **Periodic Sync** | 每 30 分鐘靜默背景刷新（需瀏覽器授權） |
| **安裝橫幅** | 5 秒後自動顯示「加入主畫面」提示 |
| **離線提示** | 斷網時頂部顯示橙色提示列 |
| **更新通知** | 有新版 SW 時右上角顯示「點此更新」 |
| **Push 通知** | 預留 push handler，搭配後端可實現關鍵字通知 |

---

## 🛠 IndexedDB Schema

```
DB: johnnews  (version 2)
├── articles     keyPath: id (hash)
│   ├── index: by_pubDate
│   ├── index: by_source
│   └── index: by_fetchedAt  ← 用於 TTL 清除
├── sources      keyPath: key
├── userdata     keyPath: id  (singleton: 'me')
│   ├── bookmarks: []
│   ├── readIds: []
│   ├── keywords: []
│   └── prefs: {}
└── meta         keyPath: key
    ├── lastSync  (timestamp)
    └── swVersion
```

---

## 📱 iOS Safari 特別說明

iOS Safari 的 Service Worker 支援有限制：
- 不支援 Background Sync
- 不支援 Push Notification（需使用 APNs）
- PWA 安裝方式：Safari → 分享 → 加入主畫面

離線快取和 IndexedDB 持久化在 iOS Safari 均正常運作。

---

## 🔧 客製化

### 修改來源清單
在 `index.html` 找到 `const SOURCES = [...]`，按照格式增減來源。

### 修改文章快取時間
在 `index.html` 找到：
```js
await pruneArticles(48);  // 改成你要的小時數
```

### 修改快取新鮮期
```js
const STALE_MS = 5 * 60_000;  // 5分鐘，改成 0 可強制每次打 API
```
