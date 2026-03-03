#!/bin/bash
echo "=== FX Terminal ==="

if [ ! -f fx.db ]; then
    echo "首次啟動：匯入 CSV 資料..."
    python3 scripts/import_csv.py
    echo ""
fi

echo "啟動伺服器：http://localhost:8000"
python3 run.py
