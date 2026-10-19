"""
VNDirect finfo public API helpers (no API key, no vnstock rate limit).

Primary reference:
  https://github.com/phamdinhkhanh/vnquant/issues/6
  GET https://finfo-api.vndirect.com.vn/v4/stock_prices/
      ?sort=date&size=N&page=1&q=code:SYMBOL~date:gte:START~date:lte:END

Also:
  GET https://finfo-api.vndirect.com.vn/v4/stocks?q=code:SYMBOL
  GET https://finfo-api.vndirect.com.vn/stocks?status=all  (universe / sector)
"""
from __future__ import annotations

import math
import time
from datetime import datetime, timedelta
from typing import Any, Optional
from urllib.parse import urlencode

import urllib.request
import json

API_STOCK_PRICES = "https://finfo-api.vndirect.com.vn/v4/stock_prices/"
API_STOCKS = "https://finfo-api.vndirect.com.vn/v4/stocks"
API_STOCKS_ALL = "https://finfo-api.vndirect.com.vn/stocks"
API_RATIOS = "https://finfo-api.vndirect.com.vn/v4/ratios"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# Index code aliases on VNDirect
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

# Sector fallback when stock profile missing
SECTOR_FALLBACK: dict[str, str] = {
    "VCB": "Banks", "TCB": "Banks", "MBB": "Banks", "BID": "Banks", "CTG": "Banks",
    "VPB": "Banks", "ACB": "Banks", "HDB": "Banks", "STB": "Banks", "TPB": "Banks",
    "LPB": "Banks", "SSB": "Banks", "VIB": "Banks", "OCB": "Banks", "MSB": "Banks",
    "EIB": "Banks", "SHB": "Banks", "NAB": "Banks", "ABB": "Banks",
    "SSI": "Securities", "VND": "Securities", "HCM": "Securities", "VCI": "Securities",
    "SHS": "Securities", "MBS": "Securities", "FTS": "Securities", "CTS": "Securities",
    "ORS": "Securities", "BSI": "Securities", "VIX": "Securities", "AAS": "Securities",
    "VIC": "Real Estate", "VHM": "Real Estate", "VRE": "Real Estate", "NVL": "Real Estate",
    "PDR": "Real Estate", "DXG": "Real Estate", "KDH": "Real Estate", "NLG": "Real Estate",
    "FPT": "Technology", "CMG": "Technology", "ELC": "Technology", "FOX": "Technology",
    "HPG": "Manufacturing", "HSG": "Manufacturing", "DGC": "Manufacturing", "GVR": "Manufacturing",
    "GAS": "Other", "PLX": "Other", "POW": "Other", "PVD": "Other", "PVT": "Shipping & Ports",
    "PVS": "Other", "VNM": "Other", "MSN": "Other", "MWG": "Other", "PNJ": "Other",
}


def normalize_symbol(symbol: str) -> str:
    s = (symbol or "").strip().upper()
    return INDEX_ALIASES.get(s, s)


def default_start(days: int = 400) -> str:
    return (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")


def default_end() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d")


def _http_get_json(url: str, timeout: int = 25) -> Any:
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


def fetch_history(symbol: str, start: str, end: str) -> list[dict[str, Any]]:
    """
    OHLCV from VNDirect finfo stock_prices.
    Prices are typically in VND thousands (same as exchange board).
    """
    symbol = normalize_symbol(symbol)
    try:
        d0 = datetime.strptime(start[:10], "%Y-%m-%d")
        d1 = datetime.strptime(end[:10], "%Y-%m-%d")
        size = max((d1 - d0).days + 5, 30)
    except Exception:
        size = 500

    # Cap page size; paginate if needed
    page = 1
    all_rows: list[dict[str, Any]] = []
    while True:
        q = f"code:{symbol}~date:gte:{start[:10]}~date:lte:{end[:10]}"
        params = urlencode(
            {"sort": "date", "size": min(size, 5000), "page": page, "q": q}
        )
        url = f"{API_STOCK_PRICES}?{params}"
        payload = _http_get_json(url)
        data = payload.get("data") if isinstance(payload, dict) else None
        if not data:
            break
        for item in data:
            date = str(item.get("date") or "")[:10]
            o = _safe_float(item.get("open"))
            h = _safe_float(item.get("high"))
            l = _safe_float(item.get("low"))
            # prefer adjusted close when present
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
            all_rows.append(bar)

        total = int(payload.get("totalElements") or payload.get("total") or 0)
        if len(data) < min(size, 5000) or (total and len(all_rows) >= total):
            break
        page += 1
        if page > 20:
            break
        time.sleep(0.05)

    all_rows.sort(key=lambda r: r["date"])
    # de-dupe by date
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for r in all_rows:
        if r["date"] in seen:
            continue
        seen.add(r["date"])
        out.append(r)
    if not out:
        raise RuntimeError(f"VNDirect returned no bars for {symbol} ({start}→{end})")
    return out


def fetch_company(symbol: str) -> dict[str, Any]:
    """Company profile from VNDirect stocks endpoint."""
    symbol = normalize_symbol(symbol)
    errors: list[str] = []
    record: dict[str, Any] = {}

    # v4 stocks by code
    try:
        params = urlencode({"q": f"code:{symbol}", "size": 5})
        payload = _http_get_json(f"{API_STOCKS}?{params}")
        data = payload.get("data") if isinstance(payload, dict) else None
        if data:
            record = data[0] if isinstance(data, list) else data
    except Exception as e:
        errors.append(f"v4/stocks:{type(e).__name__}")

    # fallback: full list filter (heavier — only if needed)
    if not record:
        try:
            payload = _http_get_json(f"{API_STOCKS_ALL}?status=all")
            data = payload.get("data") if isinstance(payload, dict) else None
            if isinstance(data, list):
                for row in data:
                    code = str(row.get("symbol") or row.get("code") or "").upper()
                    if code == symbol:
                        record = row
                        break
        except Exception as e:
            errors.append(f"stocks:all:{type(e).__name__}")

    def pick(*keys: str) -> Any:
        for k in keys:
            for rk, rv in record.items():
                if str(rk).lower().replace(" ", "_") == k.lower().replace(" ", "_"):
                    if rv is not None and str(rv).strip() not in ("", "null", "None"):
                        return rv
        return None

    name = str(
        pick("companyName", "company_name", "organName", "name", "shortName") or symbol
    )
    floor = str(pick("floor", "exchange", "board") or "").upper()
    if "HNX" in floor:
        exchange = "HNX"
    elif "UPCOM" in floor:
        exchange = "UPCOM"
    else:
        exchange = "HOSE"

    industry = pick("industryName", "industry", "icbName", "sectorName")
    sector_raw = pick("sectorName", "sector", "industryName")
    sector_group = SECTOR_FALLBACK.get(symbol)
    if not sector_group and sector_raw:
        text = str(sector_raw).lower()
        if any(x in text for x in ("bank", "ngân hàng", "ngan hang")):
            sector_group = "Banks"
        elif any(x in text for x in ("securit", "chứng khoán", "chung khoan")):
            sector_group = "Securities"
        elif any(x in text for x in ("real estate", "bất động sản", "bat dong san")):
            sector_group = "Real Estate"
        elif any(x in text for x in ("tech", "công nghệ", "cong nghe")):
            sector_group = "Technology"
        else:
            sector_group = "Other"
    if not sector_group:
        sector_group = "Other"

    return {
        "symbol": symbol,
        "name": name,
        "exchange": exchange,
        "sector": sector_group,
        "sectorGroup": sector_group,
        "industry": str(industry).strip() if industry else None,
        "source": "vndirect:finfo/stocks",
        "notes": errors[:4],
        "dataAvailable": bool(record),
    }


def fetch_fundamentals(symbol: str) -> dict[str, Any]:
    """
    Best-effort ratios from VNDirect.
    Public ratio endpoints vary; we try several shapes and never invent numbers.
    """
    symbol = normalize_symbol(symbol)
    errors: list[str] = []
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

    # Attempt 1: v4/ratios
    try:
        params = urlencode({"q": f"code:{symbol}", "size": 20, "sort": "reportDate:desc"})
        payload = _http_get_json(f"{API_RATIOS}?{params}")
        data = payload.get("data") if isinstance(payload, dict) else None
        if isinstance(data, list) and data:
            row = data[0]
            mapping = {
                "roe": ("roe", "ROE", "returnOnEquity"),
                "roa": ("roa", "ROA", "returnOnAssets"),
                "pe": ("pe", "PE", "priceToEarning", "priceToEarnings"),
                "pb": ("pb", "PB", "priceToBook"),
                "eps": ("eps", "EPS", "earningPerShare"),
                "debtToEquity": ("debtEquity", "debtToEquity", "de", "financialLeverage"),
            }
            for field, keys in mapping.items():
                for k in keys:
                    if k in row and found[field] is None:
                        found[field] = _safe_float(row[k])
    except Exception as e:
        errors.append(f"v4/ratios:{type(e).__name__}:{e}")

    # Attempt 2: embed ratios from stocks payload
    try:
        params = urlencode({"q": f"code:{symbol}", "size": 5})
        payload = _http_get_json(f"{API_STOCKS}?{params}")
        data = payload.get("data") if isinstance(payload, dict) else None
        row = None
        if isinstance(data, list) and data:
            row = data[0]
        elif isinstance(data, dict):
            row = data
        if row:
            for field, keys in {
                "roe": ("roe", "ROE"),
                "roa": ("roa", "ROA"),
                "pe": ("pe", "PE", "priceChgPct"),
                "pb": ("pb", "PB"),
                "eps": ("eps", "EPS"),
            }.items():
                if found[field] is None:
                    for k in keys:
                        if k in row:
                            found[field] = _safe_float(row[k])
                            break
    except Exception as e:
        errors.append(f"stocks-ratios:{type(e).__name__}")

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
        "notes": errors[:6]
        + (
            []
            if available
            else [
                "VNDirect public ratio fields may be sparse; OHLCV/company still available. "
                "Consider TCBS/FireAnt later for richer fundamentals."
            ]
        ),
    }


def fetch_sector_universe() -> dict[str, Any]:
    """Build sector map from VNDirect stocks list."""
    payload = _http_get_json(f"{API_STOCKS_ALL}?status=all")
    data = payload.get("data") if isinstance(payload, dict) else []
    rows = []
    if isinstance(data, list):
        for item in data:
            sym = str(item.get("symbol") or item.get("code") or "").upper()
            if not sym:
                continue
            industry = item.get("industryName") or item.get("industry")
            sector = SECTOR_FALLBACK.get(sym, "Other")
            rows.append(
                {
                    "symbol": sym,
                    "industry": industry,
                    "sectorGroup": sector,
                    "sectorSource": "vndirect:stocks",
                }
            )
    rows.sort(key=lambda r: (str(r.get("industry") or ""), r["symbol"]))
    return {
        "source": "vndirect:stocks",
        "count": len(rows),
        "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "data": rows,
    }
