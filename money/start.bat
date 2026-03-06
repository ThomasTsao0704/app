@echo off
echo === FX Intelligence Map ===
echo.

if not exist fx.db (
    echo 首次啟動：匯入 CSV 資料...
    python scripts\import_csv.py
    echo.
)

echo 生成靜態資料...
python scripts\export_static.py
if errorlevel 1 (
    echo 匯出失敗，請確認 fx.db 是否存在。
    pause
    exit /b 1
)
echo.

echo 啟動靜態伺服器：http://localhost:8000
python serve.py
pause
