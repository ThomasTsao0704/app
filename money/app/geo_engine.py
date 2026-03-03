import numpy as np

# Country/region geo coordinates and static PPP deviation data.
# ppp_deviation > 0 = overvalued, < 0 = undervalued vs USD purchasing parity.
# Source: approximate IMF Big Mac Index + World Bank PPP estimates (2024).
CURRENCY_GEO = {
    "NTBD": {"country": "Taiwan",      "currency": "TWD", "lat":  23.70, "lon": 121.00, "ppp_deviation": -10.0},
    "JPYD": {"country": "Japan",       "currency": "JPY", "lat":  36.20, "lon": 138.30, "ppp_deviation": -35.0},
    "PGDD": {"country": "China",       "currency": "CNY", "lat":  35.90, "lon": 104.20, "ppp_deviation": -25.0},
    "HKDD": {"country": "Hong Kong",   "currency": "HKD", "lat":  22.32, "lon": 114.17, "ppp_deviation":  -5.0},
    "KRDD": {"country": "South Korea", "currency": "KRW", "lat":  36.50, "lon": 127.80, "ppp_deviation": -18.0},
    "TBDD": {"country": "Thailand",    "currency": "THB", "lat":  15.90, "lon": 100.90, "ppp_deviation": -10.0},
    "SGDD": {"country": "Singapore",   "currency": "SGD", "lat":   1.35, "lon": 103.82, "ppp_deviation":   8.0},
    "AUDD": {"country": "Australia",   "currency": "AUD", "lat": -25.27, "lon": 133.78, "ppp_deviation":  -8.0},
    "XEUD": {"country": "Eurozone",    "currency": "EUR", "lat":  48.90, "lon":  10.50, "ppp_deviation":  -5.0},
}

# City purchasing power data (2024 estimates).
# avg_salary_usd: approximate monthly gross salary in USD.
# cost_index: cost of living relative to New York City = 100.
CITY_DATA = [
    {"city": "New York",  "country": "USA",         "currency_code": None,   "lat":  40.71, "lon":  -74.01, "avg_salary_usd": 6500, "cost_index": 100.0},
    {"city": "Sydney",    "country": "Australia",   "currency_code": "AUDD", "lat": -33.87, "lon":  151.21, "avg_salary_usd": 5200, "cost_index":  85.0},
    {"city": "Singapore", "country": "Singapore",   "currency_code": "SGDD", "lat":   1.35, "lon":  103.82, "avg_salary_usd": 4200, "cost_index":  88.0},
    {"city": "Tokyo",     "country": "Japan",       "currency_code": "JPYD", "lat":  35.68, "lon":  139.69, "avg_salary_usd": 3500, "cost_index":  82.0},
    {"city": "Hong Kong", "country": "Hong Kong",   "currency_code": "HKDD", "lat":  22.32, "lon":  114.17, "avg_salary_usd": 3600, "cost_index":  92.0},
    {"city": "Seoul",     "country": "South Korea", "currency_code": "KRDD", "lat":  37.57, "lon":  126.98, "avg_salary_usd": 2600, "cost_index":  72.0},
    {"city": "Taipei",    "country": "Taiwan",      "currency_code": "NTBD", "lat":  25.04, "lon":  121.56, "avg_salary_usd": 2000, "cost_index":  58.0},
    {"city": "Shanghai",  "country": "China",       "currency_code": "PGDD", "lat":  31.23, "lon":  121.47, "avg_salary_usd": 1800, "cost_index":  60.0},
    {"city": "Bangkok",   "country": "Thailand",    "currency_code": "TBDD", "lat":  13.75, "lon":  100.52, "avg_salary_usd": 1100, "cost_index":  42.0},
]


def build_geo_data(db) -> list[dict]:
    """Return PPP deviation, momentum, and volatility for each currency."""
    from . import crud

    result = []
    for code, meta in CURRENCY_GEO.items():
        rows = crud.get_history(db, code)
        if len(rows) < 4:
            continue

        latest_rate  = rows[-1].rate
        rate_1m_ago  = rows[-2].rate
        rate_3m_ago  = rows[-4].rate

        # Exchange rate = "1 USD = X currency units".
        # Rate decrease → currency strengthened → positive momentum.
        mom_30d = (rate_1m_ago - latest_rate) / rate_1m_ago * 100
        mom_90d = (rate_3m_ago - latest_rate) / rate_3m_ago * 100
        momentum = round(0.5 * mom_30d + 0.5 * mom_90d, 2)

        rates_12m  = [r.rate for r in rows[-12:]]
        volatility = round(float(np.std(rates_12m)), 4) if len(rates_12m) > 1 else 0.0

        result.append({
            "country":      meta["country"],
            "currency":     meta["currency"],
            "currency_code": code,
            "lat":          meta["lat"],
            "lon":          meta["lon"],
            "ppp_deviation": meta["ppp_deviation"],
            "momentum_30d": round(mom_30d, 2),
            "momentum_90d": round(mom_90d, 2),
            "momentum":     momentum,
            "volatility":   volatility,
            "latest_rate":  latest_rate,
        })

    return result
