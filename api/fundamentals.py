from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
import _env_setup  # noqa: F401, E402
from _vndirect_util import fetch_fundamentals  # noqa: E402
from _rate_limit import soft_fundamentals  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        qs = parse_qs(urlparse(self.path).query)
        symbol = (qs.get("symbol") or ["VCB"])[0]
        try:
            data = fetch_fundamentals(symbol)
            self._json(200, {"data": data, "symbol": symbol.upper(), "source": data.get("source", "vndirect")})
        except Exception as e:
            soft = soft_fundamentals(symbol, e)
            self._json(200, {"data": soft, "symbol": symbol.upper(), "source": "soft-fallback", "error": str(e)[:200]})

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-VNSTOCK-KEY")

    def _json(self, status: int, body: dict):
        payload = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        return
