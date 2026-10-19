"""GET /api/fundamentals?symbol= — VNDirect first, vnstock enrich if sparse."""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import traceback
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
import _env_setup  # noqa: F401, E402
from _vndirect_util import fetch_fundamentals as vnd_fundamentals  # noqa: E402
from _rate_limit import is_rate_limited, soft_fundamentals  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        qs = parse_qs(urlparse(self.path).query)
        symbol = (qs.get("symbol") or ["VCB"])[0]
        try:
            data = vnd_fundamentals(symbol)
            # If VNDirect ratios sparse, try vnstock once (may rate-limit)
            if not data.get("dataAvailable"):
                try:
                    from _vnstock_util import (
                        fetch_fundamentals as vs_fundamentals,
                        configure_vnstock_key,
                        key_from_request,
                    )
                    configure_vnstock_key(key_from_request(self))
                    vs = vs_fundamentals(symbol, include_history=False)
                    # merge non-null vs fields
                    for k, v in vs.items():
                        if v is not None and data.get(k) is None:
                            data[k] = v
                    if vs.get("dataAvailable"):
                        data["dataAvailable"] = True
                        data["source"] = f"vndirect+{vs.get('source', 'vnstock')}"
                except Exception as e:
                    data.setdefault("notes", []).append(f"vnstock-enrich-skipped:{type(e).__name__}")
                    if is_rate_limited(e):
                        data.setdefault("notes", []).append("VNSTOCK_RATE_LIMIT during enrich")

            self._json(
                200,
                {"data": data, "symbol": symbol.upper(), "source": data.get("source", "vndirect")},
            )
        except Exception as e:
            soft = soft_fundamentals(symbol, e)
            status = 429 if is_rate_limited(e) else 200
            self._json(
                status,
                {
                    "data": soft,
                    "symbol": symbol.upper(),
                    "source": "soft-fallback",
                    "error": soft.get("code"),
                    "message": soft.get("message"),
                    "trace": traceback.format_exc()[-400:] if not is_rate_limited(e) else None,
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
        if status == 429:
            self.send_header("Retry-After", "60")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        return
