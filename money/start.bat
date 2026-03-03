@echo off
echo === FX Terminal ===
echo.

if not exist fx.db (
    echo 首次啟動：匯入 CSV 資料...
    python scripts\import_csv.py
    echo.
)

echo 啟動伺服器：http://localhost:8000
python run.py
pause
