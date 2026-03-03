from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from datetime import date

from ..database import get_db
from ..schemas import RateSummary, FullHistory
from .. import crud, services

router = APIRouter(prefix="/api", tags=["rates"])

@router.get("/currencies")
def list_currencies(db: Session = Depends(get_db)):
    """所有幣別代碼與名稱"""
    rows = crud.get_all_currencies(db)
    return [{"code": r[0], "name": r[1]} for r in rows]

@router.get("/summary", response_model=list[RateSummary])
def all_summaries(db: Session = Depends(get_db)):
    """全部幣別的摘要（最新匯率、漲跌、波動率、趨勢）"""
    return services.build_all_summaries(db)

@router.get("/summary/{currency_code}", response_model=RateSummary)
def single_summary(currency_code: str, db: Session = Depends(get_db)):
    """單一幣別摘要"""
    result = services.build_summary(db, currency_code.upper())
    if not result:
        raise HTTPException(status_code=404, detail="幣別不存在")
    return result

@router.get("/history/{currency_code}", response_model=FullHistory)
def full_history(
    currency_code: str,
    since: Optional[date] = Query(None, description="起始日期 YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    """歷史匯率（可指定起始日期）"""
    if since:
        rows = crud.get_history_since(db, currency_code.upper(), since)
        if not rows:
            raise HTTPException(status_code=404, detail="無資料")
        from ..schemas import HistoryPoint
        return FullHistory(
            currency_code=rows[0].currency_code,
            currency_name=rows[0].currency_name,
            history=[HistoryPoint(date=r.date, rate=r.rate) for r in rows],
        )
    result = services.build_full_history(db, currency_code.upper())
    if not result:
        raise HTTPException(status_code=404, detail="幣別不存在")
    return result

@router.get("/correlation")
def correlation(db: Session = Depends(get_db)):
    """各幣別相關性矩陣（近 60 個月）"""
    return services.correlation_matrix(db)

@router.get("/meta")
def meta(db: Session = Depends(get_db)):
    """資料範圍資訊"""
    return crud.get_date_range(db)
