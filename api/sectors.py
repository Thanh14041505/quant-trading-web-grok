from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
import _env_setup  # noqa: F401, E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            from _vndirect_util import fetch_sector_universe
            body = fetch_sector_universe()
            payload = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as error:
            # fallback vnstock map
            try:
                from _vnstock_util import configure_vnstock_key, fetch_sector_universe as vs_sectors, key_from_request
                configure_vnstock_key(key_from_request(self))
                body = vs_sectors(force_refresh=False)
                payload = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except Exception as e2:
                payload = json.dumps({
                    "error": str(e2)[:320],
                    "code": "SECTOR_UNIVERSE_ERROR",
                    "vndirect": str(error)[:160],
                }).encode("utf-8")
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
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-VNSTOCK-KEY")
        self.end_headers()

    def log_message(self, format, *args):
        return
