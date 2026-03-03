import numpy as np

# Static PPP deviation per currency code (same values as geo_engine).
PPP_DATA = {
    "NTBD": -10.0,
    "JPYD": -35.0,
    "PGDD": -25.0,
    "HKDD":  -5.0,
    "KRDD": -18.0,
    "TBDD": -10.0,
    "SGDD":   8.0,
    "AUDD":  -8.0,
    "XEUD":  -5.0,
}


def _signal(momentum: float, volatility: float, ppp_deviation: float) -> str:
    """Classify investment signal from three metrics."""
    if momentum > 0.5 and ppp_deviation < -10:
        return "strong_buy"   # strengthening + undervalued → long-term allocation zone
    if momentum > 0.2 and volatility < 1.5:
        return "stable_up"    # stable appreciation, low risk
    if momentum < -0.5 and ppp_deviation > 5:
        return "risk"         # weakening + overvalued
    if momentum < -0.2:
        return "watch"        # weakening, keep an eye
    return "neutral"


def ranking(db) -> list[dict]:
    """Return all currencies ranked by composite momentum (strongest first)."""
    from . import crud

    currencies = crud.get_all_currencies(db)
    result = []

    for code, name in currencies:
        rows = crud.get_history(db, code)
        if len(rows) < 4:
            continue

        latest_rate = rows[-1].rate
        rate_1m_ago = rows[-2].rate
        rate_3m_ago = rows[-4].rate

        mom_30d  = (rate_1m_ago - latest_rate) / rate_1m_ago * 100
        mom_90d  = (rate_3m_ago - latest_rate) / rate_3m_ago * 100
        momentum = round(0.5 * mom_30d + 0.5 * mom_90d, 2)

        rates_12m  = [r.rate for r in rows[-12:]]
        volatility = round(float(np.std(rates_12m)), 4) if len(rates_12m) > 1 else 0.0

        ppp    = PPP_DATA.get(code, 0.0)
        signal = _signal(momentum, volatility, ppp)

        result.append({
            "currency_code":  code,
            "currency_name":  name,
            "momentum_30d":   round(mom_30d, 2),
            "momentum_90d":   round(mom_90d, 2),
            "momentum":       momentum,
            "volatility":     volatility,
            "ppp_deviation":  ppp,
            "signal":         signal,
            "latest_rate":    latest_rate,
        })

    result.sort(key=lambda x: x["momentum"], reverse=True)
    for i, r in enumerate(result):
        r["rank"] = i + 1

    return result


def alerts(db) -> list[dict]:
    """Return actionable investment alerts derived from the ranking."""
    data   = ranking(db)
    result = []

    for d in data:
        sig = d["signal"]
        if sig == "strong_buy":
            result.append({
                "currency_code": d["currency_code"],
                "currency_name": d["currency_name"],
                "type":    "opportunity",
                "title":   "潛在長期配置區",
                "message": f"PPP低估 {abs(d['ppp_deviation']):.0f}% 且動能轉強 ({d['momentum']:+.2f}%)",
            })
        elif sig == "stable_up":
            result.append({
                "currency_code": d["currency_code"],
                "currency_name": d["currency_name"],
                "type":    "info",
                "title":   "穩定升值",
                "message": f"動能 {d['momentum']:+.2f}%，波動率低 ({d['volatility']:.3f})",
            })
        elif sig == "risk":
            result.append({
                "currency_code": d["currency_code"],
                "currency_name": d["currency_name"],
                "type":    "warning",
                "title":   "風險警示",
                "message": f"貨幣走弱 ({d['momentum']:+.2f}%) 且 PPP 高估",
            })
        elif sig == "watch":
            result.append({
                "currency_code": d["currency_code"],
                "currency_name": d["currency_name"],
                "type":    "watch",
                "title":   "持續觀察",
                "message": f"近期走弱 (動能 {d['momentum']:+.2f}%)",
            })

    return result
