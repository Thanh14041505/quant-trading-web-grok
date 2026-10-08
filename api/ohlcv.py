from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import traceback
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from _vnstock_util import default_end, default_start, fetch_history  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            symbol = (qs.get("symbol") or ["VCB"])[0]
            start = (qs.get("start") or [default_start(500)])[0]
            end = (qs.get("end") or [default_end()])[0]

            rows = fetch_history(symbol, start, end)
            rows = [r for r in rows if start <= r["date"] <= end]
            self._json(
                200,
                {"data": rows, "symbol": symbol.upper(), "source": "vnstock"},
            )
        except Exception as e:
            self._json(
                500,
                {"error": str(e), "trace": traceback.format_exc()[-1200:]},
            )

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers", "Content-Type, Authorization"
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
