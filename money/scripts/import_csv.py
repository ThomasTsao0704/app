"""
scripts/import_csv.py
─────────────────────
讀取 data/exchange_rates.csv（雙標題列格式），匯入 SQLite。

CSV 格式：
  Row 1 → 幣別, 台幣, 日幣, 人民幣, 港幣, 韓幣, 泰銖, 新加坡幣, 澳幣, 歐元
  Row 2 → 日期, NTBD, JPYD, PGDD, HKDD, KRDD, TBDD, SGDD, AUDD, XEUD
  Row 3+ → 2004/02/01 00:00, 33.35, ...
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
from datetime import datetime
from sqlalchemy.orm import Session
from app.database import SessionLocal, engine
from app.models import Base, ExchangeRate

# ── Bootstrap DB ──────────────────────────────────────────────────────────
Base.metadata.create_all(bind=engine)

CSV_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "exchange_rates.csv")

# ── Read both header rows ──────────────────────────────────────────────────
raw = pd.read_csv(CSV_PATH, header=None, encoding="utf-8-sig")

name_row = raw.iloc[0].tolist()   # Chinese names: 幣別, 台幣, ...
code_row = raw.iloc[1].tolist()   # Codes:         日期, NTBD, ...
data     = raw.iloc[2:].reset_index(drop=True)
data.columns = code_row           # assign code row as columns

# Build name lookup  { code: name }
name_lookup = {code_row[i]: name_row[i] for i in range(1, len(code_row))}

currency_cols = code_row[1:]  # all except '日期'

# ── Import ─────────────────────────────────────────────────────────────────
db: Session = SessionLocal()

# Clear existing data to allow re-import
db.query(ExchangeRate).delete()
db.commit()

records = []
for _, row in data.iterrows():
    raw_date = str(row["日期"]).strip()
    try:
        parsed_date = datetime.strptime(raw_date[:10], "%Y/%m/%d").date()
    except ValueError:
        print(f"  ⚠ 跳過無效日期: {raw_date}")
        continue

    for code in currency_cols:
        val = row[code]
        try:
            rate = float(val)
        except (ValueError, TypeError):
            continue

        records.append(ExchangeRate(
            date=parsed_date,
            currency_code=code,
            currency_name=name_lookup.get(code, code),
            rate=rate,
        ))

db.bulk_save_objects(records)
db.commit()
db.close()

print(f"✅ 匯入完成：{len(records)} 筆資料（{len(currency_cols)} 種幣別）")
