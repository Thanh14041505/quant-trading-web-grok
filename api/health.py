from http.server import BaseHTTPRequestHandler
import json
import os


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = {
            "ok": True,
            "service": "vn-quant-api",
            "provider": "vnstock",
            "vnstock_key_configured": bool(os.getenv("VNSTOCK_API_KEY")),
            "endpoints": [
                "/api/health",
                "/api/ohlcv",
                "/api/index",
                "/api/scan",
                "/api/company",
                "/api/fundamentals",
                "/api/sectors",
            ],
            "note": (
                "VNDirect disabled on Vercel (finfo-api timeout from US regions). "
                "All market data via vnstock. Set VNSTOCK_API_KEY for 60 req/min."
            ),
        }
        self._json(200, body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-VNSTOCK-KEY",
        )

    def _json(self, status: int, body: dict):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        return
