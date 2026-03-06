#!/bin/bash
echo "=== FX Intelligence Map ==="

if [ ! -f fx.db ]; then
    echo "首次啟動：匯入 CSV 資料..."
    python3 scripts/import_csv.py
    echo ""
fi

echo "生成靜態資料..."
python3 scripts/export_static.py || { echo "匯出失敗"; exit 1; }
echo ""

echo "啟動靜態伺服器：http://localhost:8000"
python3 serve.py
