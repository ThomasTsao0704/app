from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
import os

from .database import engine
from .models import Base
from .routes.rates import router
from .routes.intelligence import router as intel_router

# Build tables on startup
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Global FX Intelligence Map",
    description="全球外匯智能地圖 – Geo + Capital + City",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(intel_router)

# Serve PWA frontend
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/")
    def index():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

    @app.get("/sw.js")
    def service_worker():
        """Serve the service worker from root scope so it can control the entire origin."""
        sw_path = os.path.join(FRONTEND_DIR, "sw.js")
        content = open(sw_path, "rb").read()
        return Response(
            content=content,
            media_type="application/javascript",
            headers={"Service-Worker-Allowed": "/"},
        )

    @app.get("/favicon.ico", include_in_schema=False)
    def favicon():
        return FileResponse(os.path.join(FRONTEND_DIR, "icon-192.png"), media_type="image/png")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        """SPA catch-all: return index.html for any non-API path."""
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
