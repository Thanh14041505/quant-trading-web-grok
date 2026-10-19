"""GET /api/company?symbol= — VNDirect first, soft fallback."""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import traceback
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
import _env_setup  # noqa: F401, E402
from _vndirect_util import fetch_company as vnd_company  # noqa: E402
from _rate_limit import soft_company  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        qs = parse_qs(urlparse(self.path).query)
        symbol = (qs.get("symbol") or ["VCB"])[0]
        try:
            data = vnd_company(symbol)
            # optional enrich via vnstock only if sector still generic
            if data.get("sector") in (None, "Other", "Unknown") and data.get("dataAvailable") is False:
                try:
                    from _vnstock_util import fetch_company as vs_company, configure_vnstock_key, key_from_request
                    configure_vnstock_key(key_from_request(self))
                    vs = vs_company(symbol)
                    if vs.get("sector") and vs.get("sector") != "Other":
                        data = {**data, **{k: v for k, v in vs.items() if v is not None}}
                        data["source"] = f"vndirect+{vs.get('source', 'vnstock')}"
                except Exception:
                    pass
            self._json(200, {"data": data, "symbol": symbol.upper(), "source": data.get("source", "vndirect")})
        except Exception as e:
            soft = soft_company(symbol, e)
            self._json(
                200,
                {
                    "data": soft,
                    "symbol": symbol.upper(),
                    "source": "soft-fallback",
                    "error": soft.get("code"),
                    "message": soft.get("message"),
                    "trace": traceback.format_exc()[-400:],
                },
            )

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers", "Content-Type, Authorization, X-VNSTOCK-KEY"
        )

    def _json(self, status: int, body: dict):
        payload = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        return
