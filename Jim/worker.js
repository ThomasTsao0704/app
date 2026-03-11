// ============================================================
//  RSS Aggregator · Cloudflare Worker
//  部署後即可用：https://<你的worker>.workers.dev/api
// ============================================================
//
//  設定步驟：
//  1. wrangler kv:namespace create RSS_CACHE
//     → 把輸出的 id 填入下方 wrangler.toml
//  2. wrangler deploy
//
//  wrangler.toml 範例：
//  ───────────────────────────────────────
//  name = "rss-aggregator"
//  main = "worker.js"
//  compatibility_date = "2024-01-01"
//
//  Uploaded rss-aggregator (8.30 sec)
//  Deployed rss-aggregator triggers (3.93 sec)
//  https://rss-aggregator.s01yg3642.workers.dev
//  Current Version ID: 0110b67b-8841-4070-a2d1-61f81ef68610
//  ───────────────────────────────────────

const CACHE_TTL_SECONDS = 15 * 60; // 15 分鐘

const SOURCES = [
  // ── 深度調查
  { url: "https://www.twreporter.org/a/rss.xml",        name: "報導者",        color: "#e05050", group: "深度調查" },
  { url: "https://theinitium.com/misc/rss/",            name: "端傳媒",        color: "#5090d0", group: "深度調查" },
  { url: "https://www.eventsinfocus.org/rss.xml",       name: "焦點事件",      color: "#9070c0", group: "深度調查" },
  // ── 國際視野
  { url: "https://global.udn.com/rss/news/1020/7178",  name: "轉角國際",      color: "#3ab0a0", group: "國際視野" },
  { url: "https://dq.yam.com/rss.php",                  name: "地球圖輯隊",    color: "#50b870", group: "國際視野" },
  { url: "https://www.wainao.me/rss.xml",               name: "歪腦 WhyNot",  color: "#e08040", group: "國際視野" },
  // ── 財經科技
  { url: "https://technews.tw/feed/",                   name: "科技新報",      color: "#30b8c8", group: "財經科技" },
  { url: "https://www.bnext.com.tw/feed/",              name: "數位時代",      color: "#4878d0", group: "財經科技" },
  { url: "https://daodu.tech/feed",                     name: "科技島讀",      color: "#8060c0", group: "財經科技" },
  { url: "https://ctee.com.tw/feed/",                   name: "工商時報",      color: "#d05050", group: "財經科技" },
  { url: "https://money.udn.com/rss/news/1001/5588/",  name: "經濟日報",      color: "#50a060", group: "財經科技" },
  { url: "https://www.wealth.com.tw/rss.xml",           name: "財訊",          color: "#c0a030", group: "財經科技" },
  // ── 科普知識
  { url: "https://pansci.asia/feed",                    name: "泛科學",        color: "#30a0b8", group: "科普知識" },
  { url: "https://plainlaw.me/feed/",                   name: "法律白話文",    color: "#5080c0", group: "科普知識" },
  { url: "https://pnn.pts.org.tw/rss",                  name: "公視新聞",      color: "#40a860", group: "科普知識" },
  { url: "https://opinion.cw.com.tw/rss/opinion",       name: "獨立評論@天下", color: "#e07030", group: "科普知識" },
];

const COUNT_PER_SOURCE = 6;

// ============================================================
//  Worker Entry Point
// ============================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return corsResponse(new Response(null, { status: 204 }));
    }

    // 只處理 /api 路徑
    if (url.pathname !== "/api" && url.pathname !== "/api/") {
      return new Response("Not found", { status: 404 });
    }

    // 可選：指定單一 source，例如 /api?source=報導者
    const sourceName = url.searchParams.get("source");
    const targets = sourceName
      ? SOURCES.filter(s => s.name === sourceName)
      : SOURCES;

    const cacheKey = "rss:" + (sourceName || "ALL");

    // ── 1. 嘗試讀取 KV 快取
    if (env.RSS_CACHE) {
      try {
        const cached = await env.RSS_CACHE.get(cacheKey);
        if (cached) {
          return corsResponse(
            new Response(cached, {
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "X-Cache": "HIT",
              },
            })
          );
        }
      } catch (e) {
        console.error("KV read error:", e.message);
      }
    }

    // ── 2. 並行抓取所有 RSS
    const results = await Promise.all(
      targets.map(source => fetchAndParse(source))
    );

    const payload = JSON.stringify({
      ok: true,
      fetchedAt: new Date().toISOString(),
      sources: results,
    });

    // ── 3. 寫入 KV 快取（非阻塞）
    if (env.RSS_CACHE) {
      env.RSS_CACHE.put(cacheKey, payload, {
        expirationTtl: CACHE_TTL_SECONDS,
      }).catch(e => console.error("KV write error:", e.message));
    }

    return corsResponse(
      new Response(payload, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Cache": "MISS",
        },
      })
    );
  },
};

// ============================================================
//  Fetch + Parse 單一 RSS 來源
// ============================================================
async function fetchAndParse(source) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RSSBot/1.0)",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const xml = await res.text();
    const items = parseXML(xml);

    return {
      ...sourceMeta(source),
      ok: true,
      items,
    };
  } catch (e) {
    return {
      ...sourceMeta(source),
      ok: false,
      error: e.message,
      items: [],
    };
  }
}

function sourceMeta(s) {
  return { name: s.name, color: s.color, group: s.group, url: s.url };
}

// ============================================================
//  XML Parser（純字串，無需 DOM / DOMParser）
//  Workers runtime 沒有完整 DOMParser，用 regex 輕量解析
// ============================================================
function parseXML(xml) {
  // 判斷 Atom vs RSS
  const isAtom = /<feed[\s>]/i.test(xml);
  const itemTag = isAtom ? "entry" : "item";

  const items = [];
  const itemRegex = new RegExp(`<${itemTag}[\\s>]([\\s\\S]*?)<\\/${itemTag}>`, "gi");
  let match;

  while ((match = itemRegex.exec(xml)) !== null && items.length < COUNT_PER_SOURCE) {
    const block = match[1];

    const title     = decodeEntities(tag(block, "title"));
    const link      = atomLink(block) || tag(block, "link");
    const pubDate   = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated") || tag(block, "dc:date");
    const author    = atomAuthorName(block) || tag(block, "dc:creator") || tag(block, "author");
    const content   = tag(block, "content:encoded") || tag(block, "content") || tag(block, "description") || tag(block, "summary");
    const thumbnail = mediaThumbnail(block) || enclosureImage(block);

    if (!title || !link) continue;

    items.push({
      title:       stripHtml(title),
      link:        link.trim(),
      pubDate:     pubDate.trim(),
      author:      stripHtml(author),
      description: stripHtml(content).slice(0, 300),
      thumbnail,
    });
  }

  return items;
}

// ── Tag extractor（CDATA aware）
function tag(block, name) {
  const re = new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${name}>`, "i");
  const m  = re.exec(block);
  if (!m) return "";
  return (m[1] !== undefined ? m[1] : m[2] || "").trim();
}

// ── Atom <link href="...">
function atomLink(block) {
  const m = /<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i.exec(block);
  return m ? m[1] : "";
}

// ── Atom <author><name>...</name></author>
function atomAuthorName(block) {
  const m = /<author[^>]*>([\s\S]*?)<\/author>/i.exec(block);
  if (!m) return "";
  const n = /<name[^>]*>([\s\S]*?)<\/name>/i.exec(m[1]);
  return n ? n[1].trim() : "";
}

// ── media:thumbnail url="..."
function mediaThumbnail(block) {
  const m = /<media:thumbnail[^>]+url=["']([^"']+)["']/i.exec(block)
         || /<media:content[^>]+url=["']([^"']+)["'][^>]+type=["']image/i.exec(block);
  return m ? m[1] : "";
}

// ── <enclosure type="image/..." url="...">
function enclosureImage(block) {
  const m = /<enclosure[^>]+type=["']image\/[^"']*["'][^>]+url=["']([^"']+)["']/i.exec(block)
         || /<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image\/[^"']*["']/i.exec(block);
  return m ? m[1] : "";
}

// ── Strip HTML tags
function stripHtml(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ── Decode common HTML entities
function decodeEntities(str) {
  return str
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// ── CORS wrapper
function corsResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin",  "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, {
    status:  response.status,
    headers,
  });
}
