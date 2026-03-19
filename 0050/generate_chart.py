"""
掃描 data/ 資料夾所有 CSV，生成多資料集 K 線圖
支援日線（YYYYMMDD）和 60 分 K（YYYYMMDD HH:MM → Unix timestamp UTC+8）
工具列下拉選單切換資料集，不重新載入頁面
"""

import pandas as pd
import json
from pathlib import Path
from datetime import datetime, timedelta

DATA_DIR = Path("data")

# ── 時間轉換 ───────────────────────────────────────────────────
def parse_time(t: str):
    """YYYYMMDD HH:MM (UTC+8) → Unix seconds | YYYYMMDD → 'YYYY-MM-DD'"""
    t = str(t).strip()
    if " " in t:
        dt  = datetime.strptime(t, "%Y%m%d %H:%M")
        utc = dt - timedelta(hours=8)          # UTC+8 → UTC
        return int((utc - datetime(1970, 1, 1)).total_seconds())
    elif len(t) == 8 and t.isdigit():
        return f"{t[:4]}-{t[4:6]}-{t[6:]}"
    return t

# ── 讀取單一 CSV ────────────────────────────────────────────────
def load_csv(path: Path) -> dict:
    df = pd.read_csv(path, encoding="utf-8-sig")
    df.columns = df.columns.str.strip()

    tcol = "time" if "time" in df.columns else "date"
    df   = df.sort_values(tcol).reset_index(drop=True)

    for c in ["open", "high", "low", "close", "volume"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    sample      = str(df[tcol].iloc[0])
    is_intraday = " " in sample

    df["_ts"] = df[tcol].apply(parse_time)

    # 長期均線
    for n in [5, 10, 20, 60]:
        df[f"ma{n}"] = df["close"].rolling(n).mean().round(2)

    # 短期均線（若 CSV 已有且非全空則優先使用）
    for col in ["avg01", "avg12", "avg012", "avg123"]:
        if col not in df.columns:
            df[col] = None
    if df["avg01"].isna().all():
        df["avg01"]  = df["close"].rolling(2).mean().round(2)
        df["avg12"]  = df["close"].rolling(2).mean().shift(1).round(2)
        df["avg012"] = df["close"].rolling(3).mean().round(2)
        df["avg123"] = df["close"].rolling(3).mean().shift(1).round(2)

    if "avg" not in df.columns:
        df["avg"] = None

    def _f(r, k):
        v = r.get(k)
        return round(float(v), 2) if pd.notna(v) and v != 0 else None

    def build_candles(src: pd.DataFrame) -> list:
        rows = []
        for _, r in src.iterrows():
            if pd.isna(r["open"]) or pd.isna(r["close"]):
                continue
            rows.append({
                "time":   r["_ts"],
                "open":   float(r["open"]),
                "high":   float(r["high"]),
                "low":    float(r["low"]),
                "close":  float(r["close"]),
                "avg":    _f(r, "avg"),
                "avg01":  _f(r, "avg01"),
                "avg12":  _f(r, "avg12"),
                "avg012": _f(r, "avg012"),
                "avg123": _f(r, "avg123"),
            })
        return rows

    def build_volume(src: pd.DataFrame) -> list:
        rows = []
        for _, r in src.iterrows():
            vol = r.get("volume")
            if pd.isna(vol):
                continue
            color = "rgba(38,166,154,0.6)" if r["close"] >= r["open"] else "rgba(239,83,80,0.6)"
            rows.append({"time": r["_ts"], "value": float(vol), "color": color})
        return rows

    def ma_s(src: pd.DataFrame, col: str) -> list:
        return [{"time": r["_ts"], "value": float(r[col])}
                for _, r in src.iterrows() if pd.notna(r.get(col))]

    # ── 日 K 重採樣（僅 intraday 需要）──────────────────────────
    if is_intraday:
        df["_date"] = df[tcol].str.split(" ").str[0]   # "YYYYMMDD"
        daily = (df.groupby("_date", sort=True)
                   .agg(open=("open","first"), high=("high","max"),
                        low=("low","min"),     close=("close","last"),
                        volume=("volume","sum"))
                   .reset_index())
        daily["_ts"] = daily["_date"].apply(parse_time)  # → 'YYYY-MM-DD'
        for n in [5, 10, 20, 60]:
            daily[f"ma{n}"] = daily["close"].rolling(n).mean().round(2)
        daily["avg01"]  = daily["close"].rolling(2).mean().round(2)
        daily["avg12"]  = daily["close"].rolling(2).mean().shift(1).round(2)
        daily["avg012"] = daily["close"].rolling(3).mean().round(2)
        daily["avg123"] = daily["close"].rolling(3).mean().shift(1).round(2)
        daily["avg"]    = None
        daily_candles = build_candles(daily)
        daily_volume  = build_volume(daily)
        daily_ma      = {k: ma_s(daily, k) for k in ["ma5","ma10","ma20","ma60"]}
    else:
        daily_candles = None   # 本身已是日 K
        daily_volume  = None
        daily_ma      = None

    return {
        "candles":       build_candles(df),
        "volume":        build_volume(df),
        "ma":            {k: ma_s(df, k) for k in ["ma5","ma10","ma20","ma60"]},
        "intraday":      is_intraday,
        "daily_candles": daily_candles,
        "daily_volume":  daily_volume,
        "daily_ma":      daily_ma,
    }

# ── 掃描 data/ 資料夾 ──────────────────────────────────────────
datasets = {}
for f in sorted(DATA_DIR.glob("*.csv")):
    print(f"  載入 {f.stem}…")
    datasets[f.stem] = load_csv(f)

assert datasets, f"data/ 資料夾找不到 CSV 檔案"
names   = list(datasets.keys())
default = names[0]

# ── HTML 模板 ─────────────────────────────────────────────────
options_html = "\n".join(
    f'  <option value="{n}"{" selected" if n == default else ""}>{n}</option>'
    for n in names
)

html = f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>台股 K 線圖</title>
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
  #toolbar .title {{ font-size: 14px; font-weight: 600; color: #fff; margin-right: 4px; }}
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
    flex-shrink: 0; background: #1a1d2b; border-top: 1px solid #2a2e39;
    padding: 8px 14px; display: flex; align-items: center; gap: 0;
    overflow-x: auto; font-size: 12px; height: 64px; white-space: nowrap;
  }}
  #stats-panel::-webkit-scrollbar {{ height: 4px; }}
  #stats-panel::-webkit-scrollbar-thumb {{ background: #363c4e; border-radius: 2px; }}
  .stat-card {{
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-width: 90px; padding: 0 14px; border-right: 1px solid #2a2e39; line-height: 1.5;
  }}
  .stat-card:last-child {{ border-right: none; }}
  .stat-label {{ color: #5d6673; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; }}
  .stat-val   {{ color: #d1d4dc; font-size: 13px; font-weight: 600; }}
  .stat-val.up   {{ color: #26a69a; }}
  .stat-val.dn   {{ color: #ef5350; }}
  .stat-val.warn {{ color: #ff9800; }}
  .stat-period {{ color: #5d6673; font-size: 11px; padding-right: 14px; border-right: 1px solid #2a2e39; min-width: 140px; line-height: 1.6; }}

  /* ── 進出場計算器 ── */
  #trade-panel {{
    flex-shrink: 0; background: #161b27; border-top: 1px solid #2a2e39;
    padding: 8px 14px; display: none; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12px;
  }}
  #trade-panel.open {{ display: flex; }}
  .tp-group {{ display: flex; flex-direction: column; gap: 3px; }}
  .tp-label {{ color: #5d6673; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }}
  .tp-input {{
    background: #2a2e39; border: 1px solid #363c4e; color: #d1d4dc;
    padding: 4px 8px; border-radius: 4px; font-size: 12px; width: 90px; outline: none;
  }}
  .tp-input:focus {{ border-color: #2962ff; }}
  .tp-sep {{ width: 1px; height: 40px; background: #2a2e39; align-self: center; margin: 0 4px; }}
  .tp-result {{
    display: flex; flex-direction: column; align-items: center;
    min-width: 100px; padding: 0 12px; border-right: 1px solid #2a2e39; line-height: 1.5;
  }}
  .tp-result:last-of-type {{ border-right: none; }}
  .tp-rlabel {{ color: #5d6673; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }}
  .tp-rval   {{ font-size: 13px; font-weight: 600; color: #d1d4dc; }}
  .tp-rval.up  {{ color: #26a69a; }} .tp-rval.dn {{ color: #ef5350; }} .tp-rval.neu {{ color: #ff9800; }}

  /* ── 十字線 tooltip ── */
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
  <!-- 資料集下拉 -->
  <select class="tb" id="dataset-select" onchange="loadDataset(this.value)"
          style="font-weight:600; min-width:110px; font-size:13px;">
{options_html}
  </select>
  <div class="sep"></div>

  <!-- 頻率切換 -->
  <span id="freq-group" style="display:none; gap:4px;">
    <button class="tb" id="btn-1h" onclick="setFreq('1h')">1H</button>
    <button class="tb active" id="btn-1d" onclick="setFreq('1d')">日K</button>
  </span>
  <div class="sep" id="freq-sep" style="display:none"></div>

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
  <button class="tb" id="ma5-btn"  onclick="toggleMA('ma5')">
    <span class="ma-dot" style="background:#f6c85f"></span>MA5</button>
  <button class="tb" id="ma10-btn" onclick="toggleMA('ma10')">
    <span class="ma-dot" style="background:#ff9800"></span>MA10</button>
  <button class="tb" id="ma20-btn" onclick="toggleMA('ma20')">
    <span class="ma-dot" style="background:#e91e63"></span>MA20</button>
  <button class="tb" id="ma60-btn" onclick="toggleMA('ma60')">
    <span class="ma-dot" style="background:#9c27b0"></span>MA60</button>
  <button class="tb active" id="vwap-btn" onclick="toggleTick('avg','vwap-btn')">
    <span class="ma-dot" style="background:#00b0f0"></span>均價</button>
  <div class="sep"></div>

  <!-- 短期均線 Tick -->
  <button class="tb active" id="avg12-btn"  onclick="toggleTick('avg12','avg12-btn')">
    <span class="ma-dot" style="background:#c709e7"></span>Avg12</button>
  <button class="tb active" id="avg123-btn" onclick="toggleTick('avg123','avg123-btn')">
    <span class="ma-dot" style="background:#0dff3b"></span>Avg123</button>
  <button class="tb" id="avg01-btn"  onclick="toggleTick('avg01','avg01-btn')">
    <span class="ma-dot" style="background:#80cbc4"></span>Avg01</button>
  <button class="tb" id="avg012-btn" onclick="toggleTick('avg012','avg012-btn')">
    <span class="ma-dot" style="background:#26a69a"></span>Avg012</button>
  <div class="sep"></div>

  <!-- 其他 -->
  <button class="tb" id="btn-log" onclick="toggleLog()">對數</button>
  <select class="tb" id="crosshair-mode" onchange="setCrosshair(this.value)">
    <option value="1">十字線</option>
    <option value="2">磁力</option>
    <option value="0">隱藏</option>
  </select>
  <button class="tb" onclick="screenshot()">📷 截圖</button>
  <div class="sep"></div>
  <!-- K棒間距 -->
  <span style="color:#5d6673;font-size:11px;">間距</span>
  <button class="tb" onclick="changeSpacing(-2)" title="縮小間距">－</button>
  <span id="spacing-val" style="color:#d1d4dc;font-size:12px;min-width:24px;text-align:center;">8</span>
  <button class="tb" onclick="changeSpacing(+2)" title="放大間距">＋</button>
  <div class="sep"></div>
  <button class="tb" id="btn-trade" onclick="toggleTrade()">📊 進出場計算</button>
</div>

<!-- ══ 圖表區 ══ -->
<div id="charts">
  <div id="main-chart"><div id="tooltip"></div></div>
  <div id="vol-chart"></div>
</div>

<!-- ══ 進出場計算器 ══ -->
<div id="trade-panel">
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
  <div class="stat-card"><span class="stat-label">K 棒數</span><span class="stat-val" id="s-days">—</span></div>
</div>

<script>
// ── 全部資料集 ─────────────────────────────────────────────────
const allDatasets = {json.dumps(datasets, ensure_ascii=False)};

// ── 目前資料集狀態 ─────────────────────────────────────────────
let curName    = "{default}";
let candleData = allDatasets[curName].candles;
let candleMap  = Object.fromEntries(candleData.map(d => [d.time, d]));

// ── 共用圖表選項 ──────────────────────────────────────────────
const mkOpts = (el) => ({{
  layout: {{ background: {{ color: '#131722' }}, textColor: '#d1d4dc' }},
  grid:   {{ vertLines: {{ color: '#1e2130' }}, horzLines: {{ color: '#1e2130' }} }},
  crosshair: {{ mode: LightweightCharts.CrosshairMode.Normal }},
  rightPriceScale: {{ borderColor: '#2a2e39' }},
  timeScale: {{ borderColor: '#2a2e39', timeVisible: true, barSpacing: 8 }},
  container: el,
}});

// ── 建立主圖 & 成交量圖 ───────────────────────────────────────
const mainEl  = document.getElementById('main-chart');
const mainChart = LightweightCharts.createChart(mainEl, {{
  ...mkOpts(mainEl), width: mainEl.clientWidth, height: mainEl.clientHeight,
}});

let mainSeries = mainChart.addCandlestickSeries({{
  upColor:'#26a69a', downColor:'#ef5350',
  borderUpColor:'#26a69a', borderDownColor:'#ef5350',
  wickUpColor:'#26a69a', wickDownColor:'#ef5350',
}});
mainSeries.setData(candleData);

// 長期均線
const maColors = {{ ma5:'#f6c85f', ma10:'#ff9800', ma20:'#e91e63', ma60:'#9c27b0' }};
const maSeries = {{}};
for (const [k, color] of Object.entries(maColors)) {{
  maSeries[k] = mainChart.addLineSeries({{
    color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
    visible: false,
  }});
  maSeries[k].setData(allDatasets[curName].ma[k]);
  document.getElementById(k+'-btn')?.classList.remove('active');
}}

// 短期均線 Tick（獨立水平短橫線，open=high=low=close=value）
// borderWidth: 橫線粗細（像素，建議 1~3）
const TICK_CFG = [
  {{ key:'avg',    color:'#ffffff', borderWidth:3, defaultOn:true  }},
  {{ key:'avg12',  color:'#8603C1', borderWidth:3, defaultOn:true  }},
  {{ key:'avg123', color:'#0dff3b', borderWidth:3, defaultOn:true  }},
  {{ key:'avg01',  color:'#c709e7', borderWidth:3, defaultOn:true }},
  {{ key:'avg012', color:'#118E00', borderWidth:3, defaultOn:true }},
];
const tickSeries = {{}};
// thickness: 橫線高度（價格單位），數字越大橫線越「厚」
// 例：0.05 = 價格 ±0.025 → 上下偏移 0.025 個價格單位
const buildTickData = (key, thickness=0.05) => candleData
  .filter(d => d[key] != null)
  .map(d => ({{
    time:  d.time,
    open:  d[key] - thickness / 2,
    high:  d[key] + thickness / 2,
    low:   d[key] - thickness / 2,
    close: d[key] + thickness / 2,
  }}));

for (const {{ key, color, borderWidth, defaultOn }} of TICK_CFG) {{
  const s = mainChart.addCandlestickSeries({{
    upColor:color, downColor:color,
    borderUpColor:color, borderDownColor:color,
    wickUpColor:color, wickDownColor:color,
    borderWidth,
    priceLineVisible:false, lastValueVisible:false,
    visible: defaultOn,
  }});
  s.setData(buildTickData(key));
  tickSeries[key] = s;
  if (!defaultOn) document.getElementById(key+'-btn')?.classList.remove('active');
}}

// 成交量圖
const volEl = document.getElementById('vol-chart');
const volChart = LightweightCharts.createChart(volEl, {{
  ...mkOpts(volEl), width: volEl.clientWidth, height: volEl.clientHeight,
  rightPriceScale: {{ scaleMargins: {{ top:0.1, bottom:0 }} }},
}});
const volSeries = volChart.addHistogramSeries({{
  priceFormat: {{ type:'volume' }}, priceScaleId:'right',
}});
volSeries.setData(allDatasets[curName].volume);

// 時間軸同步
mainChart.timeScale().subscribeVisibleLogicalRangeChange(r => {{
  if (r) volChart.timeScale().setVisibleLogicalRange(r);
}});
volChart.timeScale().subscribeVisibleLogicalRangeChange(r => {{
  if (r) mainChart.timeScale().setVisibleLogicalRange(r);
}});

// ── Tooltip ───────────────────────────────────────────────────
const tooltip = document.getElementById('tooltip');
mainChart.subscribeCrosshairMove(param => {{
  if (!param.time) {{ tooltip.style.display='none'; return; }}

  let d = null;
  param.seriesData.forEach(v => {{ if (!d && v?.open !== undefined) d = v; }});
  if (!d) {{
    param.seriesData.forEach(v => {{ if (!d && v?.value !== undefined) d = v; }});
    if (!d) {{ tooltip.style.display='none'; return; }}
    tooltip.style.display='block';
    tooltip.innerHTML = `<span><b>${{param.time}}</b></span><span>收 <b>${{d.value}}</b></span>`;
    return;
  }}

  const o=+d.open, h=+d.high, l=+d.low, c=+d.close;
  const extra = candleMap[param.time] || {{}};
  const chg   = (c-o).toFixed(2);
  const pct   = (((c-o)/o)*100).toFixed(2);
  const avgVal= extra.avg ? extra.avg.toFixed(2) : '-';
  const cls   = c>=o ? 'up':'dn';
  tooltip.style.display='block';
  tooltip.innerHTML = `
    <span><b>${{typeof param.time==='number'
      ? new Date(param.time*1000).toLocaleString('zh-TW',{{timeZone:'Asia/Taipei'}})
      : param.time}}</b></span>
    <span>開 <b class="${{cls}}">${{o}}</b></span>
    <span>高 <b class="${{cls}}">${{h}}</b></span>
    <span>低 <b class="${{cls}}">${{l}}</b></span>
    <span>收 <b class="${{cls}}">${{c}}</b></span>
    <span class="${{cls}}">${{chg>=0?'+':''}}${{chg}} (${{pct}}%)</span>
    <span style="color:#00bcd4">均價 ${{avgVal}}</span>
  `;
}});

// ── RWD ───────────────────────────────────────────────────────
new ResizeObserver(() => {{
  mainChart.resize(mainEl.clientWidth, mainEl.clientHeight);
  volChart.resize(volEl.clientWidth, volEl.clientHeight);
}}).observe(mainEl);
new ResizeObserver(() => {{
  volChart.resize(volEl.clientWidth, volEl.clientHeight);
}}).observe(volEl);

// ── 工具列 ────────────────────────────────────────────────────
function fitAll() {{
  mainChart.timeScale().fitContent();
  document.querySelectorAll('#toolbar .tb').forEach(b => {{
    if (b.textContent.trim()==='全部') b.classList.add('active');
    else if (['1M','3M','6M','1Y','3Y','5Y'].includes(b.textContent.trim()))
      b.classList.remove('active');
  }});
}}

function setRange(days) {{
  const last = candleData[candleData.length-1].time;
  if (typeof last === 'number') {{
    mainChart.timeScale().setVisibleRange({{ from: last - days*86400, to: last }});
  }} else {{
    const from = new Date(last);
    from.setDate(from.getDate() - days);
    mainChart.timeScale().setVisibleRange({{ from: from.toISOString().slice(0,10), to: last }});
  }}
}}

let currentType = 'candle';
let entryPriceLine=null, exitPriceLine=null, bePriceLine=null;

function setType(type) {{
  currentType = type;
  ['candle','bar','line','area'].forEach(t =>
    document.getElementById('btn-'+t)?.classList.remove('active'));
  document.getElementById('btn-'+type)?.classList.add('active');

  // 移除舊標線
  [entryPriceLine,exitPriceLine,bePriceLine].forEach(l => {{
    if (l) try {{ mainSeries.removePriceLine(l); }} catch(e) {{}}
  }});
  entryPriceLine=exitPriceLine=bePriceLine=null;

  mainChart.removeSeries(mainSeries);
  if (type==='candle') {{
    mainSeries = mainChart.addCandlestickSeries({{
      upColor:'#26a69a', downColor:'#ef5350',
      borderUpColor:'#26a69a', borderDownColor:'#ef5350',
      wickUpColor:'#26a69a', wickDownColor:'#ef5350',
    }});
    mainSeries.setData(candleData);
  }} else if (type==='bar') {{
    mainSeries = mainChart.addBarSeries({{ upColor:'#26a69a', downColor:'#ef5350' }});
    mainSeries.setData(candleData);
  }} else if (type==='line') {{
    mainSeries = mainChart.addLineSeries({{ color:'rgba(41,98,255,0.5)', lineWidth:2 }});
    mainSeries.setData(candleData.map(d => ({{ time:d.time, value:d.close }})));
  }} else if (type==='area') {{
    mainSeries = mainChart.addAreaSeries({{
      lineColor:'#2962ff', topColor:'rgba(41,98,255,.3)', bottomColor:'rgba(41,98,255,0)',
    }});
    mainSeries.setData(candleData.map(d => ({{ time:d.time, value:d.close }})));
  }}
}}

function toggleMA(key) {{
  const vis = maSeries[key].options().visible !== false;
  maSeries[key].applyOptions({{ visible: !vis }});
  document.getElementById(key+'-btn')?.classList.toggle('active', !vis);
}}

function toggleTick(key, btnId) {{
  const s=tickSeries[key]; if (!s) return;
  const vis = s.options().visible !== false;
  s.applyOptions({{ visible: !vis }});
  document.getElementById(btnId)?.classList.toggle('active', !vis);
}}

let logScale=false;
function toggleLog() {{
  logScale=!logScale;
  mainChart.priceScale('right').applyOptions({{ mode: logScale?1:0 }});
  document.getElementById('btn-log').classList.toggle('active', logScale);
}}

function setCrosshair(val) {{
  const modes=[LightweightCharts.CrosshairMode.Hidden,
               LightweightCharts.CrosshairMode.Normal,
               LightweightCharts.CrosshairMode.Magnet];
  mainChart.applyOptions({{ crosshair:{{ mode:modes[+val] }} }});
  volChart.applyOptions({{ crosshair:{{ mode:modes[+val] }} }});
}}

let curSpacing = 8;
function changeSpacing(delta) {{
  curSpacing = Math.min(Math.max(curSpacing + delta, 2), 50);
  mainChart.timeScale().applyOptions({{ barSpacing: curSpacing }});
  volChart.timeScale().applyOptions({{ barSpacing: curSpacing }});
  document.getElementById('spacing-val').textContent = curSpacing;
}}

function screenshot() {{
  const a = document.createElement('a');
  a.href = mainChart.takeScreenshot().toDataURL('image/png');
  a.download = curName+'_chart.png'; a.click();
}}

// ── 頻率切換（1h / 1d）────────────────────────────────────────
let curFreq = '1d';

function setFreq(freq) {{
  const ds = allDatasets[curName];
  if (freq === '1h' && !ds.intraday) return;   // 本身已是日K，無法升頻
  if (freq === '1d' && !ds.daily_candles && !ds.intraday===false) {{
    freq = '1h';  // 無日K資料，維持原頻率
  }}
  curFreq = freq;
  document.getElementById('btn-1h')?.classList.toggle('active', freq==='1h');
  document.getElementById('btn-1d')?.classList.toggle('active', freq==='1d');
  applyFreqData(ds);
}}

function applyFreqData(ds) {{
  const use1d = curFreq==='1d' && ds.daily_candles;
  candleData = use1d ? ds.daily_candles : ds.candles;
  candleMap  = Object.fromEntries(candleData.map(d => [d.time, d]));
  const maSource = use1d ? ds.daily_ma   : ds.ma;
  const volSource= use1d ? ds.daily_volume: ds.volume;

  setType(currentType);
  for (const k of Object.keys(maColors)) maSeries[k].setData(maSource[k]);
  for (const {{ key }} of TICK_CFG) {{
    if (tickSeries[key]) tickSeries[key].setData(buildTickData(key));
  }}
  volSeries.setData(volSource);
  fitAll();
  setTimeout(updateStats, 100);
}}

// ── 切換資料集 ────────────────────────────────────────────────
function loadDataset(name) {{
  const ds = allDatasets[name];
  if (!ds) return;
  curName = name;

  // 顯示/隱藏頻率按鈕（只有 intraday 資料才需要切換）
  const showFreq = ds.intraday;
  document.getElementById('freq-group').style.display = showFreq ? 'flex' : 'none';
  document.getElementById('freq-sep').style.display   = showFreq ? 'block': 'none';

  // intraday 預設顯示日K；非 intraday 固定 1h（本身即日K）
  curFreq = showFreq ? '1d' : '1h';
  document.getElementById('btn-1h')?.classList.toggle('active', curFreq==='1h');
  document.getElementById('btn-1d')?.classList.toggle('active', curFreq==='1d');

  applyFreqData(ds);
}}

// ── 進出場計算器 ──────────────────────────────────────────────
function toggleTrade() {{
  const panel=document.getElementById('trade-panel');
  const btn=document.getElementById('btn-trade');
  panel.classList.toggle('open');
  btn.classList.toggle('active');
  if (!panel.classList.contains('open')) {{
    [entryPriceLine,exitPriceLine,bePriceLine].forEach(l => {{
      if (l) try {{ mainSeries.removePriceLine(l); }} catch(e){{}}
    }});
    entryPriceLine=exitPriceLine=bePriceLine=null;
  }}
}}

function calcTrade() {{
  const entry = parseFloat(document.getElementById('tp-entry').value);
  const shares= parseFloat(document.getElementById('tp-shares').value)||1000;
  const feeR  = parseFloat(document.getElementById('tp-fee').value)/100||0.001425;
  const taxR  = parseFloat(document.getElementById('tp-tax').value)/100||0.001;
  const exitV = document.getElementById('tp-exit').value;
  const exit  = exitV!=='' ? parseFloat(exitV) : candleData[candleData.length-1].close;

  if (!entry||isNaN(entry)) {{
    ['tr-pnl','tr-pct','tr-be','tr-cost','tr-recv','tr-fee','tr-tax'].forEach(id => {{
      document.getElementById(id).textContent='—';
      document.getElementById(id).className='tp-rval';
    }});
    return;
  }}
  const feeBuy =Math.max(entry*shares*feeR,20);
  const feeSell=Math.max(exit *shares*feeR,20);
  const taxAmt =exit*shares*taxR;
  const cost   =entry*shares+feeBuy;
  const recv   =exit *shares-feeSell-taxAmt;
  const pnl    =recv-cost;
  const pct    =(pnl/cost)*100;
  const be     =(cost/shares)/(1-feeR-taxR);

  const fmt=v=>Math.round(v).toLocaleString();
  const setR=(id,text,cls)=>{{
    const el=document.getElementById(id);
    el.textContent=text; el.className='tp-rval'+(cls?' '+cls:'');
  }};
  setR('tr-pnl', (pnl>=0?'+':'')+fmt(pnl)+' 元', pnl>=0?'up':'dn');
  setR('tr-pct', (pct>=0?'+':'')+pct.toFixed(2)+'%', pct>=0?'up':'dn');
  setR('tr-be',  be.toFixed(2), 'neu');
  setR('tr-cost',fmt(cost)+' 元',''); setR('tr-recv',fmt(recv)+' 元','');
  setR('tr-fee', fmt(feeBuy+feeSell)+' 元','');
  setR('tr-tax', fmt(taxAmt)+' 元','');

  if (entryPriceLine) try{{mainSeries.removePriceLine(entryPriceLine);}}catch(e){{}}
  if (exitPriceLine)  try{{mainSeries.removePriceLine(exitPriceLine); }}catch(e){{}}
  if (bePriceLine)    try{{mainSeries.removePriceLine(bePriceLine);   }}catch(e){{}}
  entryPriceLine=mainSeries.createPriceLine({{
    price:entry, color:'#26a69a', lineWidth:1,
    lineStyle:LightweightCharts.LineStyle.Dashed,
    axisLabelVisible:true, title:`進 ${{entry}}`,
  }});
  exitPriceLine=mainSeries.createPriceLine({{
    price:exit, color:'#ef5350', lineWidth:1,
    lineStyle:LightweightCharts.LineStyle.Dashed,
    axisLabelVisible:true, title:`出 ${{exit}}`,
  }});
  bePriceLine=mainSeries.createPriceLine({{
    price:be, color:'#ff9800', lineWidth:1,
    lineStyle:LightweightCharts.LineStyle.SparseDotted,
    axisLabelVisible:true, title:`損平 ${{be.toFixed(2)}}`,
  }});
}}

// ── 回測統計 ──────────────────────────────────────────────────
function calcStats(candles) {{
  if (candles.length < 2) return null;
  const first=candles[0].close, last=candles[candles.length-1].close;
  const totalRet=(last-first)/first*100;

  // 時間差（支援 Unix timestamp 和日期字串）
  const tsOf = t => typeof t==='number' ? t*1000 : new Date(t).getTime();
  const calDays = Math.max((tsOf(candles[candles.length-1].time)-tsOf(candles[0].time))/86400000, 1);
  const annRet  = (Math.pow(last/first, 365/calDays)-1)*100;

  const dailyR=[];
  for (let i=1;i<candles.length;i++)
    dailyR.push((candles[i].close-candles[i-1].close)/candles[i-1].close);
  const mean=dailyR.reduce((a,b)=>a+b,0)/dailyR.length;
  const vol=Math.sqrt(dailyR.reduce((a,b)=>a+(b-mean)**2,0)/dailyR.length)*Math.sqrt(252)*100;
  const sharpe=vol>0?(annRet-2.0)/vol:0;

  let mdd=0,peak=candles[0].close;
  for (const c of candles) {{
    if (c.close>peak) peak=c.close;
    const dd=(peak-c.close)/peak*100; if (dd>mdd) mdd=dd;
  }}
  const upDays=candles.filter(d=>d.close>=d.open).length;
  const dayPct=candles.map(d=>(d.close-d.open)/d.open*100);
  return {{ totalRet, annRet, vol, sharpe, mdd,
            winRate:upDays/candles.length*100,
            bestDay:Math.max(...dayPct), worstDay:Math.min(...dayPct),
            count:candles.length,
            from:candles[0].time, to:candles[candles.length-1].time }};
}}

const fmtPct=(v,d=2)=>v>=0?`+${{v.toFixed(d)}}%`:`${{v.toFixed(d)}}%`;

function updateStats() {{
  const range=mainChart.timeScale().getVisibleRange();
  let vis = range
    ? candleData.filter(d=>d.time>=range.from&&d.time<=range.to)
    : candleData;
  if (vis.length<2) return;
  const s=calcStats(vis); if (!s) return;

  const tsLabel = t => typeof t==='number'
    ? new Date(t*1000).toLocaleString('zh-TW',{{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short'}})
    : t;
  document.getElementById('stat-period').innerHTML=`${{tsLabel(s.from)}}<br>~ ${{tsLabel(s.to)}}`;

  const setV=(id,text,cls)=>{{
    const el=document.getElementById(id);
    el.textContent=text; el.className='stat-val'+(cls?' '+cls:'');
  }};
  setV('s-ret',   fmtPct(s.totalRet),  s.totalRet>=0?'up':'dn');
  setV('s-ann',   fmtPct(s.annRet),    s.annRet>=0?'up':'dn');
  setV('s-mdd',   `-${{s.mdd.toFixed(2)}}%`, s.mdd>20?'dn':s.mdd>10?'warn':'');
  setV('s-vol',   `${{s.vol.toFixed(2)}}%`,  s.vol>30?'warn':'');
  setV('s-sharpe',s.sharpe.toFixed(2), s.sharpe>=1?'up':s.sharpe<0?'dn':'');
  setV('s-win',   `${{s.winRate.toFixed(1)}}%`, s.winRate>=50?'up':'dn');
  setV('s-best',  fmtPct(s.bestDay),   'up');
  setV('s-worst', fmtPct(s.worstDay),  'dn');
  setV('s-days',  s.count, '');
}}

mainChart.timeScale().subscribeVisibleRangeChange(updateStats);

// 初始化：觸發 loadDataset 統一設定頻率按鈕與資料
loadDataset(curName);
</script>
</body>
</html>
"""

out = Path("0050_chart.html")
out.write_text(html, encoding="utf-8")
print(f"生成完成：{out.resolve()}")
