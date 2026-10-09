"""
POST /api/scan
Body JSON:
  {
    "symbols": ["VCB", "FPT", ...],   # max ~15 per request (Vercel time limit)
    "start": "2025-01-01",
    "end": "2026-10-08",
    "delay": 0.3,
    "api_key": "optional vnstock key"
  }
Header optional: X-VNSTOCK-KEY

Runs sequential fetch in ONE process (Streamlit-style) with delay between symbols.
"""
from http.server import BaseHTTPRequestHandler
import json
import time
import traceback
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

# Writable dirs before any vnstock import
os.environ.setdefault("HOME", "/tmp")
os.environ.setdefault("XDG_CACHE_HOME", "/tmp/.cache")
os.environ.setdefault("XDG_CONFIG_HOME", "/tmp/.config")
os.environ.setdefault("TMPDIR", "/tmp")
for d in ("/tmp/.cache", "/tmp/.config", "/tmp/vnstock"):
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass

from _vnstock_util import (  # noqa: E402
    default_end,
    default_start,
    fetch_history,
    normalize_symbol,
)

MAX_SYMBOLS = 8
DEFAULT_DELAY = 0.3


def _register_key(api_key: str | None) -> str:
    if not api_key or not str(api_key).strip():
        return "none"
    key = str(api_key).strip()
    try:
        from vnstock import register_user

        register_user(key)
        return "ok"
    except Exception as e:
        # Non-fatal — still try public sources
        return f"error:{type(e).__name__}:{e}"


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
            if not isinstance(symbols_raw, list) or not symbols_raw:
                self._json(400, {"error": "symbols must be a non-empty array"})
                return

            # Dedupe + normalize, hard cap
            seen = set()
            symbols: list[str] = []
            for s in symbols_raw:
                sym = normalize_symbol(str(s))
                if sym and sym not in seen:
                    seen.add(sym)
                    symbols.append(sym)
            symbols = symbols[:MAX_SYMBOLS]

            start = str(body.get("start") or default_start(400))
            end = str(body.get("end") or default_end())
            delay = float(body.get("delay") if body.get("delay") is not None else DEFAULT_DELAY)
            delay = max(0.0, min(delay, 3.0))

            api_key = body.get("api_key") or self.headers.get("X-VNSTOCK-KEY")
            key_status = _register_key(api_key)

            data: dict[str, list] = {}
            errors: list[dict] = []
            t0 = time.time()

            for i, sym in enumerate(symbols):
                try:
                    rows = fetch_history(sym, start, end)
                    rows = [r for r in rows if start <= r["date"] <= end]
                    if rows:
                        data[sym] = rows
                    else:
                        errors.append({"symbol": sym, "error": "empty"})
                except Exception as e:
                    errors.append({"symbol": sym, "error": str(e)[:240]})
                if i < len(symbols) - 1 and delay > 0:
                    time.sleep(delay)

            self._json(
                200,
                {
                    "data": data,
                    "errors": errors,
                    "meta": {
                        "requested": len(symbols_raw),
                        "processed": len(symbols),
                        "ok": len(data),
                        "failed": len(errors),
                        "delay": delay,
                        "key_status": key_status,
                        "duration_sec": round(time.time() - t0, 2),
                        "max_symbols": MAX_SYMBOLS,
                    },
                    "source": "vnstock-scan",
                },
            )
        except Exception as e:
            self._json(
                500,
                {"error": str(e), "trace": traceback.format_exc()[-1200:]},
            )

    def do_GET(self):
        # Simple health for this route
        self._json(
            200,
            {
                "ok": True,
                "endpoint": "/api/scan",
                "method": "POST",
                "max_symbols": MAX_SYMBOLS,
                "default_delay": DEFAULT_DELAY,
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
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        return
