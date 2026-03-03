from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date, timedelta
from .models import ExchangeRate

def get_all_currencies(db: Session):
    return (
        db.query(ExchangeRate.currency_code, ExchangeRate.currency_name)
        .distinct()
        .all()
    )

def get_latest_rate(db: Session, currency_code: str) -> ExchangeRate | None:
    return (
        db.query(ExchangeRate)
        .filter(ExchangeRate.currency_code == currency_code)
        .order_by(ExchangeRate.date.desc())
        .first()
    )

def get_history(db: Session, currency_code: str, limit: int = None) -> list[ExchangeRate]:
    q = (
        db.query(ExchangeRate)
        .filter(ExchangeRate.currency_code == currency_code)
        .order_by(ExchangeRate.date.asc())
    )
    if limit:
        q = q.limit(limit)
    return q.all()

def get_history_since(db: Session, currency_code: str, since: date) -> list[ExchangeRate]:
    return (
        db.query(ExchangeRate)
        .filter(
            ExchangeRate.currency_code == currency_code,
            ExchangeRate.date >= since,
        )
        .order_by(ExchangeRate.date.asc())
        .all()
    )

def get_date_range(db: Session):
    result = db.query(
        func.min(ExchangeRate.date),
        func.max(ExchangeRate.date),
    ).first()
    return {"min_date": result[0], "max_date": result[1]}
