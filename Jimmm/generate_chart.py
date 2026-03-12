"""
讀取 data.csv，生成 TradingView Lightweight Charts 自包含 HTML
民國曆 → 西元轉換，含完整工具列
"""

import pandas as pd
import json
from pathlib import Path

# ── 讀取 CSV ──────────────────────────────────────────────────
df = pd.read_csv("data.csv")
df.columns = df.columns.str.strip()
df["date"] = df["date"].astype(str).str.strip()

# ── 民國曆 → 西元日期 ─────────────────────────────────────────
def roc_to_iso(d: str) -> str:
    parts = d.split("/")
    year  = int(parts[0]) + 1911
    return f"{year}-{parts[1]}-{parts[2]}"

df["date_iso"] = df["date"].apply(roc_to_iso)
df = df.sort_values("date_iso").reset_index(drop=True)

# ── 數字欄位清理 ───────────────────────────────────────────────
for col in ["open", "high", "low", "close", "traded", "transaction", "transactions", "difference"]:
    df[col] = pd.to_numeric(df[col].astype(str).str.replace(",", "").str.strip(), errors="coerce")

# ── VWAP 均價 (transaction = 成交金額, traded = 成交股數) ──────
def add_avg(df: pd.DataFrame) -> pd.DataFrame:
    df["avg"] = 0.0
    mask = df["traded"] > 0
    df.loc[mask, "avg"] = (df.loc[mask, "transaction"] / df.loc[mask, "traded"]).round(2)
    return df

df = add_avg(df)

# ── 漲跌幅% (ChangePct = difference / (close - difference)) ───
def calculate_change_pct(df: pd.DataFrame) -> pd.DataFrame:
    close  = df["close"]
    change = df["difference"]
    base   = close - change
    mask   = (close > 0) & change.notna() & (base != 0)
    pct    = pd.Series(index=df.index, dtype=float)
    pct[mask] = (change[mask] / base[mask]) * 100
    df["change_pct"] = pct.round(2)
    return df

df = calculate_change_pct(df)

# ── 移動平均 ───────────────────────────────────────────────────
df["ma5"]  = df["close"].rolling(5).mean().round(2)
df["ma10"] = df["close"].rolling(10).mean().round(2)
df["ma20"] = df["close"].rolling(20).mean().round(2)
df["ma60"] = df["close"].rolling(60).mean().round(2)

# ── 短期均線 Avg01/12/012/123（升序，index 0 = 最舊）───────────
# Avg01  = (今日 + 昨日) / 2           rolling(2).mean()
# Avg12  = (昨日 + 前日) / 2           rolling(2).mean().shift(1)
# Avg012 = (今日 + 昨日 + 前日) / 3   rolling(3).mean()
# Avg123 = (昨日 + 前日 + 大前日) / 3 rolling(3).mean().shift(1)
df["avg01"]  = df["close"].rolling(2).mean().round(2)
df["avg12"]  = df["close"].rolling(2).mean().shift(1).round(2)
df["avg012"] = df["close"].rolling(3).mean().round(2)
df["avg123"] = df["close"].rolling(3).mean().shift(1).round(2)

# ── 轉成 JS 陣列 ──────────────────────────────────────────────
candles = []
for _, r in df.iterrows():
    if pd.notna(r["open"]) and pd.notna(r["close"]):
        def _f(key):
            v = r.get(key)
            return float(v) if pd.notna(v) and v != 0 else None
        candles.append({
            "time":       r["date_iso"],
            "open":       float(r["open"]),
            "high":       float(r["high"]),
            "low":        float(r["low"]),
            "close":      float(r["close"]),
            "change_pct": float(r["change_pct"]) if pd.notna(r.get("change_pct")) else 0.0,
            "avg":        _f("avg"),
            "avg01":      _f("avg01"),
            "avg12":      _f("avg12"),
            "avg012":     _f("avg012"),
            "avg123":     _f("avg123"),
            "traded":     int(r["traded"]) if pd.notna(r.get("traded")) else 0,
        })

volume = []
for _, r in df.iterrows():
    if pd.notna(r["traded"]):
        color = "rgba(38,166,154,0.6)" if r["close"] >= r["open"] else "rgba(239,83,80,0.6)"
        volume.append({"time": r["date_iso"], "value": float(r["traded"]), "color": color})

def ma_series(col):
    return [{"time": r["date_iso"], "value": round(float(r[col]), 2)}
            for _, r in df.iterrows() if pd.notna(r[col])]

# VWAP 均價線
vwap_data = [{"time": r["date_iso"], "value": float(r["avg"])}
             for _, r in df.iterrows() if pd.notna(r["avg"]) and r["avg"] > 0]

ma_data = {
    "ma5":   ma_series("ma5"),
    "ma10":  ma_series("ma10"),
    "ma20":  ma_series("ma20"),
    "ma60":  ma_series("ma60"),
    "avg01":  ma_series("avg01"),
    "avg12":  ma_series("avg12"),
    "avg012": ma_series("avg012"),
    "avg123": ma_series("avg123"),
}

# ── HTML 模板 ─────────────────────────────────────────────────
html = f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>0050 K線圖</title>
<script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ background: #131722; color: #d1d4dc; font-family: -apple-system, sans-serif; display: flex; flex-direction: column; height: 100vh; }}

  /* ── 工具列 ── */
  #toolbar {{
    display: flex; align-items: center; gap: 6px;
    padding: 6px 12px; background: #1e2130; border-bottom: 1px solid #2a2e39;
    flex-wrap: wrap;
  }}
  #toolbar .sep {{ width: 1px; height: 24px; background: #2a2e39; margin: 0 4px; }}
  #toolbar .title {{ font-size: 14px; font-weight: 600; color: #fff; margin-right: 8px; }}
  button.tb {{
    background: #2a2e39; border: none; color: #d1d4dc;
    padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;
    transition: background .15s;
  }}
  button.tb:hover {{ background: #363c4e; }}
  button.tb.active {{ background: #2962ff; color: #fff; }}
  select.tb {{
    background: #2a2e39; border: 1px solid #363c4e; color: #d1d4dc;
    padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer;
  }}
  .ma-dot {{ display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }}

  /* ── 圖表區 ── */
  #charts {{ flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }}
  #main-chart {{ flex: 3; position: relative; min-height: 0; }}
  #vol-chart  {{ flex: 1; border-top: 1px solid #2a2e39; min-height: 0; }}

  /* ── 回測統計面板 ── */
  #stats-panel {{
    flex-shrink: 0;
    background: #1a1d2b;
    border-top: 1px solid #2a2e39;
    padding: 8px 14px;
    display: flex; align-items: center; gap: 0;
    overflow-x: auto;
    font-size: 12px;
    height: 64px;
    white-space: nowrap;
  }}
  #stats-panel::-webkit-scrollbar {{ height: 4px; }}
  #stats-panel::-webkit-scrollbar-thumb {{ background: #363c4e; border-radius: 2px; }}
  .stat-card {{
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-width: 90px; padding: 0 14px;
    border-right: 1px solid #2a2e39;
    line-height: 1.5;
  }}
  .stat-card:last-child {{ border-right: none; }}
  .stat-label {{ color: #5d6673; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; }}
  .stat-val   {{ color: #d1d4dc; font-size: 13px; font-weight: 600; }}
  .stat-val.up  {{ color: #26a69a; }}
  .stat-val.dn  {{ color: #ef5350; }}
  .stat-val.warn {{ color: #ff9800; }}
  .stat-period {{ color: #5d6673; font-size: 11px; padding-right: 14px; border-right: 1px solid #2a2e39; min-width: 160px; line-height: 1.6; }}

  /* ── 進出場計算器 ── */
  #trade-panel {{
    flex-shrink: 0;
    background: #161b27;
    border-top: 1px solid #2a2e39;
    padding: 8px 14px;
    display: none;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 12px;
  }}
  #trade-panel.open {{ display: flex; }}
  .tp-group {{
    display: flex; flex-direction: column; gap: 3px;
  }}
  .tp-label {{ color: #5d6673; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }}
  .tp-input {{
    background: #2a2e39; border: 1px solid #363c4e; color: #d1d4dc;
    padding: 4px 8px; border-radius: 4px; font-size: 12px; width: 90px;
    outline: none;
  }}
  .tp-input:focus {{ border-color: #2962ff; }}
  .tp-sep {{ width: 1px; height: 40px; background: #2a2e39; align-self: center; margin: 0 4px; }}
  .tp-result {{
    display: flex; flex-direction: column; align-items: center;
    min-width: 100px; padding: 0 12px; border-right: 1px solid #2a2e39;
    line-height: 1.5;
  }}
  .tp-result:last-of-type {{ border-right: none; }}
  .tp-rlabel {{ color: #5d6673; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }}
  .tp-rval   {{ font-size: 13px; font-weight: 600; color: #d1d4dc; }}
  .tp-rval.up  {{ color: #26a69a; }}
  .tp-rval.dn  {{ color: #ef5350; }}
  .tp-rval.neu {{ color: #ff9800; }}

  /* ── 十字線資訊 ── */
  #tooltip {{
    position: absolute; top: 8px; left: 60px; z-index: 10;
    background: rgba(19,23,34,.85); border: 1px solid #2a2e39;
    border-radius: 4px; padding: 6px 10px; font-size: 12px;
    pointer-events: none; line-height: 1.7;
  }}
  #tooltip span {{ margin-right: 10px; }}
  .up {{ color: #26a69a; }} .dn {{ color: #ef5350; }}
</style>
</head>
<body>

<!-- ══ 工具列 ══ -->
<div id="toolbar">
  <span class="title">0050 元大台灣50</span>
  <div class="sep"></div>

  <!-- 時間區間 -->
  <button class="tb" onclick="setRange(30)">1M</button>
  <button class="tb" onclick="setRange(90)">3M</button>
  <button class="tb" onclick="setRange(180)">6M</button>
  <button class="tb" onclick="setRange(365)">1Y</button>
  <button class="tb" onclick="setRange(365*3)">3Y</button>
  <button class="tb" onclick="setRange(365*5)">5Y</button>
  <button class="tb active" onclick="fitAll()">全部</button>
  <div class="sep"></div>

  <!-- 圖表類型 -->
  <button class="tb active" id="btn-candle" onclick="setType('candle')">K線</button>
  <button class="tb" id="btn-bar"    onclick="setType('bar')">Bar</button>
  <button class="tb" id="btn-line"   onclick="setType('line')">折線</button>
  <button class="tb" id="btn-area"   onclick="setType('area')">區域</button>
  <div class="sep"></div>

  <!-- 均線切換 -->
  <button class="tb active" id="ma5-btn"  onclick="toggleMA('ma5')">
    <span class="ma-dot" style="background:#f6c85f"></span>MA5</button>
  <button class="tb active" id="ma10-btn" onclick="toggleMA('ma10')">
    <span class="ma-dot" style="background:#ff9800"></span>MA10</button>
  <button class="tb active" id="ma20-btn" onclick="toggleMA('ma20')">
    <span class="ma-dot" style="background:#e91e63"></span>MA20</button>
  <button class="tb active" id="ma60-btn" onclick="toggleMA('ma60')">
    <span class="ma-dot" style="background:#9c27b0"></span>MA60</button>
  <button class="tb active" id="vwap-btn" onclick="toggleVWAP()">
    <span class="ma-dot" style="background:#00bcd4"></span>均價</button>
  <div class="sep"></div>

  <!-- 短期均線 Tick -->
  <button class="tb active" id="avg12-btn"  onclick="toggleAvg12()">
    <span class="ma-dot" style="background:#c709e7"></span>Avg12</button>
  <button class="tb active" id="avg123-btn" onclick="toggleAvg123()">
    <span class="ma-dot" style="background:#0dff3b"></span>Avg123</button>
  <button class="tb" id="avg01-btn"  onclick="toggleAvg01()">
    <span class="ma-dot" style="background:#80cbc4"></span>Avg01</button>
  <button class="tb" id="avg012-btn" onclick="toggleAvg012()">
    <span class="ma-dot" style="background:#26a69a"></span>Avg012</button>
  <div class="sep"></div>

  <!-- 對數刻度 -->
  <button class="tb" id="btn-log" onclick="toggleLog()">對數</button>

  <!-- 十字線模式 -->
  <select class="tb" id="crosshair-mode" onchange="setCrosshair(this.value)">
    <option value="1">十字線</option>
    <option value="2">磁力</option>
    <option value="0">隱藏</option>
  </select>
  <div class="sep"></div>

  <!-- 截圖 -->
  <button class="tb" onclick="screenshot()">📷 截圖</button>
  <div class="sep"></div>

  <!-- 進出場計算器 -->
  <button class="tb" id="btn-trade" onclick="toggleTrade()">📊 進出場計算</button>
</div>

<!-- ══ 圖表區 ══ -->
<div id="charts">
  <div id="main-chart">
    <div id="tooltip"></div>
  </div>
  <div id="vol-chart"></div>
</div>

<!-- ══ 進出場計算器 ══ -->
<div id="trade-panel">
  <!-- 輸入區 -->
  <div class="tp-group">
    <span class="tp-label">進場價</span>
    <input class="tp-input" id="tp-entry" type="number" step="0.01" placeholder="e.g. 120.5" oninput="calcTrade()">
  </div>
  <div class="tp-group">
    <span class="tp-label">出場價（空=現價）</span>
    <input class="tp-input" id="tp-exit" type="number" step="0.01" placeholder="e.g. 135.0" oninput="calcTrade()">
  </div>
  <div class="tp-group">
    <span class="tp-label">股數（張×1000）</span>
    <input class="tp-input" id="tp-shares" type="number" step="1000" value="1000" oninput="calcTrade()">
  </div>
  <div class="tp-group">
    <span class="tp-label">手續費率%</span>
    <input class="tp-input" id="tp-fee" type="number" step="0.001" value="0.1425" oninput="calcTrade()">
  </div>
  <div class="tp-group">
    <span class="tp-label">交易稅率%（ETF=0.1）</span>
    <input class="tp-input" id="tp-tax" type="number" step="0.01" value="0.1" oninput="calcTrade()">
  </div>
  <div class="tp-sep"></div>

  <!-- 計算結果 -->
  <div class="tp-result"><span class="tp-rlabel">淨損益</span><span class="tp-rval" id="tr-pnl">—</span></div>
  <div class="tp-result"><span class="tp-rlabel">損益%</span><span class="tp-rval" id="tr-pct">—</span></div>
  <div class="tp-result"><span class="tp-rlabel">盈虧平衡價</span><span class="tp-rval neu" id="tr-be">—</span></div>
  <div class="tp-result"><span class="tp-rlabel">進場成本</span><span class="tp-rval" id="tr-cost">—</span></div>
  <div class="tp-result"><span class="tp-rlabel">出場所得</span><span class="tp-rval" id="tr-recv">—</span></div>
  <div class="tp-result"><span class="tp-rlabel">手續費</span><span class="tp-rval" id="tr-fee">—</span></div>
  <div class="tp-result"><span class="tp-rlabel">交易稅</span><span class="tp-rval" id="tr-tax">—</span></div>
</div>

<!-- ══ 回測統計面板 ══ -->
<div id="stats-panel">
  <div class="stat-period" id="stat-period">載入中…</div>
  <div class="stat-card"><span class="stat-label">期間報酬</span><span class="stat-val" id="s-ret">—</span></div>
  <div class="stat-card"><span class="stat-label">年化報酬</span><span class="stat-val" id="s-ann">—</span></div>
  <div class="stat-card"><span class="stat-label">最大回撤</span><span class="stat-val" id="s-mdd">—</span></div>
  <div class="stat-card"><span class="stat-label">年化波動率</span><span class="stat-val" id="s-vol">—</span></div>
  <div class="stat-card"><span class="stat-label">夏普比率</span><span class="stat-val" id="s-sharpe">—</span></div>
  <div class="stat-card"><span class="stat-label">勝率</span><span class="stat-val" id="s-win">—</span></div>
  <div class="stat-card"><span class="stat-label">最大單日漲</span><span class="stat-val up" id="s-best">—</span></div>
  <div class="stat-card"><span class="stat-label">最大單日跌</span><span class="stat-val dn" id="s-worst">—</span></div>
  <div class="stat-card"><span class="stat-label">交易天數</span><span class="stat-val" id="s-days">—</span></div>
</div>

<script>
// ── 資料 ──────────────────────────────────────────────────────
const candleData  = {json.dumps(candles)};
const volumeData  = {json.dumps(volume)};
const maData      = {json.dumps(ma_data)};
const vwapData    = {json.dumps(vwap_data)};
// candleData 同時含有 change_pct / avg / traded 供 tooltip 使用
const candleMap   = Object.fromEntries(candleData.map(d => [d.time, d]));

// ── 共用選項 ──────────────────────────────────────────────────
const chartOpts = (el) => ({{
  layout: {{ background: {{ color: '#131722' }}, textColor: '#d1d4dc' }},
  grid:   {{ vertLines: {{ color: '#1e2130' }}, horzLines: {{ color: '#1e2130' }} }},
  crosshair: {{ mode: LightweightCharts.CrosshairMode.Normal }},
  rightPriceScale: {{ borderColor: '#2a2e39' }},
  timeScale: {{ borderColor: '#2a2e39', timeVisible: true }},
  container: el,
}});

// ── 主圖 ──────────────────────────────────────────────────────
const mainEl = document.getElementById('main-chart');
const mainChart = LightweightCharts.createChart(mainEl, {{
  ...chartOpts(mainEl),
  width:  mainEl.clientWidth,
  height: mainEl.clientHeight,
}});

// K線
let mainSeries = mainChart.addCandlestickSeries({{
  upColor: '#26a69a', downColor: '#ef5350',
  borderUpColor: '#26a69a', borderDownColor: '#ef5350',
  wickUpColor: '#26a69a', wickDownColor: '#ef5350',
}});
mainSeries.setData(candleData);

// 均線（長期 line series）
const maColors = {{ ma5:'#f6c85f', ma10:'#ff9800', ma20:'#e91e63', ma60:'#9c27b0' }};
const maSeries = {{}};
for (const [key, color] of Object.entries(maColors)) {{
  maSeries[key] = mainChart.addLineSeries({{
    color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
  }});
  maSeries[key].setData(maData[key]);
}}

// ── 短期均線 Tick（短橫線，open=high=low=close=value）──────────
const TICK_CFG = [
  {{ key: 'avg',    color: '#00b0f0', btnId: 'vwap-btn',   defaultOn: true  }},
  {{ key: 'avg12',  color: '#c709e7', btnId: 'avg12-btn',  defaultOn: true  }},
  {{ key: 'avg123', color: '#0dff3b', btnId: 'avg123-btn', defaultOn: true  }},
  {{ key: 'avg01',  color: '#80cbc4', btnId: 'avg01-btn',  defaultOn: false }},
  {{ key: 'avg012', color: '#26a69a', btnId: 'avg012-btn', defaultOn: false }},
];
const toTick = key => candleData
  .filter(d => d[key] !== null && d[key] !== undefined)
  .map(d => ({{ time: d.time, open: d[key], high: d[key], low: d[key], close: d[key] }}));

const tickSeries = {{}};
for (const {{ key, color, defaultOn }} of TICK_CFG) {{
  const s = mainChart.addCandlestickSeries({{
    upColor: color, downColor: color,
    borderUpColor: color, borderDownColor: color,
    wickUpColor: color, wickDownColor: color,
    priceLineVisible: false, lastValueVisible: false,
    visible: defaultOn,
  }});
  s.setData(toTick(key));
  tickSeries[key] = s;
  if (!defaultOn) {{
    document.getElementById(key.replace('avg','avg')+'-btn')
      ?.classList.remove('active');
  }}
}}

// ── 成交量圖 ──────────────────────────────────────────────────
const volEl = document.getElementById('vol-chart');
const volChart = LightweightCharts.createChart(volEl, {{
  ...chartOpts(volEl),
  width:  volEl.clientWidth,
  height: volEl.clientHeight,
  rightPriceScale: {{ scaleMargins: {{ top: 0.1, bottom: 0 }} }},
}});
const volSeries = volChart.addHistogramSeries({{
  priceFormat: {{ type: 'volume' }},
  priceScaleId: 'right',
}});
volSeries.setData(volumeData);

// ── 時間軸同步 ────────────────────────────────────────────────
mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {{
  if (range) volChart.timeScale().setVisibleLogicalRange(range);
}});
volChart.timeScale().subscribeVisibleLogicalRangeChange(range => {{
  if (range) mainChart.timeScale().setVisibleLogicalRange(range);
}});

// ── Tooltip ───────────────────────────────────────────────────
const tooltip = document.getElementById('tooltip');
mainChart.subscribeCrosshairMove(param => {{
  if (!param.time) {{ tooltip.style.display = 'none'; return; }}

  // 遍歷 seriesData，找第一個含 OHLC 的項目（不依賴 mainSeries 引用）
  let d = null;
  param.seriesData.forEach((v) => {{
    if (!d && v != null && v.open !== undefined) d = v;
  }});
  // 若沒有 OHLC（折線/區域模式），改用 value
  if (!d) {{
    param.seriesData.forEach((v) => {{
      if (!d && v != null && v.value !== undefined) d = v;
    }});
    if (!d) {{ tooltip.style.display = 'none'; return; }}
    tooltip.style.display = 'block';
    tooltip.innerHTML = `<span><b>${{param.time}}</b></span><span>收 <b>${{d.value}}</b></span>`;
    return;
  }}

  const o = +d.open, h = +d.high, l = +d.low, c = +d.close;
  const extra  = candleMap[param.time] || {{}};
  const chg    = (c - o).toFixed(2);
  const pct    = extra.change_pct != null ? extra.change_pct.toFixed(2) : (((c-o)/o)*100).toFixed(2);
  const avgVal = extra.avg  ? extra.avg.toFixed(2)                      : '-';
  const vol    = extra.traded ? extra.traded.toLocaleString()            : '-';
  const cls    = c >= o ? 'up' : 'dn';
  const sign   = chg >= 0 ? '+' : '';
  tooltip.style.display = 'block';
  tooltip.innerHTML = `
    <span><b>${{param.time}}</b></span>
    <span>開 <b class="${{cls}}">${{o}}</b></span>
    <span>高 <b class="${{cls}}">${{h}}</b></span>
    <span>低 <b class="${{cls}}">${{l}}</b></span>
    <span>收 <b class="${{cls}}">${{c}}</b></span>
    <span class="${{cls}}">${{sign}}${{chg}} (${{pct}}%)</span>
    <span style="color:#00bcd4">均價 ${{avgVal}}</span>
    <span style="color:#888">量 ${{vol}}</span>
  `;
}});

// ── RWD resize ────────────────────────────────────────────────
const ro = new ResizeObserver(() => {{
  mainChart.resize(mainEl.clientWidth, mainEl.clientHeight);
  volChart.resize(volEl.clientWidth, volEl.clientHeight);
}});
ro.observe(mainEl); ro.observe(volEl);

// ── 工具列功能 ────────────────────────────────────────────────
function fitAll() {{
  mainChart.timeScale().fitContent();
  ['1M','3M','6M','1Y','3Y','5Y','全部'].forEach(t => {{
    document.querySelectorAll('.tb').forEach(b => {{
      if (b.textContent === '全部') b.classList.add('active');
      else if (['1M','3M','6M','1Y','3Y','5Y'].includes(b.textContent)) b.classList.remove('active');
    }});
  }});
}}

function setRange(days) {{
  const all = mainChart.timeScale().getVisibleRange();
  const to  = candleData[candleData.length-1].time;
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  mainChart.timeScale().setVisibleRange({{
    from: from.toISOString().slice(0,10), to
  }});
}}

let currentType = 'candle';
function setType(type) {{
  currentType = type;
  ['candle','bar','line','area'].forEach(t => document.getElementById('btn-'+t)?.classList.remove('active'));
  document.getElementById('btn-'+type)?.classList.add('active');

  mainChart.removeSeries(mainSeries);
  if (type === 'candle') {{
    mainSeries = mainChart.addCandlestickSeries({{
      upColor:'#26a69a', downColor:'#ef5350',
      borderUpColor:'#26a69a', borderDownColor:'#ef5350',
      wickUpColor:'#26a69a', wickDownColor:'#ef5350',
    }});
  }} else if (type === 'bar') {{
    mainSeries = mainChart.addBarSeries({{ upColor:'#26a69a', downColor:'#ef5350' }});
  }} else if (type === 'line') {{
    mainSeries = mainChart.addLineSeries({{ color:'rgba(41,98,255,0.5)', lineWidth:2 }});
    mainSeries.setData(candleData.map(d => ({{ time:d.time, value:d.close }})));
    return;
  }} else if (type === 'area') {{
    mainSeries = mainChart.addAreaSeries({{
      lineColor:'#2962ff', topColor:'rgba(41,98,255,.3)', bottomColor:'rgba(41,98,255,0)',
    }});
    mainSeries.setData(candleData.map(d => ({{ time:d.time, value:d.close }})));
    return;
  }}
  mainSeries.setData(candleData);
}}

function toggleMA(key) {{
  const btn = document.getElementById(key+'-btn');
  if (maSeries[key].options().visible === false) {{
    maSeries[key].applyOptions({{ visible: true }});
    btn.classList.add('active');
  }} else {{
    maSeries[key].applyOptions({{ visible: false }});
    btn.classList.remove('active');
  }}
}}

// 均價/Avg12/Avg123 tick 切換（統一用 tickSeries）
function toggleVWAP()   {{ toggleTick('avg',    'vwap-btn');   }}
function toggleAvg01()  {{ toggleTick('avg01',  'avg01-btn');  }}
function toggleAvg12()  {{ toggleTick('avg12',  'avg12-btn');  }}
function toggleAvg012() {{ toggleTick('avg012', 'avg012-btn'); }}
function toggleAvg123() {{ toggleTick('avg123', 'avg123-btn'); }}
function toggleTick(key, btnId) {{
  const s = tickSeries[key];
  if (!s) return;
  const visible = s.options().visible !== false;
  s.applyOptions({{ visible: !visible }});
  document.getElementById(btnId)?.classList.toggle('active', !visible);
}}

let logScale = false;
function toggleLog() {{
  logScale = !logScale;
  mainChart.priceScale('right').applyOptions({{ mode: logScale ? 1 : 0 }});
  document.getElementById('btn-log').classList.toggle('active', logScale);
}}

function setCrosshair(val) {{
  const mode = [
    LightweightCharts.CrosshairMode.Hidden,
    LightweightCharts.CrosshairMode.Normal,
    LightweightCharts.CrosshairMode.Magnet,
  ][parseInt(val)];
  mainChart.applyOptions({{ crosshair: {{ mode }} }});
  volChart.applyOptions({{ crosshair: {{ mode }} }});
}}

function screenshot() {{
  const canvas = mainChart.takeScreenshot();
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = '0050_chart.png';
  a.click();
}}

// ── 進出場計算器 ──────────────────────────────────────────────
let entryPriceLine = null, exitPriceLine = null, bePriceLine = null;

function toggleTrade() {{
  const panel = document.getElementById('trade-panel');
  const btn   = document.getElementById('btn-trade');
  panel.classList.toggle('open');
  btn.classList.toggle('active');
  if (!panel.classList.contains('open')) {{
    // 面板關閉：移除圖表標線
    [entryPriceLine, exitPriceLine, bePriceLine].forEach(l => {{
      if (l) {{ try {{ mainSeries.removePriceLine(l); }} catch(e){{}} }}
    }});
    entryPriceLine = exitPriceLine = bePriceLine = null;
  }}
}}

function calcTrade() {{
  const entry  = parseFloat(document.getElementById('tp-entry').value);
  const shares = parseFloat(document.getElementById('tp-shares').value) || 1000;
  const feeR   = parseFloat(document.getElementById('tp-fee').value)    / 100 || 0.001425;
  const taxR   = parseFloat(document.getElementById('tp-tax').value)    / 100 || 0.001;

  // 出場價：若未填則用最後一根收盤
  const exitInput = document.getElementById('tp-exit').value;
  const lastClose = candleData[candleData.length - 1].close;
  const exit = exitInput !== '' ? parseFloat(exitInput) : lastClose;

  if (!entry || isNaN(entry)) {{
    ['tr-pnl','tr-pct','tr-be','tr-cost','tr-recv','tr-fee','tr-tax'].forEach(id => {{
      document.getElementById(id).textContent = '—';
      document.getElementById(id).className = 'tp-rval';
    }});
    return;
  }}

  // 最低手續費 20 元
  const minFee = 20;
  const feeBuy  = Math.max(entry * shares * feeR,  minFee);
  const feeSell = Math.max(exit  * shares * feeR,  minFee);
  const taxAmt  = exit * shares * taxR;

  const cost  = entry * shares + feeBuy;           // 進場總成本
  const recv  = exit  * shares - feeSell - taxAmt; // 出場實得
  const pnl   = recv - cost;
  const pct   = (pnl / cost) * 100;
  const be    = (cost / shares) / (1 - feeR - taxR); // 盈虧平衡出場價

  const fmt = v => Math.round(v).toLocaleString();
  const setR = (id, text, cls) => {{
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = 'tp-rval' + (cls ? ' ' + cls : '');
  }};

  setR('tr-pnl',  (pnl >= 0 ? '+' : '') + fmt(pnl) + ' 元', pnl >= 0 ? 'up' : 'dn');
  setR('tr-pct',  (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%', pct >= 0 ? 'up' : 'dn');
  setR('tr-be',   be.toFixed(2), 'neu');
  setR('tr-cost', fmt(cost) + ' 元', '');
  setR('tr-recv', fmt(recv) + ' 元', '');
  setR('tr-fee',  fmt(feeBuy + feeSell) + ' 元', '');
  setR('tr-tax',  fmt(taxAmt) + ' 元', '');

  // ── 圖表標線 ──────────────────────────────────────────────
  if (entryPriceLine) try {{ mainSeries.removePriceLine(entryPriceLine); }} catch(e){{}}
  if (exitPriceLine)  try {{ mainSeries.removePriceLine(exitPriceLine);  }} catch(e){{}}
  if (bePriceLine)    try {{ mainSeries.removePriceLine(bePriceLine);    }} catch(e){{}}

  entryPriceLine = mainSeries.createPriceLine({{
    price: entry, color: '#26a69a', lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true, title: `進 ${{entry}}`,
  }});
  exitPriceLine = mainSeries.createPriceLine({{
    price: exit, color: pnl >= 0 ? '#ef5350' : '#ef5350', lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true, title: `出 ${{exit}}`,
  }});
  bePriceLine = mainSeries.createPriceLine({{
    price: be, color: '#ff9800', lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.SparseDotted,
    axisLabelVisible: true, title: `損平 ${{be.toFixed(2)}}`,
  }});
}}

// ── 回測統計 ──────────────────────────────────────────────────
function calcStats(candles) {{
  if (candles.length < 2) return null;
  const first = candles[0].close, last = candles[candles.length-1].close;
  const totalRet = (last - first) / first * 100;

  // 日數（日曆天）
  const ms = new Date(candles[candles.length-1].time) - new Date(candles[0].time);
  const calDays = Math.max(ms / 86400000, 1);

  // 年化報酬
  const annRet = (Math.pow(last / first, 365 / calDays) - 1) * 100;

  // 日報酬率（用收盤價）
  const dailyR = [];
  for (let i = 1; i < candles.length; i++) {{
    dailyR.push((candles[i].close - candles[i-1].close) / candles[i-1].close);
  }}
  const mean = dailyR.reduce((a,b)=>a+b,0) / dailyR.length;
  const variance = dailyR.reduce((a,b)=>a+(b-mean)**2,0) / dailyR.length;
  const vol = Math.sqrt(variance) * Math.sqrt(252) * 100;

  // 夏普（rf = 2%）
  const sharpe = vol > 0 ? (annRet - 2.0) / vol : 0;

  // 最大回撤
  let mdd = 0, peak = candles[0].close;
  for (const c of candles) {{
    if (c.close > peak) peak = c.close;
    const dd = (peak - c.close) / peak * 100;
    if (dd > mdd) mdd = dd;
  }}

  // 勝率（收 >= 開）
  const upDays = candles.filter(d => d.close >= d.open).length;
  const winRate = upDays / candles.length * 100;

  // 單日最大漲跌（用開→收）
  const dayPct = candles.map(d => (d.close - d.open) / d.open * 100);
  const bestDay  = Math.max(...dayPct);
  const worstDay = Math.min(...dayPct);

  return {{ totalRet, annRet, vol, sharpe, mdd, winRate, bestDay, worstDay,
            tradingDays: candles.length,
            from: candles[0].time, to: candles[candles.length-1].time }};
}}

function fmtPct(v, decimals=2) {{
  const s = v.toFixed(decimals);
  return v >= 0 ? `+${{s}}%` : `${{s}}%`;
}}

function updateStats() {{
  const range = mainChart.timeScale().getVisibleRange();
  let vis;
  if (range) {{
    vis = candleData.filter(d => d.time >= range.from && d.time <= range.to);
  }} else {{
    vis = candleData;
  }}
  if (vis.length < 2) return;
  const s = calcStats(vis);
  if (!s) return;

  // 期間文字
  document.getElementById('stat-period').innerHTML =
    `${{s.from}}<br>~ ${{s.to}}`;

  const setVal = (id, text, cls) => {{
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = 'stat-val' + (cls ? ' ' + cls : '');
  }};

  setVal('s-ret',    fmtPct(s.totalRet),   s.totalRet >= 0 ? 'up' : 'dn');
  setVal('s-ann',    fmtPct(s.annRet),     s.annRet   >= 0 ? 'up' : 'dn');
  setVal('s-mdd',    `-${{s.mdd.toFixed(2)}}%`, s.mdd > 20 ? 'dn' : s.mdd > 10 ? 'warn' : '');
  setVal('s-vol',    `${{s.vol.toFixed(2)}}%`,  s.vol > 30 ? 'warn' : '');
  setVal('s-sharpe', s.sharpe.toFixed(2),  s.sharpe >= 1 ? 'up' : s.sharpe < 0 ? 'dn' : '');
  setVal('s-win',    `${{s.winRate.toFixed(1)}}%`, s.winRate >= 50 ? 'up' : 'dn');
  setVal('s-best',   fmtPct(s.bestDay),    'up');
  setVal('s-worst',  fmtPct(s.worstDay),   'dn');
  setVal('s-days',   s.tradingDays,        '');
}}

mainChart.timeScale().subscribeVisibleRangeChange(updateStats);

// 預設全部
fitAll();
setTimeout(updateStats, 100);
</script>
</body>
</html>
"""

out = Path("0050_chart.html")
out.write_text(html, encoding="utf-8")
print(f"生成完成：{out.resolve()}")
