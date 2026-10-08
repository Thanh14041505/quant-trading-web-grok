"""Shared helpers for Vercel Python functions (vnstock)."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any


def default_start(days: int = 400) -> str:
    return (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")


def default_end() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d")


def normalize_symbol(symbol: str) -> str:
    s = (symbol or "").strip().upper()
    # Common index aliases
    aliases = {
        "VNINDEX": "VNINDEX",
        "VN-INDEX": "VNINDEX",
        "VN30": "VN30",
        "HNX": "HNXIndex",
        "HNXINDEX": "HNXIndex",
        "UPCOM": "UPCOMIndex",
    }
    return aliases.get(s, s)


def dataframe_to_bars(df, symbol: str) -> list[dict[str, Any]]:
    if df is None or getattr(df, "empty", True):
        return []

    # Flatten multiindex columns if any
    if hasattr(df.columns, "levels"):
        try:
            df = df.copy()
            df.columns = [
                c[0] if isinstance(c, tuple) else c for c in df.columns
            ]
        except Exception:
            pass

    cols = {str(c).lower().strip(): c for c in df.columns}

    def pick(*names: str):
        for n in names:
            if n in cols:
                return cols[n]
            for k, v in cols.items():
                if n in k:
                    return v
        return None

    c_date = pick("time", "tradingdate", "date", "datetime")
    c_o = pick("open")
    c_h = pick("high")
    c_l = pick("low")
    c_c = pick("close")
    c_v = pick("volume")

    if not all([c_date, c_o, c_h, c_l, c_c]):
        raise ValueError(
            f"Unexpected columns for {symbol}: {list(df.columns)}"
        )

    rows: list[dict[str, Any]] = []
    for _, r in df.iterrows():
        d = r[c_date]
        if hasattr(d, "strftime"):
            ds = d.strftime("%Y-%m-%d")
        else:
            ds = str(d)[:10]
        try:
            o = float(r[c_o])
            h = float(r[c_h])
            l = float(r[c_l])
            c = float(r[c_c])
            v = float(r[c_v]) if c_v is not None else 0.0
        except Exception:
            continue
        if o <= 0 or h <= 0 or l <= 0 or c <= 0:
            continue
        rows.append(
            {
                "symbol": symbol.upper(),
                "date": ds,
                "open": o,
                "high": h,
                "low": l,
                "close": c,
                "volume": v,
            }
        )

    rows.sort(key=lambda x: x["date"])
    return rows


def fetch_history(symbol: str, start: str, end: str) -> list[dict[str, Any]]:
    """
    Fetch daily OHLCV via vnstock with several API variants
    (library versions differ).
    """
    symbol = normalize_symbol(symbol)
    errors: list[str] = []

    # Variant 1: Vnstock().stock(...).quote.history
    try:
        from vnstock import Vnstock

        stock = Vnstock().stock(symbol=symbol, source="VCI")
        df = stock.quote.history(start=start, end=end, interval="1D")
        rows = dataframe_to_bars(df, symbol)
        if rows:
            return rows
        errors.append("VCI history empty")
    except Exception as e:
        errors.append(f"VCI: {e}")

    # Variant 2: Quote class
    try:
        from vnstock import Quote

        q = Quote(symbol=symbol, source="VCI")
        df = q.history(start=start, end=end, interval="1D")
        rows = dataframe_to_bars(df, symbol)
        if rows:
            return rows
        errors.append("Quote VCI empty")
    except Exception as e:
        errors.append(f"Quote: {e}")

    # Variant 3: TCBS source
    try:
        from vnstock import Vnstock

        stock = Vnstock().stock(symbol=symbol, source="TCBS")
        df = stock.quote.history(start=start, end=end, interval="1D")
        rows = dataframe_to_bars(df, symbol)
        if rows:
            return rows
        errors.append("TCBS empty")
    except Exception as e:
        errors.append(f"TCBS: {e}")

    raise RuntimeError(
        f"vnstock failed for {symbol}. Tried: " + " | ".join(errors[:4])
    )
