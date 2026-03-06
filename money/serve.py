"""
Pure-static HTTP server for FX Intelligence Map.
Replaces the FastAPI backend – no dependencies beyond Python stdlib.

Usage:
    python serve.py
"""
import http.server
import os
import webbrowser
from pathlib import Path

PORT = 8000
FRONTEND = Path(__file__).parent / "frontend"

MIME_EXTRA = {
    ".js":   "application/javascript",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND), **kwargs)

    def end_headers(self):
        # Service Worker needs this header to control the full origin scope
        if self.path.rstrip("?").endswith("sw.js"):
            self.send_header("Service-Worker-Allowed", "/")
        # Cache-Control: let browser re-validate; SW handles offline
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    # Suppress per-request log noise
    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    if not (FRONTEND / "data.js").exists():
        print("[!] data.js not found. Run: python scripts/export_static.py")
        raise SystemExit(1)

    addr = ("", PORT)
    url  = f"http://localhost:{PORT}"
    print("=== FX Intelligence Map (static) ===")
    print(f"   {url}")
    print("   Ctrl+C to stop")

    with http.server.HTTPServer(addr, Handler) as httpd:
        webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止。")
