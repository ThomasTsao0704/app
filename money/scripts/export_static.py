"""
Export all FX data from SQLite → frontend/data.js for pure-static deployment.

Usage (run from project root):
    python scripts/export_static.py
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np

# ── Make project root importable ─────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from app.database import SessionLocal
from app import crud
from app.capital_engine import PPP_DATA
from app.geo_engine import CURRENCY_GEO, CITY_DATA


# ── Helpers (mirror app/services.py / engines) ────────────────────────────────

def _pct(a, b):
    return 0.0 if a == 0 else (b - a) / a * 100


def _trend(pct):
    if pct > 0.1:  return "up"
    if pct < -0.1: return "down"
    return "flat"


def _signal(mom, vol, ppp):
    if mom > 0.5 and ppp < -10:  return "strong_buy"
    if mom > 0.2 and vol < 1.5:  return "stable_up"
    if mom < -0.5 and ppp > 5:   return "risk"
    if mom < -0.2:                return "watch"
    return "neutral"


def build_summary(db, code, name):
    rows = crud.get_history(db, code)
    if not rows:
        return None
    latest = rows[-1]
    cutoff = latest.date - timedelta(days=365)
    rows_1y = [r for r in rows if r.date >= cutoff]
    rates_1y = [r.rate for r in rows_1y]
    prev_rate = rows_1y[-2].rate if len(rows_1y) >= 2 else None
    chg = _pct(prev_rate, latest.rate) if prev_rate else None
    return {
        "currency_code":  code,
        "currency_name":  name,
        "latest_date":    latest.date.isoformat(),
        "latest_rate":    latest.rate,
        "prev_rate":      prev_rate,
        "change_percent": round(chg, 4) if chg is not None else None,
        "high_1y":        max(rates_1y) if rates_1y else None,
        "low_1y":         min(rates_1y) if rates_1y else None,
        "volatility_1y":  round(float(np.std(rates_1y)), 4) if len(rates_1y) > 1 else None,
        "trend":          _trend(chg) if chg is not None else "flat",
    }


def build_history(db, code, name):
    rows = crud.get_history(db, code)
    return {
        "currency_code": code,
        "currency_name": name,
        "history": [{"date": r.date.isoformat(), "rate": r.rate} for r in rows],
    }


def build_correlation(db, currencies):
    series = {}
    for code, _ in currencies:
        rows = crud.get_history(db, code, limit=60)
        series[code] = [r.rate for r in rows]
    codes = list(series)
    min_len = min(len(v) for v in series.values())
    matrix = {}
    for a in codes:
        matrix[a] = {}
        for b in codes:
            x = np.array(series[a][-min_len:])
            y = np.array(series[b][-min_len:])
            corr = float(np.corrcoef(x, y)[0, 1]) if min_len > 1 else 1.0
            matrix[a][b] = round(corr, 3)
    return matrix


def build_geo(db):
    result = []
    for code, meta in CURRENCY_GEO.items():
        rows = crud.get_history(db, code)
        if len(rows) < 4:
            continue
        m30 = (rows[-2].rate - rows[-1].rate) / rows[-2].rate * 100
        m90 = (rows[-4].rate - rows[-1].rate) / rows[-4].rate * 100
        rates_12m = [r.rate for r in rows[-12:]]
        result.append({
            "country":       meta["country"],
            "currency":      meta["currency"],
            "currency_code": code,
            "lat":           meta["lat"],
            "lon":           meta["lon"],
            "ppp_deviation": meta["ppp_deviation"],
            "momentum_30d":  round(m30, 2),
            "momentum_90d":  round(m90, 2),
            "momentum":      round(0.5 * m30 + 0.5 * m90, 2),
            "volatility":    round(float(np.std(rates_12m)), 4) if len(rates_12m) > 1 else 0.0,
            "latest_rate":   rows[-1].rate,
        })
    return result


def build_city(db):
    result = []
    for c in CITY_DATA:
        usd_rate = None
        if c["currency_code"]:
            latest = crud.get_latest_rate(db, c["currency_code"])
            usd_rate = latest.rate if latest else None
        result.append({**c, "purchasing_power": round(c["avg_salary_usd"] / c["cost_index"] * 100, 1), "usd_rate": usd_rate})
    result.sort(key=lambda x: x["purchasing_power"], reverse=True)
    return result


def build_capital(db, currencies):
    result = []
    for code, name in currencies:
        rows = crud.get_history(db, code)
        if len(rows) < 4:
            continue
        m30 = (rows[-2].rate - rows[-1].rate) / rows[-2].rate * 100
        m90 = (rows[-4].rate - rows[-1].rate) / rows[-4].rate * 100
        mom = round(0.5 * m30 + 0.5 * m90, 2)
        rates_12m = [r.rate for r in rows[-12:]]
        vol = round(float(np.std(rates_12m)), 4) if len(rates_12m) > 1 else 0.0
        ppp = PPP_DATA.get(code, 0.0)
        result.append({
            "currency_code": code,
            "currency_name": name,
            "momentum_30d":  round(m30, 2),
            "momentum_90d":  round(m90, 2),
            "momentum":      mom,
            "volatility":    vol,
            "ppp_deviation": ppp,
            "signal":        _signal(mom, vol, ppp),
            "latest_rate":   rows[-1].rate,
        })
    result.sort(key=lambda x: x["momentum"], reverse=True)
    for i, r in enumerate(result):
        r["rank"] = i + 1
    return result


def build_alerts(capital):
    result = []
    sig_map = {
        "strong_buy": ("opportunity", "潛在長期配置區",
                       lambda d: f"PPP低估 {abs(d['ppp_deviation']):.0f}% 且動能轉強 ({d['momentum']:+.2f}%)"),
        "stable_up":  ("info",        "穩定升值",
                       lambda d: f"動能 {d['momentum']:+.2f}%，波動率低 ({d['volatility']:.3f})"),
        "risk":       ("warning",     "風險警示",
                       lambda d: f"貨幣走弱 ({d['momentum']:+.2f}%) 且 PPP 高估"),
        "watch":      ("watch",       "持續觀察",
                       lambda d: f"近期走弱 (動能 {d['momentum']:+.2f}%)"),
    }
    for d in capital:
        if d["signal"] in sig_map:
            t, title, msg_fn = sig_map[d["signal"]]
            result.append({"currency_code": d["currency_code"], "currency_name": d["currency_name"],
                            "type": t, "title": title, "message": msg_fn(d)})
    return result


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=== FX Static Export ===")
    db = SessionLocal()
    try:
        currencies = crud.get_all_currencies(db)
        dr = crud.get_date_range(db)

        capital = build_capital(db, currencies)

        data = {
            "generated_at": date.today().isoformat(),
            "meta":         {"min_date": str(dr["min_date"]), "max_date": str(dr["max_date"])},
            "currencies":   [{"code": c[0], "name": c[1]} for c in currencies],
            "summary":      [s for c in currencies if (s := build_summary(db, c[0], c[1]))],
            "history":      {c[0]: build_history(db, c[0], c[1]) for c in currencies},
            "correlation":  build_correlation(db, currencies),
            "geo":          build_geo(db),
            "city":         build_city(db),
            "capital":      capital,
            "alerts":       build_alerts(capital),
        }

    finally:
        db.close()

    out = ROOT / "frontend" / "data.js"
    js  = (
        "// Auto-generated – do not edit manually.\n"
        "// Run: python scripts/export_static.py\n"
        f"const FX_DATA = {json.dumps(data, ensure_ascii=False)};\n"
    )
    out.write_text(js, encoding="utf-8")

    total_hist = sum(len(v["history"]) for v in data["history"].values())
    size_kb = out.stat().st_size / 1024
    print(f"[OK] data.js -> {out}")
    print(f"     currencies : {len(data['currencies'])}")
    print(f"     history    : {total_hist} rows")
    print(f"     date range : {data['meta']['min_date']} ~ {data['meta']['max_date']}")
    print(f"     file size  : {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
