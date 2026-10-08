import type { OHLCV } from "@/models/market"

/** Common raw shapes returned by various APIs */
export type RawBar = Record<string, unknown>

/**
 * Normalize a single raw bar into internal OHLCV schema.
 * Supports multiple common field names.
 */
export function adaptBar(raw: RawBar, symbol: string): OHLCV | null {
  const date =
    pickString(raw, ["date", "time", "t", "tradingDate", "TradingDate", "timestamp"]) ??
    null

  if (!date) return null

  // Normalize date to YYYY-MM-DD
  let normalizedDate: string
  if (typeof date === "number" || /^\d{10,13}$/.test(String(date))) {
    // Unix timestamp (seconds or ms)
    const ts = Number(date)
    const d = new Date(ts > 1e12 ? ts : ts * 1000)
    normalizedDate = d.toISOString().slice(0, 10)
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(date))) {
    // dd/mm/yyyy (SSI style)
    const [dd, mm, yyyy] = String(date).split("/")
    normalizedDate = `${yyyy}-${mm}-${dd}`
  } else {
    normalizedDate = String(date).slice(0, 10)
  }

  const open = pickNumber(raw, ["open", "o", "Open", "open_price"])
  const high = pickNumber(raw, ["high", "h", "High", "highest_price"])
  const low = pickNumber(raw, ["low", "l", "Low", "lowest_price"])
  const close = pickNumber(raw, ["close", "c", "Close", "close_price", "price"])
  const volume = pickNumber(raw, ["volume", "v", "Volume", "volumefrom", "totalVolume"]) ?? 0
  const value = pickNumber(raw, ["value", "Value", "totalValue", "amount"])

  if (open == null || high == null || low == null || close == null) {
    return null
  }

  return {
    symbol: symbol.toUpperCase(),
    date: normalizedDate,
    open,
    high,
    low,
    close,
    volume,
    value: value ?? undefined,
  }
}

export function adaptBars(rawList: RawBar[], symbol: string): OHLCV[] {
  const result: OHLCV[] = []
  for (const raw of rawList) {
    const bar = adaptBar(raw, symbol)
    if (bar) result.push(bar)
  }
  // Sort ascending
  result.sort((a, b) => a.date.localeCompare(b.date))
  return result
}

function pickString(obj: RawBar, keys: string[]): string | null {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return String(obj[k])
  }
  return null
}

function pickNumber(obj: RawBar, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k]
    if (v == null) continue
    const n = Number(v)
    if (!Number.isNaN(n)) return n
  }
  return null
}
