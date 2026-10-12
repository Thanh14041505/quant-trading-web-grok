"""Company overview + financial ratios via vnstock (multi-API fallback)."""
from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Optional

from _vnstock_util import normalize_symbol

# Fallback sector map for liquid VN names when overview fails
SECTOR_FALLBACK: dict[str, tuple[str, str]] = {
    # Banks
    "VCB": ("Banking", "Commercial Bank"),
    "TCB": ("Banking", "Commercial Bank"),
    "MBB": ("Banking", "Commercial Bank"),
    "BID": ("Banking", "Commercial Bank"),
    "CTG": ("Banking", "Commercial Bank"),
    "VPB": ("Banking", "Commercial Bank"),
    "ACB": ("Banking", "Commercial Bank"),
    "HDB": ("Banking", "Commercial Bank"),
    "STB": ("Banking", "Commercial Bank"),
    "TPB": ("Banking", "Commercial Bank"),
    "LPB": ("Banking", "Commercial Bank"),
    "SSB": ("Banking", "Commercial Bank"),
    "VIB": ("Banking", "Commercial Bank"),
    "OCB": ("Banking", "Commercial Bank"),
    "MSB": ("Banking", "Commercial Bank"),
    "EIB": ("Banking", "Commercial Bank"),
    "SHB": ("Banking", "Commercial Bank"),
    "NAB": ("Banking", "Commercial Bank"),
    "ABB": ("Banking", "Commercial Bank"),
    "BAB": ("Banking", "Commercial Bank"),
    "BVB": ("Banking", "Commercial Bank"),
    "PGB": ("Banking", "Commercial Bank"),
    "VBB": ("Banking", "Commercial Bank"),
    "KLB": ("Banking", "Commercial Bank"),
    "VAB": ("Banking", "Commercial Bank"),
    # Securities
    "SSI": ("Securities", "Brokerage"),
    "VND": ("Securities", "Brokerage"),
    "HCM": ("Securities", "Brokerage"),
    "VCI": ("Securities", "Brokerage"),
    "SHS": ("Securities", "Brokerage"),
    "MBS": ("Securities", "Brokerage"),
    "FTS": ("Securities", "Brokerage"),
    "CTS": ("Securities", "Brokerage"),
    "ORS": ("Securities", "Brokerage"),
    "BSI": ("Securities", "Brokerage"),
    "VIX": ("Securities", "Brokerage"),
    "AGR": ("Securities", "Brokerage"),
    # Real estate
    "VIC": ("Real Estate", "Property Developer"),
    "VHM": ("Real Estate", "Property Developer"),
    "VRE": ("Real Estate", "Retail Property"),
    "NVL": ("Real Estate", "Property Developer"),
    "PDR": ("Real Estate", "Property Developer"),
    "DXG": ("Real Estate", "Property Developer"),
    "KDH": ("Real Estate", "Property Developer"),
    "BCM": ("Real Estate", "Industrial Property"),
    "NLG": ("Real Estate", "Property Developer"),
    "DIG": ("Real Estate", "Property Developer"),
    "CEO": ("Real Estate", "Property Developer"),
    "HDG": ("Real Estate", "Property Developer"),
    "KBC": ("Real Estate", "Industrial Property"),
    "IDC": ("Real Estate", "Industrial Property"),
    # Industrials / materials
    "HPG": ("Materials", "Steel"),
    "HSG": ("Materials", "Steel"),
    "NKG": ("Materials", "Steel"),
    "GVR": ("Materials", "Rubber"),
    "DGC": ("Materials", "Chemicals"),
    "DCM": ("Materials", "Fertilizer"),
    "DPM": ("Materials", "Fertilizer"),
    "BMP": ("Materials", "Plastics"),
    "AAA": ("Materials", "Plastics"),
    # Tech
    "FPT": ("Technology", "IT Services"),
    "CMG": ("Technology", "IT Services"),
    "VGI": ("Technology", "Telecom/IT"),
    "FOX": ("Technology", "Telecom"),
    "ELC": ("Technology", "Electronics"),
    # Consumer
    "VNM": ("Consumer", "Dairy"),
    "MSN": ("Consumer", "Conglomerate"),
    "MWG": ("Consumer", "Retail"),
    "PNJ": ("Consumer", "Jewelry"),
    "SAB": ("Consumer", "Beverages"),
    "VHC": ("Consumer", "Seafood"),
    "ANV": ("Consumer", "Seafood"),
    "FRT": ("Consumer", "Retail"),
    "DGW": ("Consumer", "Distribution"),
    "QNS": ("Consumer", "Food"),
    # Energy / infra
    "GAS": ("Energy", "Gas"),
    "PLX": ("Energy", "Oil & Gas"),
    "POW": ("Energy", "Power"),
    "PVD": ("Energy", "Oil Services"),
    "PVT": ("Energy", "Shipping"),
    "BSR": ("Energy", "Refining"),
    "NT2": ("Energy", "Power"),
    "PPC": ("Energy", "Power"),
    "REE": ("Industrials", "Conglomerate"),
    "GMD": ("Industrials", "Logistics"),
    "CII": ("Industrials", "Infrastructure"),
    "HHV": ("Industrials", "Infrastructure"),
    "PC1": ("Industrials", "Power Construction"),
    "VJC": ("Industrials", "Airlines"),
    "HVN": ("Industrials", "Airlines"),
    "ACV": ("Industrials", "Airport"),
    # Insurance / other
    "BVH": ("Financials", "Insurance"),
    "BMI": ("Financials", "Insurance"),
    "PVI": ("Financials", "Insurance"),
    "BIC": ("Financials", "Insurance"),
}


def _safe_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        if isinstance(v, str):
            v = v.replace("%", "").replace(",", "").strip()
            if v == "" or v.lower() in ("nan", "none", "-"):
                return None
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except Exception:
        return None


def _df_to_records(df) -> list[dict[str, Any]]:
    if df is None or getattr(df, "empty", True):
        return []
    try:
        # Flatten multiindex columns
        if hasattr(df.columns, "levels"):
            df = df.copy()
            df.columns = [
                "_".join(str(x) for x in c if x is not None and str(x) != "")
                if isinstance(c, tuple)
                else str(c)
                for c in df.columns
            ]
        recs = df.reset_index().to_dict(orient="records")
        out = []
        for r in recs:
            clean = {}
            for k, v in r.items():
                key = str(k).strip()
                if hasattr(v, "item"):
                    try:
                        v = v.item()
                    except Exception:
                        pass
                if hasattr(v, "isoformat"):
                    v = v.isoformat()[:10]
                if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    v = None
                clean[key] = v
            out.append(clean)
        return out
    except Exception:
        return []


def _pick_ratio_row(records: list[dict[str, Any]]) -> dict[str, Any]:
    if not records:
        return {}
    # Prefer latest year-like row
    return records[-1]


def _extract_ratios(row: dict[str, Any]) -> dict[str, Optional[float]]:
    """Map various vnstock column names → app FundamentalData fields."""
    # lower-key index
    low = {str(k).lower().replace(" ", "_").replace("%", ""): v for k, v in row.items()}

    def find(*names: str) -> Optional[float]:
        for n in names:
            n2 = n.lower().replace(" ", "_")
            if n2 in low:
                f = _safe_float(low[n2])
                if f is not None:
                    return f
            for k, v in low.items():
                if n2 in k or k.endswith(n2) or n2.replace("_", "") in k.replace("_", ""):
                    f = _safe_float(v)
                    if f is not None:
                        return f
        return None

    roe = find("roe", "return_on_equity", "roa_roe_roe", "chỉ_số_roe")
    roa = find("roa", "return_on_assets")
    pe = find("pe", "pe_ratio", "p/e", "price_to_earnings")
    pb = find("pb", "pb_ratio", "p/b", "price_to_book")
    eps = find("eps", "earning_per_share", "basic_eps")
    de = find(
        "debt_to_equity",
        "de",
        "d/e",
        "debt_equity",
        "financial_leverage",
    )
    # growth may be fraction or %
    rev_g = find(
        "revenue_growth",
        "sales_growth",
        "yo_y_revenue_growth",
        "rev_growth",
        "net_sales_growth",
    )
    eps_g = find("eps_growth", "yo_y_eps_growth", "earning_growth")
    profit_g = find("profit_growth", "net_profit_growth", "np_growth")

    # Normalize % fields: if |x| <= 2 treat as ratio → *100 for display consistency
    def maybe_pct(x: Optional[float]) -> Optional[float]:
        if x is None:
            return None
        if abs(x) <= 2.5:
            return round(x * 100, 4)
        return round(x, 4)

    return {
        "roe": maybe_pct(roe) if roe is not None and abs(roe) < 5 else (round(roe, 4) if roe is not None else None),
        "roa": maybe_pct(roa) if roa is not None and abs(roa) < 5 else (round(roa, 4) if roa is not None else None),
        "pe": round(pe, 4) if pe is not None else None,
        "pb": round(pb, 4) if pb is not None else None,
        "eps": round(eps, 4) if eps is not None else None,
        "debtToEquity": round(de, 4) if de is not None else None,
        "revenueGrowth": maybe_pct(rev_g) if rev_g is not None else None,
        "epsGrowth": maybe_pct(eps_g) if eps_g is not None else None,
        "profitGrowth": maybe_pct(profit_g) if profit_g is not None else None,
    }


def _overview_from_df(df, symbol: str) -> dict[str, Any]:
    recs = _df_to_records(df)
    if not recs:
        return {}
    row = recs[0]
    low = {str(k).lower().replace(" ", "_"): v for k, v in row.items()}

    def g(*names: str):
        for n in names:
            n2 = n.lower().replace(" ", "_")
            if n2 in low and low[n2] not in (None, "", "-"):
                return low[n2]
            for k, v in low.items():
                if n2 in k and v not in (None, "", "-"):
                    return v
        return None

    name = g("short_name", "company_name", "organ_name", "name", "ten_doanh_nghiep")
    exchange = g("exchange", "san_niem_yet", "board")
    sector = g("icb_name3", "icb_name2", "sector", "industry", "nganh", "icb_name4")
    industry = g("icb_name4", "icb_name3", "industry", "sub_industry", "nganh_cap_4")
    return {
        "name": str(name) if name else f"{symbol}",
        "exchange": str(exchange).upper() if exchange else "HOSE",
        "sector": str(sector) if sector else None,
        "industry": str(industry) if industry else None,
        "raw_overview_keys": list(row.keys())[:40],
    }


def fetch_company(symbol: str) -> dict[str, Any]:
    symbol = normalize_symbol(symbol)
    errors: list[str] = []
    result: dict[str, Any] = {
        "symbol": symbol,
        "name": symbol,
        "exchange": "HOSE",
        "sector": None,
        "industry": None,
    }

    for source in ("VCI", "KBS"):
        try:
            from vnstock import Company

            c = Company(symbol=symbol, source=source)
            df = c.overview()
            ov = _overview_from_df(df, symbol)
            if ov:
                result.update({k: v for k, v in ov.items() if v is not None})
                result["source"] = f"Company.overview:{source}"
                break
        except Exception as e:
            errors.append(f"Company.overview:{source}:{e}")

        try:
            from vnstock import Vnstock

            stock = Vnstock().stock(symbol=symbol, source=source)
            df = stock.company.overview()
            ov = _overview_from_df(df, symbol)
            if ov:
                result.update({k: v for k, v in ov.items() if v is not None})
                result["source"] = f"stock.company.overview:{source}"
                break
        except Exception as e:
            errors.append(f"stock.company:{source}:{e}")

    # Static sector fallback
    if not result.get("sector") and symbol in SECTOR_FALLBACK:
        sec, ind = SECTOR_FALLBACK[symbol]
        result["sector"] = sec
        result["industry"] = result.get("industry") or ind
        result["sector_fallback"] = True

    if not result.get("sector"):
        result["sector"] = "Other"
        result["industry"] = result.get("industry") or "Other"

    result["errors"] = errors[:6]
    return result


def fetch_fundamentals(symbol: str) -> dict[str, Any]:
    symbol = normalize_symbol(symbol)
    errors: list[str] = []
    ratios: dict[str, Optional[float]] = {}
    source_used = None
    as_of = datetime.utcnow().strftime("%Y-%m-%d")

    for source in ("VCI", "KBS"):
        # Finance.ratio year
        try:
            from vnstock import Finance

            fin = Finance(symbol=symbol, source=source, period="year", get_all=False)
            df = fin.ratio(period="year", lang="en", dropna=True)
            recs = _df_to_records(df)
            if recs:
                ratios = _extract_ratios(_pick_ratio_row(recs))
                if any(v is not None for v in ratios.values()):
                    source_used = f"Finance.ratio:{source}"
                    # try date from row
                    row = _pick_ratio_row(recs)
                    for dk in ("yearReport", "year", "period", "date", "time"):
                        if dk in row and row[dk] is not None:
                            as_of = str(row[dk])[:10]
                            break
                    break
        except Exception as e:
            errors.append(f"Finance.ratio:{source}:{e}")

        try:
            from vnstock import Vnstock

            stock = Vnstock().stock(symbol=symbol, source=source)
            df = stock.finance.ratio(period="year", lang="en", dropna=True)
            recs = _df_to_records(df)
            if recs:
                ratios = _extract_ratios(_pick_ratio_row(recs))
                if any(v is not None for v in ratios.values()):
                    source_used = f"stock.finance.ratio:{source}"
                    break
        except Exception as e:
            errors.append(f"stock.finance.ratio:{source}:{e}")

        # Company.ratio_summary (VCI)
        try:
            from vnstock import Company

            c = Company(symbol=symbol, source=source)
            if hasattr(c, "ratio_summary"):
                df = c.ratio_summary()
                recs = _df_to_records(df)
                if recs:
                    ratios = _extract_ratios(_pick_ratio_row(recs))
                    if any(v is not None for v in ratios.values()):
                        source_used = f"Company.ratio_summary:{source}"
                        break
        except Exception as e:
            errors.append(f"ratio_summary:{source}:{e}")

    # Merge company for sector context
    company = fetch_company(symbol)

    out: dict[str, Any] = {
        "symbol": symbol,
        "asOf": as_of,
        "source": source_used or "none",
        "sector": company.get("sector"),
        "industry": company.get("industry"),
        "name": company.get("name"),
        "exchange": company.get("exchange"),
        **ratios,
        "errors": errors[:8],
    }
    return out
