from sqlalchemy import Column, Integer, String, Float, Date
from .database import Base

class ExchangeRate(Base):
    __tablename__ = "exchange_rates"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, index=True)
    currency_code = Column(String(10), index=True)   # e.g. NTBD, JPYD
    currency_name = Column(String(20))               # e.g. 台幣, 日幣
    rate = Column(Float)                             # 1 USD = rate units
