import requests
import pandas as pd
import time
from datetime import datetime

stock = "0050"
start_year = 2003
end_year = datetime.now().year

price_data = []
units_data = []


# -------------------------
# 1. Fetch ETF price data
# -------------------------

for year in range(start_year, end_year + 1):
    for month in range(1, 13):

        date = f"{year}{month:02d}01"
        url = f"https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date={date}&stockNo={stock}"

        try:
            r = requests.get(url)
            j = r.json()

            if "data" in j:
                for row in j["data"]:
                    price_data.append({
                        "date":         row[0],
                        "traded":       row[1].replace(",", ""),
                        "transaction":  row[2].replace(",", ""),
                        "open":         row[3],
                        "high":         row[4],
                        "low":          row[5],
                        "close":        row[6],
                        "difference":   row[7],
                        "transactions": row[8].replace(",", ""),
                    })

            print("price", year, month)

            time.sleep(0.5)

        except:
            pass


price_df = pd.DataFrame(price_data)
price_df.to_csv("0050_price.csv", index=False)


if units_data:
    units_df = pd.DataFrame(units_data)
    units_df.to_csv("0050_units.csv", index=False)

    # -------------------------
    # 5. ETF units flow
    # -------------------------

    flow = units_df.copy()
    if "units" in flow.columns:
        flow["units_change"] = flow["units"].diff()
    else:
        print("units_data missing 'units' column; skipping units_change.")

    flow.to_csv("0050_flow.csv", index=False)
else:
    print("units_data is empty; skipping units/flow.")

print("done")
