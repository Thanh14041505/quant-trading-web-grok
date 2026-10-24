from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
import _env_setup  # noqa: F401, E402
from _vnstock_util import configure_vnstock_key, fetch_sector_universe, key_from_request  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            query = parse_qs(urlparse(self.path).query)
            force = (query.get("refresh") or [""])[0].strip().lower() in (
                "1",
                "true",
                "yes",
            )
            configure_vnstock_key(key_from_request(self))
            body = fetch_sector_universe(force_refresh=force)
            payload = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header(
                "Cache-Control", "s-maxage=3600, stale-while-revalidate=86400"
            )
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as error:
            payload = json.dumps(
                {
                    "error": str(error)[:320],
                    "code": "VNSTOCK_SECTOR_UNIVERSE_ERROR",
                }
            ).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-VNSTOCK-KEY",
        )
        self.end_headers()

    def log_message(self, format, *args):
        return
