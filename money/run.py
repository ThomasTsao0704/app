"""run.py – 一鍵啟動"""
import os, sys

project_root = os.path.dirname(__file__)
sys.path.insert(0, project_root)

import uvicorn

if __name__ == "__main__":
    print("🚀  FX Terminal 啟動中…")
    print("📦  首次使用請先執行: python scripts/import_csv.py")
    print("🌐  開啟瀏覽器: http://localhost:8000")
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
