from datetime import date, timedelta
import numpy as np
from sqlalchemy.orm import Session
from . import crud
from .schemas import RateSummary, HistoryPoint, FullHistory

# ── helpers ────────────────────────────────────────────────────────────────

def _pct_change(a: float, b: float) -> float:
    """(b - a) / a * 100"""
    if a == 0:
        return 0.0
    return (b - a) / a * 100

def _trend_label(pct: float) -> str:
    if pct > 0.1:
        return "up"
    elif pct < -0.1:
        return "down"
    return "flat"

# ── public service functions ───────────────────────────────────────────────

def build_summary(db: Session, currency_code: str) -> RateSummary | None:
    latest = crud.get_latest_rate(db, currency_code)
    if not latest:
        return None

    one_year_ago = latest.date - timedelta(days=365)
    history_1y = crud.get_history_since(db, currency_code, one_year_ago)

    rates_1y = [r.rate for r in history_1y]
    high_1y = max(rates_1y) if rates_1y else None
    low_1y  = min(rates_1y) if rates_1y else None
    vol_1y  = float(np.std(rates_1y)) if len(rates_1y) > 1 else None

    prev_rate   = history_1y[-2].rate if len(history_1y) >= 2 else None
    change_pct  = _pct_change(prev_rate, latest.rate) if prev_rate else None
    trend       = _trend_label(change_pct) if change_pct is not None else "flat"

    return RateSummary(
        currency_code=latest.currency_code,
        currency_name=latest.currency_name,
        latest_date=latest.date,
        latest_rate=latest.rate,
        prev_rate=prev_rate,
        change_percent=round(change_pct, 4) if change_pct is not None else None,
        high_1y=high_1y,
        low_1y=low_1y,
        volatility_1y=round(vol_1y, 4) if vol_1y is not None else None,
        trend=trend,
    )

def build_full_history(db: Session, currency_code: str) -> FullHistory | None:
    rows = crud.get_history(db, currency_code)
    if not rows:
        return None
    return FullHistory(
        currency_code=rows[0].currency_code,
        currency_name=rows[0].currency_name,
        history=[HistoryPoint(date=r.date, rate=r.rate) for r in rows],
    )

def build_all_summaries(db: Session) -> list[RateSummary]:
    currencies = crud.get_all_currencies(db)
    return [s for c in currencies if (s := build_summary(db, c[0]))]

def correlation_matrix(db: Session) -> dict:
    """Return Pearson correlation between all currency pairs (latest 60 months)."""
    currencies = crud.get_all_currencies(db)
    series: dict[str, list[float]] = {}
    for code, _name in currencies:
        rows = crud.get_history(db, code, limit=60)
        series[code] = [r.rate for r in rows]

    codes = list(series.keys())
    min_len = min(len(v) for v in series.values())
    matrix = {}
    for i, a in enumerate(codes):
        matrix[a] = {}
        for b in codes:
            x = np.array(series[a][-min_len:])
            y = np.array(series[b][-min_len:])
            corr = float(np.corrcoef(x, y)[0, 1]) if min_len > 1 else 1.0
            matrix[a][b] = round(corr, 3)
    return matrix
