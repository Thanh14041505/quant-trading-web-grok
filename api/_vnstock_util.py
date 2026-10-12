"""Shared VNStock helpers for Vercel file-based Python functions.

IMPORTANT: Vercel's function filesystem is ephemeral/read-only except /tmp.
Prefer VNSTOCK_API_KEY as a Vercel environment variable. X-VNSTOCK-KEY is
supported as a personal-use fallback and must never be logged or returned.
"""
from __future__ import annotations

import hashlib
import inspect
import math
import os
import re
import time
import unicodedata
from datetime import datetime, timedelta
from typing import Any

os.environ.setdefault("HOME", "/tmp")
os.environ.setdefault("XDG_CACHE_HOME", "/tmp/.cache")
os.environ.setdefault("XDG_CONFIG_HOME", "/tmp/.config")
os.environ.setdefault("TMPDIR", "/tmp")
os.environ.setdefault("TEMP", "/tmp")
os.environ.setdefault("TMP", "/tmp")
for _directory in ("/tmp/.cache", "/tmp/.config", "/tmp/vnstock"):
    try:
        os.makedirs(_directory, exist_ok=True)
    except OSError:
        pass

_configured_key_digest: str | None = None


def _error_label(error: Exception) -> str:
    """Return safe diagnostic type plus missing module, without secrets."""
    if isinstance(error, ModuleNotFoundError):
        missing_module = getattr(error, "name", None) or "unknown-module"
        return f"ModuleNotFoundError:{missing_module}"
    return type(error).__name__


def default_start(days: int = 400) -> str:
    return (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")


def default_end() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d")


def normalize_symbol(symbol: str) -> str:
    value = (symbol or "").strip().upper()
    aliases = {
        "VNINDEX": "VNINDEX",
        "VN-INDEX": "VNINDEX",
        "VN30": "VN30",
        "HNX": "HNXIndex",
        "HNXINDEX": "HNXIndex",
        "UPCOM": "UPCOMIndex",
        "UPCOMINDEX": "UPCOMIndex",
    }
    return aliases.get(value, value)


def configure_vnstock_key(api_key: str | None = None) -> str:
    """Configure the key once per warm function instance without exposing it."""
    global _configured_key_digest
    key = (api_key or os.getenv("VNSTOCK_API_KEY") or "").strip()
    if not key:
        return "environment-key-not-configured"

    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    if digest == _configured_key_digest:
        return "configured"

    try:
        # Current official guidance uses change_api_key for programmatic keys.
        from vnstock.core.utils.auth import change_api_key

        change_api_key(key)
        _configured_key_digest = digest
        return "configured"
    except Exception as current_error:
        # Compatibility with older installs only when register_user accepts a
        # key argument. Never invoke an interactive login prompt in a function.
        try:
            from vnstock import register_user
            signature = inspect.signature(register_user)
            accepts_positional = any(
                parameter.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.VAR_POSITIONAL)
                for parameter in signature.parameters.values()
            )
            if not accepts_positional:
                return f"key-configuration-warning:{type(current_error).__name__}"
            register_user(key)
            _configured_key_digest = digest
            return "configured-legacy"
        except Exception:
            # Never return or log the raw key or exception text; callers may
            # still attempt public/guest access if the upstream permits it.
            return f"key-configuration-warning:{type(current_error).__name__}"


def key_from_request(handler: Any) -> str | None:
    return (
        os.getenv("VNSTOCK_API_KEY")
        or handler.headers.get("X-VNSTOCK-KEY")
        or handler.headers.get("x-vnstock-key")
    )


def dataframe_to_bars(df: Any, symbol: str) -> list[dict[str, Any]]:
    if df is None or getattr(df, "empty", True):
        return []

    if hasattr(df.columns, "levels"):
        try:
            df = df.copy()
            df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
        except Exception:
            pass

    columns = {str(column).lower().strip().replace(" ", ""): column for column in df.columns}

    def pick(*names: str):
        targets = [name.lower().replace(" ", "") for name in names]
        for target in targets:
            if target in columns:
                return columns[target]
        for target in targets:
            for normalized, original in columns.items():
                if target and target in normalized:
                    return original
        return None

    c_date = pick("time", "tradingdate", "date", "datetime", "timestamp")
    c_open = pick("open")
    c_high = pick("high")
    c_low = pick("low")
    c_close = pick("close", "adjclose", "adjustedclose")
    c_volume = pick("volume", "vol")
    c_value = pick("value", "tradingvalue", "value_traded", "turnover")

    if any(column is None for column in (c_date, c_open, c_high, c_low, c_close)):
        raise ValueError(f"Unexpected OHLCV columns for {symbol}: {list(df.columns)}")

    rows: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        raw_date = row[c_date]
        if hasattr(raw_date, "strftime"):
            date_string = raw_date.strftime("%Y-%m-%d")
        else:
            date_string = str(raw_date)[:10]
        try:
            open_price = float(row[c_open])
            high_price = float(row[c_high])
            low_price = float(row[c_low])
            close_price = float(row[c_close])
            volume = float(row[c_volume]) if c_volume is not None else 0.0
            value = float(row[c_value]) if c_value is not None and str(row[c_value]) not in ("nan", "None", "") else None
        except (TypeError, ValueError, OverflowError):
            continue

        prices = (open_price, high_price, low_price, close_price)
        if not all(math.isfinite(number) and number > 0 for number in prices):
            continue
        if not math.isfinite(volume) or volume < 0:
            continue
        bar: dict[str, Any] = {
            "symbol": symbol.upper(),
            "date": date_string,
            "open": open_price,
            "high": high_price,
            "low": low_price,
            "close": close_price,
            "volume": volume,
        }
        if value is not None and math.isfinite(value) and value >= 0:
            bar["value"] = value
        rows.append(bar)

    rows.sort(key=lambda item: item["date"])
    return rows


def dataframe_to_records(df: Any) -> list[dict[str, Any]]:
    """Convert common pandas DataFrame/Series/dict outputs into plain records."""
    if df is None:
        return []
    if isinstance(df, dict):
        return [df]
    if hasattr(df, "empty") and df.empty:
        return []
    if hasattr(df, "to_dict"):
        try:
            records = df.reset_index().to_dict(orient="records") if hasattr(df, "reset_index") else df.to_dict(orient="records")
            return [{str(k): _json_scalar(v) for k, v in record.items()} for record in records]
        except Exception:
            try:
                mapped = df.to_dict()
                if isinstance(mapped, dict):
                    return [{str(k): _json_scalar(v) for k, v in mapped.items()}]
            except Exception:
                return []
    return []


def _json_scalar(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "item"):
        try:
            value = value.item()
        except Exception:
            pass
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    try:
        if value != value:  # NaN
            return None
    except Exception:
        pass
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _is_index_symbol(symbol: str) -> bool:
    return symbol.upper() in {"VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX"}


def _fetch_unified_history(symbol: str, start: str, end: str):
    """Preferred Unified UI used by current VNStock v4+ documentation."""
    from vnstock import Market

    market = Market()
    if _is_index_symbol(symbol):
        return market.index.ohlcv(symbol=symbol, start=start, end=end)
    return market.equity.ohlcv(symbol=symbol, start=start, end=end)


def _fetch_legacy_history(symbol: str, source: str, start: str, end: str):
    """Fallback to the source-specific API used by the existing project."""
    from vnstock import Vnstock

    stock = Vnstock().stock(symbol=symbol, source=source)
    return stock.quote.history(start=start, end=end, interval="1D")


def _fetch_quote_history(symbol: str, source: str, start: str, end: str):
    from vnstock import Quote

    quote = Quote(symbol=symbol, source=source)
    try:
        return quote.history(start=start, end=end, interval="1D")
    except TypeError:
        # Unified v4-style signature from current VNStock examples.
        try:
            from vnstock.core.types import TimeFrame
            return quote.history(start_date=start, end_date=end, resolution=TimeFrame.DAILY)
        except (ImportError, TypeError):
            return quote.history(start_date=start, end_date=end)


def fetch_history(symbol: str, start: str, end: str) -> list[dict[str, Any]]:
    symbol = normalize_symbol(symbol)
    errors: list[str] = []
    configure_vnstock_key()

    # Prefer VNStock v4+ Unified UI first; older source-specific calls remain
    # as fallback for the version already used by the reference project.
    fetchers = [("Unified", lambda: _fetch_unified_history(symbol, start, end))]
    fetchers.extend(
        (f"{source}-legacy", lambda source=source: _fetch_legacy_history(symbol, source, start, end))
        for source in ("VCI", "KBS", "MSN")
    )
    fetchers.extend(
        (f"{source}-quote", lambda source=source: _fetch_quote_history(symbol, source, start, end))
        for source in ("VCI", "KBS", "MSN")
    )
    for label, fetcher in fetchers:
        try:
            frame = fetcher()
            bars = dataframe_to_bars(frame, symbol)
            bars = [bar for bar in bars if start <= bar["date"] <= end]
            if bars:
                return bars
            errors.append(f"{label}:empty")
        except Exception as error:
            errors.append(f"{label}:{_error_label(error)}")

    raise RuntimeError(
        f"VNStock could not return history for {symbol}. Tried: "
        + ", ".join(errors[:8])
        + ". Verify the installed VNStock version, API key, symbol, and upstream availability."
    )


def _fold_text(value: Any) -> str:
    import re
    import unicodedata

    text = unicodedata.normalize("NFKD", str(value or "").lower())
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _record_pick(record: dict[str, Any], *keys: str) -> Any:
    normalized = {str(key).strip().lower().replace(" ", "_"): value for key, value in record.items()}
    for key in keys:
        candidate = normalized.get(key.lower().replace(" ", "_"))
        if candidate is not None and str(candidate).strip().lower() not in ("", "nan", "none", "null"):
            return candidate
    return None


def _numeric(value: Any) -> float | None:
    try:
        if value is None or str(value).strip().lower() in ("", "nan", "none", "null", "n/a", "--"):
            return None
        result = float(str(value).replace(",", "").replace("%", "").strip())
        return result if math.isfinite(result) else None
    except (TypeError, ValueError, OverflowError):
        return None


def _period_sort_key(period: str) -> tuple[int, int, int]:
    import re

    match = re.fullmatch(r"((?:19|20)\d{2})(?:[-_ ]?Q([1-4]))?(?:_(\d+))?", str(period).strip(), re.IGNORECASE)
    if not match:
        return (0, 0, 0)
    year = int(match.group(1))
    quarter = int(match.group(2) or 0)
    duplicate_suffix = int(match.group(3) or 0)
    # Prefer the unsuffixed column when a provider returns duplicated quarters.
    return year, quarter, -duplicate_suffix


def _period_columns(record: dict[str, Any]) -> list[str]:
    import re

    columns = [
        str(key) for key in record
        if re.fullmatch(r"((?:19|20)\d{2})(?:[-_ ]?Q[1-4])?(?:_\d+)?", str(key).strip(), re.IGNORECASE)
    ]
    return sorted(columns, key=_period_sort_key, reverse=True)


def _record_period_values(record: dict[str, Any]) -> dict[str, float | None]:
    return {period: _numeric(record.get(period)) for period in _period_columns(record)}


def _latest_period_value(record: dict[str, Any]) -> tuple[str | None, float | None]:
    for period in _period_columns(record):
        value = _numeric(record.get(period))
        if value is not None:
            return period, value
    # Support long-form {period, value} payloads as well as wide period tables.
    direct_period = _record_pick(record, "period", "year", "date", "report_period")
    direct_value = _numeric(_record_pick(record, "value", "current_value", "metric_value"))
    if direct_value is not None:
        return (str(direct_period) if direct_period is not None else None), direct_value
    return None, None


def _find_metric_record(
    records: list[dict[str, Any]],
    id_aliases: tuple[str, ...],
    text_aliases: tuple[str, ...] = (),
) -> dict[str, Any] | None:
    """Match row-oriented VNStock financial tables by item_id first, then labels."""
    best: tuple[int, dict[str, Any]] | None = None
    folded_ids = tuple(_fold_text(alias).replace(" ", "_") for alias in id_aliases)
    folded_text = tuple(_fold_text(alias) for alias in text_aliases)
    for record in records:
        item_id = _fold_text(_record_pick(record, "item_id", "itemId", "metric_id", "id")).replace(" ", "_")
        label = " ".join(
            _fold_text(_record_pick(record, key))
            for key in ("item_en", "item", "name", "metric", "ratio", "description", "label")
        ).strip()
        score = 0
        for alias in folded_ids:
            if not alias:
                continue
            if item_id == alias:
                score = max(score, 120)
            elif item_id.endswith("_" + alias) or item_id.endswith("." + alias):
                score = max(score, 110)
            elif alias in item_id:
                score = max(score, 95)
        for alias in folded_text:
            if alias and alias in label:
                score = max(score, 60 + min(len(alias), 25))
        if score and (best is None or score > best[0]):
            best = (score, record)
    return best[1] if best else None


def _metric_value(
    records: list[dict[str, Any]],
    id_aliases: tuple[str, ...],
    text_aliases: tuple[str, ...] = (),
) -> float | None:
    record = _find_metric_record(records, id_aliases, text_aliases)
    return _latest_period_value(record)[1] if record else None


def _metric_series(
    records: list[dict[str, Any]],
    id_aliases: tuple[str, ...],
    text_aliases: tuple[str, ...] = (),
) -> list[tuple[str, float]]:
    record = _find_metric_record(records, id_aliases, text_aliases)
    if not record:
        return []
    values = [(period, value) for period, value in _record_period_values(record).items() if value is not None]
    direct_period, direct_value = _latest_period_value(record)
    if not values and direct_period and direct_value is not None:
        values = [(direct_period, direct_value)]
    values.sort(key=lambda pair: _period_sort_key(pair[0]))
    return values


def _growth_pct(values: list[tuple[str, float]], year_over_year: bool = True) -> float | None:
    if len(values) < 2:
        return None
    ordered = sorted(values, key=lambda pair: _period_sort_key(pair[0]))
    latest_period, latest_value = ordered[-1]
    latest_key = _period_sort_key(latest_period)
    prior: tuple[str, float] | None = None
    if year_over_year:
        target = (latest_key[0] - 1, latest_key[1], latest_key[2])
        candidates = [pair for pair in ordered[:-1] if _period_sort_key(pair[0])[:2] == target[:2]]
        if candidates:
            prior = candidates[-1]
        elif len(ordered) >= 5:
            prior = ordered[-5]  # four quarters earlier if exact quarter labels are unavailable
    if prior is None:
        prior = ordered[-2]
    base = prior[1]
    if base == 0:
        return None
    return (latest_value / base - 1.0) * 100.0


def _cagr_pct(values: list[tuple[str, float]]) -> float | None:
    annual = [(period, value) for period, value in values if len(period) == 4 and period.isdigit()]
    annual.sort(key=lambda pair: pair[0])
    if len(annual) < 3:
        return None
    first_period, first_value = annual[0]
    last_period, last_value = annual[-1]
    years = int(last_period) - int(first_period)
    if years <= 0 or first_value <= 0 or last_value < 0:
        return None
    return ((last_value / first_value) ** (1.0 / years) - 1.0) * 100.0


def _median(values: list[float]) -> float | None:
    valid = sorted(value for value in values if math.isfinite(value))
    if not valid:
        return None
    middle = len(valid) // 2
    if len(valid) % 2:
        return valid[middle]
    return (valid[middle - 1] + valid[middle]) / 2.0


def _safe_pct(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator in (None, 0):
        return None
    return numerator / denominator * 100.0


def _fetch_financial_records(symbol: str, method_name: str, periods: tuple[str, ...]) -> tuple[list[dict[str, Any]], str | None, list[str]]:
    errors: list[str] = []
    try:
        from vnstock import Fundamental

        for period in periods:
            try:
                equity = Fundamental().equity(symbol)
                method = getattr(equity, method_name)
                try:
                    frame = method(period=period, orient="report")
                except TypeError:
                    frame = method(period=period)
                records = dataframe_to_records(frame)
                if records:
                    return records, f"vnstock:Fundamental.equity.{method_name}", errors
                errors.append(f"Unified-{method_name}-{period}:empty")
            except Exception as error:
                errors.append(f"Unified-{method_name}-{period}:{_error_label(error)}")
    except Exception as error:
        errors.append(f"Unified-import:{_error_label(error)}")

    # v4 legacy provider fallback, kept for deployments pinned to source-specific adapters.
    try:
        from vnstock import Finance

        for source in ("VCI", "KBS"):
            try:
                finance = Finance(source=source, symbol=symbol)
                method = getattr(finance, "ratio" if method_name in ("ratio", "ratios") else method_name)
                succeeded = False
                for period in periods:
                    try:
                        frame = method(period=period, lang="en", dropna=True)
                    except TypeError:
                        try:
                            frame = method(period=period)
                        except TypeError:
                            frame = method()
                    records = dataframe_to_records(frame)
                    if records:
                        return records, f"vnstock:Finance.{source}.{method_name}", errors
                    errors.append(f"{source}-{method_name}-{period}:empty")
                    succeeded = True
                if not succeeded:
                    errors.append(f"{source}-{method_name}:empty")
            except Exception as error:
                errors.append(f"{source}-{method_name}:{_error_label(error)}")
    except Exception as error:
        errors.append(f"Finance-import:{_error_label(error)}")
    return [], None, errors


_sector_map_cache: dict[str, dict[str, Any]] | None = None
_sector_map_cached_at = 0.0


def _sector_group_from_text(value: Any) -> str:
    text = _fold_text(value)
    if any(term in text for term in ("ngan hang", "banking", "banks", "commercial bank", "credit institution")):
        return "Banks"
    if any(term in text for term in ("chung khoan", "securities", "brokerage", "investment services", "capital market")):
        return "Securities"
    if any(term in text for term in ("bat dong san", "real estate", "property", "reit")):
        return "Real Estate"
    if any(term in text for term in ("cang bien", "shipping", "ports", "maritime", "marine transport", "logistics", "vessel")):
        return "Shipping & Ports"
    if any(term in text for term in ("cong nghe", "technology", "software", "it services", "information technology", "telecommunication")):
        return "Technology"
    if any(term in text for term in ("manufacturing", "industrial", "steel", "chemicals", "construction materials", "materials", "san xuat", "cong nghiep", "thep")):
        return "Manufacturing"
    return "Other"


def _get_industry_sector_map(force_refresh: bool = False) -> dict[str, dict[str, Any]]:
    """Cache VNStock's complete ticker-to-ICB mapping for this warm function instance."""
    global _sector_map_cache, _sector_map_cached_at
    import time

    if not force_refresh and _sector_map_cache is not None and time.time() - _sector_map_cached_at < 12 * 60 * 60:
        return _sector_map_cache

    errors: list[str] = []
    try:
        from vnstock import Reference
        reference = Reference()
        for source in ("kbs", "vci"):
            try:
                records = dataframe_to_records(reference.industry.sectors(source=source))
                mapping: dict[str, dict[str, Any]] = {}
                for record in records:
                    symbol = str(_record_pick(record, "symbol", "ticker", "stock_code", "code") or "").strip().upper()
                    if not symbol:
                        continue
                    industry_name = _record_pick(record, "icb_name", "industry_name", "industry", "sector_name", "sector")
                    industry_code = _record_pick(record, "icb_code", "industry_code", "sector_code")
                    level = _numeric(_record_pick(record, "icb_level", "industry_level", "level"))
                    candidate = {
                        "industry": str(industry_name).strip() if industry_name else None,
                        "industryCode": str(industry_code).strip() if industry_code else None,
                        "industryLevel": int(level) if level is not None else None,
                        "sectorSource": f"vnstock:Reference.industry.sectors:{source}",
                    }
                    existing = mapping.get(symbol)
                    if existing is None or (candidate["industryLevel"] or 0) > (existing.get("industryLevel") or 0):
                        mapping[symbol] = candidate
                if mapping:
                    _sector_map_cache = mapping
                    _sector_map_cached_at = time.time()
                    return mapping
                errors.append(f"{source}:empty")
            except Exception as error:
                errors.append(f"{source}:{_error_label(error)}")
    except Exception as error:
        errors.append(f"Reference-industry-import:{_error_label(error)}")

    if _sector_map_cache is not None and not force_refresh:
        return _sector_map_cache
    raise RuntimeError("VNStock industry mapping unavailable: " + ", ".join(errors[:4]))


def fetch_sector_universe(force_refresh: bool = False) -> dict[str, Any]:
    """Return VNStock's market-wide ticker/ICB classification for sector analytics."""
    mapping = _get_industry_sector_map(force_refresh=force_refresh)
    rows = [
        {"symbol": symbol, **classification, "sectorGroup": _sector_group_from_text(classification.get("industry"))}
        for symbol, classification in mapping.items()
    ]
    rows.sort(key=lambda row: (str(row.get("industry") or ""), row["symbol"]))
    return {
        "source": "vnstock:Reference.industry.sectors",
        "count": len(rows),
        "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "data": rows,
    }


def fetch_company(symbol: str) -> dict[str, Any]:
    symbol = normalize_symbol(symbol)
    configure_vnstock_key()
    errors: list[str] = []
    reference_record: dict[str, Any] = {}
    overview_record: dict[str, Any] = {}

    # v4.0.4 uses Reference().company(symbol).info(source=...), not
    # Reference().company.info(symbol=...).
    try:
        from vnstock import Reference
        for source in ("kbs", "vci"):
            try:
                frame = Reference().company(symbol).info(source=source)
                records = dataframe_to_records(frame)
                if records:
                    reference_record = records[0]
                    break
                errors.append(f"Reference-company-{source}:empty")
            except Exception as error:
                errors.append(f"Reference-company-{source}:{_error_label(error)}")
    except Exception as error:
        errors.append(f"Reference-import:{_error_label(error)}")

    # The legacy overview frequently provides listing/exchange fields not present
    # in the compact Reference profile; use it as a complementary source.
    try:
        from vnstock import Company
        for source in ("KBS", "VCI"):
            try:
                frame = Company(source=source, symbol=symbol).overview()
                records = dataframe_to_records(frame)
                if records:
                    overview_record = records[0]
                    break
                errors.append(f"Company-overview-{source}:empty")
            except Exception as error:
                errors.append(f"Company-overview-{source}:{_error_label(error)}")
    except Exception as error:
        errors.append(f"Company-import:{_error_label(error)}")

    if not reference_record and not overview_record:
        raise RuntimeError("VNStock company profile unavailable. Tried: " + ", ".join(errors[:5]))

    combined: dict[str, Any] = {}
    for record in (overview_record, reference_record):
        for key, value in record.items():
            if value is not None and str(value).strip().lower() not in ("", "nan", "none", "null"):
                combined[str(key).strip().lower().replace(" ", "_")] = value

    def pick(*keys: str) -> Any:
        for key in keys:
            normalized = key.lower().replace(" ", "_")
            value = combined.get(normalized)
            if value is not None and str(value).strip().lower() not in ("", "nan", "none", "null"):
                return value
        return None

    name = str(pick("name", "short_name", "company_name", "organ_name", "companyname") or symbol).strip()
    exchange_raw = _fold_text(pick("exchange", "exchange_code", "floor", "listing_exchange", "stock_exchange"))
    if "hnx" in exchange_raw:
        exchange = "HNX"
    elif "upcom" in exchange_raw:
        exchange = "UPCOM"
    elif any(term in exchange_raw for term in ("hose", "hsx", "ho chi minh", "hochiminh")):
        exchange = "HOSE"
    else:
        exchange = None

    profile_sector = pick("sector", "industry", "industry_name", "industryname", "industry_group", "business_sector")
    try:
        classification = _get_industry_sector_map().get(symbol, {})
    except Exception as error:
        errors.append(f"Industry-map:{_error_label(error)}")
        classification = {}
    industry = classification.get("industry") or pick("icb_name", "icb_industry", "industry_level_4", "industry_name_en") or profile_sector
    sector_group = _sector_group_from_text(" ".join(str(value or "") for value in (industry, profile_sector, name, symbol)))
    # Some sources only label the broad group as Financial Services. Preserve that label
    # as the reported industry instead of fabricating a specific ICB classification.
    return {
        "symbol": symbol,
        "name": name,
        "exchange": exchange,
        "sector": sector_group,
        "sectorGroup": sector_group,
        "industry": str(industry).strip() if industry else None,
        "industryCode": classification.get("industryCode") or pick("icb_code", "industry_code"),
        "industryLevel": classification.get("industryLevel"),
        "profileSector": str(profile_sector).strip() if profile_sector else None,
        "sectorSource": classification.get("sectorSource") or ("vnstock:Reference.company.info" if reference_record else f"vnstock:{'KBS' if overview_record else 'unknown'}"),
        "listingDate": pick("listing_date", "list_date", "listed_date"),
        "issuedShares": _numeric(pick("issued_share", "issued_shares", "shares_outstanding", "listed_share")),
        "source": "vnstock:Reference.company.info+industry.sectors",
        "notes": errors[:5],
    }


def fetch_fundamentals(symbol: str, include_history: bool = False) -> dict[str, Any]:
    """Fetch normalized ratios and financial statements; never invent missing values."""
    symbol = normalize_symbol(symbol)
    configure_vnstock_key()

    ratio_records, ratio_source, ratio_errors = _fetch_financial_records(symbol, "ratio", ("quarter", "year"))
    income_records, income_source, income_errors = _fetch_financial_records(symbol, "income_statement", ("year", "quarter"))
    balance_records, balance_source, balance_errors = _fetch_financial_records(symbol, "balance_sheet", ("year", "quarter"))
    cash_records, cash_source, cash_errors = _fetch_financial_records(symbol, "cash_flow", ("year", "quarter"))
    errors = ratio_errors + income_errors + balance_errors + cash_errors

    # Ratios are item rows (item/item_id) plus report-period columns in VNStock v4.
    metric_definitions: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
        "roe": (("roe", "return_on_equity"), ("roe", "return on equity", "ty suat sinh loi tren von chu so huu", "loi nhuan tren von chu so huu")),
        "roa": (("roa", "return_on_assets"), ("roa", "return on assets", "ty suat sinh loi tren tai san")),
        "roic": (("roic", "return_on_invested_capital"), ("roic", "return on invested capital")),
        "pe": (("p_e", "pe", "price_to_earnings", "price_earnings"), ("p/e", "price to earnings", "chi so gia thi truong tren thu nhap")),
        "pb": (("p_b", "pb", "price_to_book", "price_book"), ("p/b", "price to book", "chi so gia thi truong tren gia tri so sach")),
        "evEbitda": (("ev_ebitda", "enterprise_value_to_ebitda"), ("ev/ebitda", "enterprise value to ebitda")),
        "peg": (("peg", "price_earnings_growth"), ("peg ratio", "price earnings growth")),
        "dividendYield": (("dividend_yield", "cash_dividend_yield"), ("dividend yield", "ty suat co tuc")),
        "debtToEquity": (("debt_to_equity", "debt_equity", "debt_on_equity", "d_e"), ("debt to equity", "debt/equity", "no tren von chu so huu")),
        "interestCoverage": (("interest_coverage", "times_interest_earned"), ("interest coverage", "kha nang thanh toan lai vay")),
        "grossMargin": (("gross_profit_margin", "gross_margin"), ("gross profit margin", "gross margin", "bien loi nhuan gop")),
        "operatingMargin": (("operating_profit_margin", "operating_margin"), ("operating profit margin", "operating margin", "bien loi nhuan hoat dong")),
        "netMargin": (("net_profit_margin", "net_margin"), ("net profit margin", "net margin", "bien loi nhuan rong")),
        "revenueGrowth": (("revenue_growth", "sales_growth", "net_revenue_growth"), ("revenue growth", "sales growth", "tang truong doanh thu")),
        "epsGrowth": (("eps_growth", "earnings_per_share_growth"), ("eps growth", "earnings per share growth", "tang truong eps")),
        "npl": (("npl", "non_performing_loan_ratio"), ("npl ratio", "non performing loan", "no xau")),
        "nim": (("nim", "net_interest_margin"), ("nim", "net interest margin", "bien lai rong")),
        "provisioning": (("provisioning_coverage", "loan_loss_coverage", "llr"), ("provision coverage", "provisioning coverage", "ty le bao phu no xau")),
        "casa": (("casa", "current_account_savings_account"), ("casa", "current account savings account")),
        "brokerageShareGrowth": (("brokerage_share_growth",), ("brokerage share growth", "tang truong thi phan moi gioi")),
        "marginLendingGrowth": (("margin_lending_growth",), ("margin lending growth",)),
        "proprietaryTradingGrowth": (("proprietary_trading_growth",), ("proprietary trading growth",)),
    }
    found: dict[str, float | None] = {
        key: _metric_value(ratio_records, *aliases)
        for key, aliases in metric_definitions.items()
    }

    revenue_series = _metric_series(
        income_records,
        ("n_3_net_revenue", "net_revenue", "net_sales", "revenue", "sales_revenue"),
        ("net revenue", "doanh thu thuan", "revenue from sales", "doanh thu ban hang va cung cap dich vu"),
    )
    gross_profit_series = _metric_series(
        income_records,
        ("gross_profit", "n_5_gross_profit", "n_4_gross_profit"),
        ("gross profit", "loi nhuan gop"),
    )
    operating_profit_series = _metric_series(
        income_records,
        ("operating_profit", "profit_from_business_activities", "net_operating_profit"),
        ("operating profit", "loi nhuan thuan tu hoat dong kinh doanh", "loi nhuan tu hoat dong kinh doanh"),
    )
    net_profit_series = _metric_series(
        income_records,
        ("profit_after_tax", "net_profit_after_tax", "profit_after_tax_of_parent_company", "net_profit", "profit_for_the_year"),
        ("profit after tax", "net profit after tax", "loi nhuan sau thue", "loi nhuan sau thue cua co dong cong ty me"),
    )
    eps_series = _metric_series(
        ratio_records,
        ("trailing_eps", "eps", "earnings_per_share", "earning_per_share"),
        ("trailing eps", "earnings per share", "thu nhap tren moi co phan", "eps"),
    )

    revenue_latest = revenue_series[-1][1] if revenue_series else None
    gross_profit_latest = gross_profit_series[-1][1] if gross_profit_series else None
    operating_profit_latest = operating_profit_series[-1][1] if operating_profit_series else None
    net_profit_latest = net_profit_series[-1][1] if net_profit_series else None

    # Derive margins/growth only if statement rows and denominators are available.
    if found["grossMargin"] is None:
        found["grossMargin"] = _safe_pct(gross_profit_latest, revenue_latest)
    if found["operatingMargin"] is None:
        found["operatingMargin"] = _safe_pct(operating_profit_latest, revenue_latest)
    if found["netMargin"] is None:
        found["netMargin"] = _safe_pct(net_profit_latest, revenue_latest)
    if found["revenueGrowth"] is None:
        found["revenueGrowth"] = _growth_pct(revenue_series)
    if found["epsGrowth"] is None:
        found["epsGrowth"] = _growth_pct(eps_series)
    revenue_cagr = _cagr_pct(revenue_series)
    profit_cagr = _cagr_pct(net_profit_series)

    # Balance-sheet facts use standardized item IDs first, then Vietnamese/English labels.
    cash_series = _metric_series(
        balance_records,
        ("cash_and_cash_equivalents", "cash_gold_and_silver_precious_stones", "cash_equivalents"),
        ("cash and cash equivalents", "tien va cac khoan tuong duong tien", "tien mat"),
    )
    short_debt_series = _metric_series(
        balance_records,
        ("short_term_borrowings", "short_term_debt", "short_term_loans"),
        ("short term borrowings", "short term debt", "vay va no thue tai chinh ngan han"),
    )
    long_debt_series = _metric_series(
        balance_records,
        ("long_term_borrowings", "long_term_debt", "long_term_loans"),
        ("long term borrowings", "long term debt", "vay va no thue tai chinh dai han"),
    )
    inventory_series = _metric_series(
        balance_records,
        ("inventories", "inventory"),
        ("inventories", "inventory", "hang ton kho"),
    )
    total_debt_latest = None
    if short_debt_series or long_debt_series:
        total_debt_latest = (short_debt_series[-1][1] if short_debt_series else 0.0) + (long_debt_series[-1][1] if long_debt_series else 0.0)
    cash_latest = cash_series[-1][1] if cash_series else None
    net_debt = total_debt_latest - cash_latest if total_debt_latest is not None and cash_latest is not None else None
    inventory_latest = inventory_series[-1][1] if inventory_series else None

    ocf_series = _metric_series(
        cash_records,
        ("net_cash_flows_from_operating_activities", "net_cash_flow_from_operating_activities", "cash_flows_from_operating_activities", "cash_flow_from_operating_activities"),
        ("net cash flows from operating activities", "net cash flow from operating activities", "luu chuyen tien thuan tu hoat dong kinh doanh"),
    )
    capex_series = _metric_series(
        cash_records,
        ("purchase_of_fixed_assets", "purchase_of_fixed_assets_and_other_long_term_assets", "payments_for_fixed_assets", "capital_expenditure", "capex"),
        ("purchase of fixed assets", "payments to acquire fixed assets", "chi mua sam tai san co dinh", "chi de mua sam xay dung tai san co dinh"),
    )
    ocf_latest = ocf_series[-1][1] if ocf_series else None
    capex_latest = capex_series[-1][1] if capex_series else None
    fcf = ocf_latest - abs(capex_latest) if ocf_latest is not None and capex_latest is not None else None

    # The median is over the periods actually returned, not a fabricated fixed 5-year benchmark.
    pe_series = _metric_series(ratio_records, *metric_definitions["pe"])
    pb_series = _metric_series(ratio_records, *metric_definitions["pb"])
    historical_pe = _median([value for _, value in pe_series if value > 0])
    historical_pb = _median([value for _, value in pb_series if value > 0])

    period_candidates = []
    for records in (ratio_records, income_records, balance_records, cash_records):
        for record in records:
            period_candidates.extend(_period_columns(record))
    latest_period = max(period_candidates, key=_period_sort_key) if period_candidates else None

    result: dict[str, Any] = {
        "symbol": symbol,
        **found,
        "revenueCagr": revenue_cagr,
        "profitCagr": profit_cagr,
        "operatingCashFlow": ocf_latest,
        "freeCashFlow": fcf,
        "netDebt": net_debt,
        "inventory": inventory_latest,
        "historicalPe": historical_pe,
        "historicalPb": historical_pb,
        # These are populated by Hold Scanner only when the scanned peer set is large enough.
        "sectorMedianPe": None,
        "sectorMedianPb": None,
        "sectorBenchmarkScope": None,
        "sectorPeerCount": 0,
        "source": "vnstock:Fundamental.equity",
        "dataAvailable": any(value is not None for key, value in found.items() if key not in ("catalysts", "risks")),
        "latestPeriod": latest_period,
        "reportedPeriods": {
            "ratios": sorted({period for record in ratio_records for period in _period_columns(record)}, key=_period_sort_key),
            "incomeStatement": sorted({period for record in income_records for period in _period_columns(record)}, key=_period_sort_key),
            "balanceSheet": sorted({period for record in balance_records for period in _period_columns(record)}, key=_period_sort_key),
            "cashFlow": sorted({period for record in cash_records for period in _period_columns(record)}, key=_period_sort_key),
        },
        "notes": [
            "Percentages are kept in the source's documented percent units; derived margins/growth are calculated as percentages.",
            "Historical P/E/P/B are medians of periods returned by VNStock, not guaranteed five-year medians.",
            "Sector medians are not returned by the individual-ticker API; Hold Scanner may calculate them from its scanned peer universe.",
            *[error for error in errors if "empty" not in error.lower()][:6],
        ],
    }
    if include_history:
        result["reports"] = {
            "ratios": ratio_records,
            "incomeStatement": income_records,
            "balanceSheet": balance_records,
            "cashFlow": cash_records,
        }
    return result
