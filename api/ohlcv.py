"""GET /api/ohlcv?symbol=&start=&end= — prefer VNDirect, fallback vnstock."""
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import traceback
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
import _env_setup  # noqa: F401, E402
from _vndirect_util import default_end, default_start, fetch_history as vnd_history  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            symbol = (qs.get("symbol") or ["VCB"])[0]
            start = (qs.get("start") or [default_start(500)])[0]
            end = (qs.get("end") or [default_end()])[0]
            source = "vndirect"
            try:
                rows = vnd_history(symbol, start, end)
            except Exception as vnd_err:
                # optional vnstock fallback
                try:
                    from _vnstock_util import fetch_history as vs_history, configure_vnstock_key, key_from_request
                    configure_vnstock_key(key_from_request(self))
                    rows = vs_history(symbol, start, end)
                    source = "vnstock-fallback"
                except Exception as vs_err:
                    raise RuntimeError(
                        f"VNDirect failed: {vnd_err}; vnstock fallback: {vs_err}"
                    ) from vs_err

            rows = [r for r in rows if start[:10] <= r["date"] <= end[:10]]
            self._json(
                200,
                {"data": rows, "symbol": symbol.upper(), "source": source, "count": len(rows)},
            )
        except Exception as e:
            self._json(
                500,
                {"error": str(e)[:400], "trace": traceback.format_exc()[-800:]},
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
