"""
VNDirect finfo public API — optimized for Vercel scan speed.

Critical perf rules:
  - ONE HTTP call per OHLCV symbol (no multi-page unless forced)
  - NEVER download /stocks?status=all for a single company lookup
  - NO vnstock inside this module (caller decides fallback)
  - Short timeouts; in-process caches for warm instances
"""
from __future__ import annotations

import json
import math
import time
import urllib.request
from datetime import datetime, timedelta
from typing import Any, Optional
from urllib.parse import urlencode

API_STOCK_PRICES = "https://finfo-api.vndirect.com.vn/v4/stock_prices/"
API_STOCKS = "https://finfo-api.vndirect.com.vn/v4/stocks"
API_RATIOS = "https://finfo-api.vndirect.com.vn/v4/ratios"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# Keep requests snappy on Vercel
HTTP_TIMEOUT = 8

INDEX_ALIASES = {
    "VNINDEX": "VNINDEX",
    "VN-INDEX": "VNINDEX",
    "VN30": "VN30",
    "HNX": "HNX",
    "HNXINDEX": "HNX",
    "HNX-INDEX": "HNX",
    "UPCOM": "UPCOM",
    "UPCOMINDEX": "UPCOM",
}

SECTOR_FALLBACK: dict[str, str] = {
    "VCB": "Banks", "TCB": "Banks", "MBB": "Banks", "BID": "Banks", "CTG": "Banks",
    "VPB": "Banks", "ACB": "Banks", "HDB": "Banks", "STB": "Banks", "TPB": "Banks",
    "LPB": "Banks", "SSB": "Banks", "VIB": "Banks", "OCB": "Banks", "MSB": "Banks",
    "EIB": "Banks", "SHB": "Banks", "NAB": "Banks", "ABB": "Banks", "BAB": "Banks",
    "BVB": "Banks", "PGB": "Banks", "VBB": "Banks", "KLB": "Banks", "VAB": "Banks",
    "SSI": "Securities", "VND": "Securities", "HCM": "Securities", "VCI": "Securities",
    "SHS": "Securities", "MBS": "Securities", "FTS": "Securities", "CTS": "Securities",
    "ORS": "Securities", "BSI": "Securities", "VIX": "Securities", "AAS": "Securities",
    "AGR": "Securities", "BVS": "Securities",
    "VIC": "Real Estate", "VHM": "Real Estate", "VRE": "Real Estate", "NVL": "Real Estate",
    "PDR": "Real Estate", "DXG": "Real Estate", "KDH": "Real Estate", "NLG": "Real Estate",
    "BCM": "Real Estate", "DIG": "Real Estate", "CEO": "Real Estate", "HDG": "Real Estate",
    "KBC": "Real Estate", "IDC": "Real Estate",
    "FPT": "Technology", "CMG": "Technology", "ELC": "Technology", "FOX": "Technology",
    "HPG": "Manufacturing", "HSG": "Manufacturing", "NKG": "Manufacturing",
    "DGC": "Manufacturing", "GVR": "Manufacturing", "DCM": "Manufacturing",
    "DPM": "Manufacturing", "BMP": "Manufacturing", "AAA": "Manufacturing",
    "GAS": "Other", "PLX": "Other", "POW": "Other", "PVD": "Other", "BSR": "Other",
    "PVT": "Shipping & Ports", "GMD": "Shipping & Ports", "PVS": "Other",
    "VNM": "Other", "MSN": "Other", "MWG": "Other", "PNJ": "Other", "SAB": "Other",
    "REE": "Other", "VJC": "Other", "HVN": "Other", "BVH": "Other",
}

# Warm-instance caches (survive across invocations on same Vercel instance)
_history_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_company_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL = 6 * 3600  # 6h


def normalize_symbol(symbol: str) -> str:
    s = (symbol or "").strip().upper()
    return INDEX_ALIASES.get(s, s)


def default_start(days: int = 400) -> str:
    return (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")


def default_end() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d")


def _safe_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _http_get_json(url: str, timeout: int = HTTP_TIMEOUT) -> Any:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://dstock.vndirect.com.vn/",
            "Origin": "https://dstock.vndirect.com.vn",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw)


def fetch_history(symbol: str, start: str, end: str) -> list[dict[str, Any]]:
    """Single-request OHLCV. ~1 HTTP call, typically <1s."""
    symbol = normalize_symbol(symbol)
    start = start[:10]
    end = end[:10]
    cache_key = f"{symbol}|{start}|{end}"
    now = time.time()
    hit = _history_cache.get(cache_key)
    if hit and now - hit[0] < _CACHE_TTL:
        return hit[1]

    try:
        d0 = datetime.strptime(start, "%Y-%m-%d")
        d1 = datetime.strptime(end, "%Y-%m-%d")
        # trading days ≈ calendar * 0.7; pad a bit
        size = min(max(int((d1 - d0).days * 0.75) + 20, 60), 1500)
    except Exception:
        size = 400

    q = f"code:{symbol}~date:gte:{start}~date:lte:{end}"
    params = urlencode({"sort": "date", "size": size, "page": 1, "q": q})
    url = f"{API_STOCK_PRICES}?{params}"
    payload = _http_get_json(url)
    data = payload.get("data") if isinstance(payload, dict) else None
    if not data:
        raise RuntimeError(f"VNDirect empty history for {symbol}")

    rows: list[dict[str, Any]] = []
    for item in data:
        date = str(item.get("date") or "")[:10]
        o = _safe_float(item.get("open"))
        h = _safe_float(item.get("high"))
        l = _safe_float(item.get("low"))
        c = _safe_float(item.get("adClose")) or _safe_float(item.get("close"))
        vol = _safe_float(item.get("nmVolume")) or _safe_float(item.get("volume")) or 0.0
        val = _safe_float(item.get("value")) or _safe_float(item.get("nmValue"))
        if not date or o is None or h is None or l is None or c is None:
            continue
        if min(o, h, l, c) <= 0:
            continue
        bar: dict[str, Any] = {
            "symbol": symbol,
            "date": date,
            "open": o,
            "high": h,
            "low": l,
            "close": c,
            "volume": vol,
        }
        if val is not None and val >= 0:
            bar["value"] = val
        rows.append(bar)

    rows.sort(key=lambda r: r["date"])
    # de-dupe
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for r in rows:
        if r["date"] in seen:
            continue
        seen.add(r["date"])
        out.append(r)

    if not out:
        raise RuntimeError(f"VNDirect parsed 0 bars for {symbol}")

    _history_cache[cache_key] = (now, out)
    # prevent unbounded growth
    if len(_history_cache) > 400:
        oldest = sorted(_history_cache.items(), key=lambda kv: kv[1][0])[:80]
        for k, _ in oldest:
            _history_cache.pop(k, None)
    return out


def fetch_company(symbol: str) -> dict[str, Any]:
    """
    Fast company profile:
      1) in-memory cache
      2) one light v4/stocks call
      3) sector fallback map — NEVER download full universe
    """
    symbol = normalize_symbol(symbol)
    now = time.time()
    hit = _company_cache.get(symbol)
    if hit and now - hit[0] < _CACHE_TTL:
        return hit[1]

    record: dict[str, Any] = {}
    try:
        params = urlencode({"q": f"code:{symbol}", "size": 1})
        payload = _http_get_json(f"{API_STOCKS}?{params}", timeout=6)
        data = payload.get("data") if isinstance(payload, dict) else None
        if isinstance(data, list) and data:
            record = data[0]
        elif isinstance(data, dict):
            record = data
    except Exception:
        record = {}

    def pick(*keys: str) -> Any:
        low = {str(k).lower().replace(" ", "_"): v for k, v in record.items()}
        for key in keys:
            v = low.get(key.lower().replace(" ", "_"))
            if v is not None and str(v).strip() not in ("", "null", "None", "nan"):
                return v
        return None

    name = str(pick("companyname", "company_name", "organname", "name", "shortname") or symbol)
    floor = str(pick("floor", "exchange", "board") or "").upper()
    if "HNX" in floor:
        exchange = "HNX"
    elif "UPCOM" in floor:
        exchange = "UPCOM"
    else:
        exchange = "HOSE"

    industry = pick("industryname", "industry", "icbname", "sectorname")
    sector_raw = str(pick("sectorname", "sector", "industryname") or "")
    sector_group = SECTOR_FALLBACK.get(symbol)
    if not sector_group and sector_raw:
        t = sector_raw.lower()
        if any(x in t for x in ("bank", "ngân hàng", "ngan hang")):
            sector_group = "Banks"
        elif any(x in t for x in ("securit", "chứng khoán", "chung khoan")):
            sector_group = "Securities"
        elif any(x in t for x in ("real estate", "bất động sản", "bat dong san")):
            sector_group = "Real Estate"
        elif any(x in t for x in ("tech", "công nghệ", "cong nghe")):
            sector_group = "Technology"
        else:
            sector_group = "Other"
    if not sector_group:
        sector_group = "Other"

    out = {
        "symbol": symbol,
        "name": name,
        "exchange": exchange,
        "sector": sector_group,
        "sectorGroup": sector_group,
        "industry": str(industry).strip() if industry else None,
        "source": "vndirect:finfo/stocks" if record else "sector-fallback",
        "dataAvailable": bool(record),
        "notes": [],
    }
    _company_cache[symbol] = (now, out)
    return out


def fetch_fundamentals(symbol: str) -> dict[str, Any]:
    """
    Fast path: 1 ratios call + reuse company cache.
    Does NOT call vnstock. Sparse ratios are OK — FE shows N/A.
    """
    symbol = normalize_symbol(symbol)
    found: dict[str, Optional[float]] = {
        "roe": None,
        "roa": None,
        "pe": None,
        "pb": None,
        "eps": None,
        "debtToEquity": None,
        "revenueGrowth": None,
        "epsGrowth": None,
    }

    try:
        params = urlencode(
            {"q": f"code:{symbol}", "size": 5, "sort": "reportDate:desc"}
        )
        payload = _http_get_json(f"{API_RATIOS}?{params}", timeout=6)
        data = payload.get("data") if isinstance(payload, dict) else None
        row = None
        if isinstance(data, list) and data:
            row = data[0]
        elif isinstance(data, dict):
            row = data
        if row:
            mapping = {
                "roe": ("roe", "ROE", "returnOnEquity"),
                "roa": ("roa", "ROA", "returnOnAssets"),
                "pe": ("pe", "PE", "priceToEarning", "priceToEarnings"),
                "pb": ("pb", "PB", "priceToBook"),
                "eps": ("eps", "EPS", "earningPerShare"),
                "debtToEquity": ("debtEquity", "debtToEquity", "de"),
            }
            for field, keys in mapping.items():
                for k in keys:
                    if k in row and found[field] is None:
                        found[field] = _safe_float(row[k])
    except Exception:
        pass

    # Also try embedding from stocks payload (same call as company if cold)
    company = fetch_company(symbol)
    available = any(v is not None for v in found.values())

    return {
        "symbol": symbol,
        **found,
        "sector": company.get("sector"),
        "industry": company.get("industry"),
        "name": company.get("name"),
        "exchange": company.get("exchange"),
        "source": "vndirect:finfo",
        "dataAvailable": available,
        "notes": []
        if available
        else [
            "VNDirect public ratios sparse for this symbol; OHLCV/sector still OK."
        ],
    }


def fetch_sector_universe() -> dict[str, Any]:
    """Built from SECTOR_FALLBACK only — instant, no huge HTTP download."""
    rows = [
        {
            "symbol": sym,
            "industry": None,
            "sectorGroup": sector,
            "sectorSource": "static-fallback",
        }
        for sym, sector in sorted(SECTOR_FALLBACK.items())
    ]
    return {
        "source": "static-sector-map",
        "count": len(rows),
        "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "data": rows,
        "note": "Lightweight map for scanner filters. Expand via VNDirect stocks list offline if needed.",
    }
