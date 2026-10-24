"""
POST /api/scan — sequential OHLCV via VNDirect (fast path).

Body:
  { "symbols": ["VCB","FPT",...], "start": "...", "end": "...", "delay": 0.05 }

No vnstock fallback by default — that was the timeout source.
maxDuration should be set high on Vercel for large chunks.
"""
from http.server import BaseHTTPRequestHandler
import json
import time
import traceback
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("HOME", "/tmp")
os.environ.setdefault("XDG_CACHE_HOME", "/tmp/.cache")
os.environ.setdefault("TMPDIR", "/tmp")

from _vndirect_util import (  # noqa: E402
    default_end,
    default_start,
    normalize_symbol,
    fetch_history,
)

MAX_SYMBOLS = 25  # VNDirect is light; stay under ~50s total
DEFAULT_DELAY = 0.05


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                self._json(400, {"error": "Invalid JSON body"})
                return

            symbols_raw = body.get("symbols") or []
            if isinstance(symbols_raw, str):
                symbols_raw = [s.strip() for s in symbols_raw.split(",") if s.strip()]
            symbols = []
            seen = set()
            for s in symbols_raw:
                sym = normalize_symbol(str(s))
                if sym and sym not in seen:
                    seen.add(sym)
                    symbols.append(sym)
            symbols = symbols[:MAX_SYMBOLS]

            start = str(body.get("start") or default_start(400))[:10]
            end = str(body.get("end") or default_end())[:10]
            try:
                delay = float(body.get("delay", DEFAULT_DELAY))
            except (TypeError, ValueError):
                delay = DEFAULT_DELAY
            delay = max(0.0, min(delay, 1.0))

            if not symbols:
                self._json(400, {"error": "symbols required"})
                return

            results = {}
            errors = []
            t0 = time.time()
            for i, sym in enumerate(symbols):
                try:
                    bars = fetch_history(sym, start, end)
                    bars = [b for b in bars if start <= b["date"] <= end]
                    results[sym] = bars
                except Exception as e:
                    errors.append({"symbol": sym, "error": str(e)[:200]})
                    results[sym] = []
                if delay and i < len(symbols) - 1:
                    time.sleep(delay)

            self._json(
                200,
                {
                    "data": results,
                    "errors": errors,
                    "source": "vndirect",
                    "count": {k: len(v) for k, v in results.items()},
                    "durationMs": int((time.time() - t0) * 1000),
                    "symbols": symbols,
                },
            )
        except Exception as e:
            self._json(
                500,
                {"error": str(e)[:400], "trace": traceback.format_exc()[-800:]},
            )

    def do_GET(self):
        self._json(
            200,
            {
                "ok": True,
                "usage": "POST JSON {symbols, start, end, delay}",
                "maxSymbols": MAX_SYMBOLS,
                "source": "vndirect",
            },
        )

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-VNSTOCK-KEY",
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
