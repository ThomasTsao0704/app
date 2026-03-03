from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..geo_engine import build_geo_data, CITY_DATA
from ..capital_engine import ranking, alerts
from .. import crud

router = APIRouter(prefix="/api", tags=["intelligence"])


@router.get("/geo")
def geo(db: Session = Depends(get_db)):
    """Currency geo data: PPP deviation, momentum, volatility, coordinates."""
    return build_geo_data(db)


@router.get("/city")
def city(db: Session = Depends(get_db)):
    """City purchasing power comparison, enriched with current exchange rates."""
    result = []
    for c in CITY_DATA:
        usd_rate = None
        if c["currency_code"]:
            latest   = crud.get_latest_rate(db, c["currency_code"])
            usd_rate = latest.rate if latest else None

        purchasing_power = round((c["avg_salary_usd"] / c["cost_index"]) * 100, 1)

        result.append({
            **c,
            "purchasing_power": purchasing_power,
            "usd_rate":         usd_rate,
        })

    result.sort(key=lambda x: x["purchasing_power"], reverse=True)
    return result


@router.get("/capital")
def capital(db: Session = Depends(get_db)):
    """Currency strength ranking sorted by composite momentum."""
    return ranking(db)


@router.get("/alerts")
def investment_alerts(db: Session = Depends(get_db)):
    """Actionable investment alerts based on momentum, PPP, and volatility."""
    return alerts(db)
