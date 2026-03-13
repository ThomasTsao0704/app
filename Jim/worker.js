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
  // ── 深度調查與社會議題
  { url: "https://feeds.bbci.co.uk/news/rss.xml",                                   name: "BBC News",            color: "#e04040", group: "深度調查" },
  { url: "https://hnrss.org/frontpage",                                              name: "Hacker News",         color: "#e08040", group: "深度調查" },

  // ── 國際財經
  { url: "https://feeds.bloomberg.com/markets/news.rss",                            name: "Bloomberg Markets",   color: "#2060b0", group: "國際財經" },
  { url: "https://www.bis.org/doclist/all_statistics.rss",                          name: "BIS Statistics",      color: "#3050a0", group: "國際財經" },
  { url: "https://www.bis.org/doclist/all_pressrels.rss",                           name: "BIS Press Releases",  color: "#4070c0", group: "國際財經" },

  // ── 財經科技產業
  { url: "https://pansci.asia/feed",                                                 name: "泛科學",              color: "#30a0b8", group: "科普知識" },
  { url: "https://technews.tw/feed/",                                                name: "科技新報",            color: "#30b8c8", group: "財經科技" },
  { url: "https://www.twse.com.tw/rwd/zh/news/feed?type=rss",                        name: "臺灣證券交易所",       color: "#e8a020", group: "財經科技" },

  // ── 電子時報·科技產業
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_10_0.xml",               name: "DT 科技/產業",        color: "#c04040", group: "電子時報·產業" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_10_10.xml",              name: "DT IT系統供應鏈",     color: "#c04848", group: "電子時報·產業" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_10_30.xml",              name: "DT 光電顯示光學",     color: "#c05050", group: "電子時報·產業" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_10_40.xml",              name: "DT 半導體零組件",     color: "#c85050", group: "電子時報·產業" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_10_50.xml",              name: "DT 物聯科技智慧製造", color: "#c85858", group: "電子時報·產業" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_10_60.xml",              name: "DT AI智慧應用電商",   color: "#d05858", group: "電子時報·產業" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_10_70.xml",              name: "DT 行動通訊XR",       color: "#d06060", group: "電子時報·產業" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_10_90.xml",              name: "DT CarTech綠能",      color: "#d06868", group: "電子時報·產業" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_10_100.xml",             name: "DT 航太衛星軍工",     color: "#d07070", group: "電子時報·產業" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_10_110.xml",             name: "DT 科技政策",         color: "#d07878", group: "電子時報·產業" },

  // ── 電子時報·研究報告
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_30_0.xml",               name: "DT Research",         color: "#3878c0", group: "電子時報·研究" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_30_1.xml",               name: "DT 電腦運算",         color: "#3880c8", group: "電子時報·研究" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_30_3.xml",               name: "DT 智慧家庭",         color: "#3888c8", group: "電子時報·研究" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_30_5.xml",               name: "DT 智慧穿戴",         color: "#4088c8", group: "電子時報·研究" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_30_6.xml",               name: "DT 行動裝置應用",     color: "#4090d0", group: "電子時報·研究" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_30_7.xml",               name: "DT 寬頻無線",         color: "#4898d0", group: "電子時報·研究" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_30_9.xml",               name: "DT 顯示科技應用",     color: "#4898d8", group: "電子時報·研究" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_30_16.xml",              name: "DT IC設計",           color: "#50a0d8", group: "電子時報·研究" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_30_17.xml",              name: "DT IC製造",           color: "#50a0e0", group: "電子時報·研究" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_30_22.xml",              name: "DT 物聯網",           color: "#58a8e0", group: "電子時報·研究" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_30_23.xml",              name: "DT CarTech",          color: "#58a8e8", group: "電子時報·研究" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_30_24.xml",              name: "DT Cloud",            color: "#60b0e8", group: "電子時報·研究" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_30_25.xml",              name: "DT AI Focus",         color: "#60b0f0", group: "電子時報·研究" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_30_26.xml",              name: "DT 伺服器",           color: "#68b8f0", group: "電子時報·研究" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_30_27.xml",              name: "DT 次世代行動通訊",   color: "#68b8f8", group: "電子時報·研究" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_30_29.xml",              name: "DT 智慧製造",         color: "#70c0f8", group: "電子時報·研究" },

  // ── 電子時報·區域
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_90_0.xml",               name: "DT 科技/區域",        color: "#40a878", group: "電子時報·區域" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_90_300.xml",             name: "DT 東南亞",           color: "#40b080", group: "電子時報·區域" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_90_305.xml",             name: "DT 印度",             color: "#48b088", group: "電子時報·區域" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_90_310.xml",             name: "DT 東亞/中國",        color: "#48b890", group: "電子時報·區域" },
  { url: "https://www.digitimes.com.tw/tech/rss/xml/xmlrss_90_315.xml",             name: "DT 國際",             color: "#50b890", group: "電子時報·區域" },
];

const COUNT_PER_SOURCE = 6;


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
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
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
