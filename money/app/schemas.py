from pydantic import BaseModel
from datetime import date
from typing import Optional

class RateBase(BaseModel):
    date: date
    currency_code: str
    currency_name: str
    rate: float

class RateOut(RateBase):
    id: int
    class Config:
        from_attributes = True

class RateSummary(BaseModel):
    currency_code: str
    currency_name: str
    latest_date: date
    latest_rate: float
    prev_rate: Optional[float]
    change_percent: Optional[float]
    high_1y: Optional[float]
    low_1y: Optional[float]
    volatility_1y: Optional[float]
    trend: str   # "up" | "down" | "flat"

class HistoryPoint(BaseModel):
    date: date
    rate: float

class FullHistory(BaseModel):
    currency_code: str
    currency_name: str
    history: list[HistoryPoint]
