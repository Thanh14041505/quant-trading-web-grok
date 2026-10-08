import type { OHLCV } from "@/models/market"

export type DataQualityIssue =
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_OHLC"
  | "NEGATIVE_VOLUME"
  | "DUPLICATE_DATE"
  | "UNSORTED"
  | "NAN_VALUE"
  | "EMPTY_DATASET"
  | "INSUFFICIENT_HISTORY"

export interface ValidationResult {
  valid: boolean
  issues: { code: DataQualityIssue; message: string; index?: number }[]
  cleaned: OHLCV[]
}

/**
 * Validate and lightly clean a list of OHLCV bars.
 * Does NOT silently invent data — only flags / drops clearly broken rows when safe.
 */
export function validateOHLCV(
  bars: OHLCV[],
  options: { minBars?: number; dropInvalid?: boolean } = {}
): ValidationResult {
  const { minBars = 0, dropInvalid = true } = options
  const issues: ValidationResult["issues"] = []
  const cleaned: OHLCV[] = []

  if (!bars || bars.length === 0) {
    issues.push({ code: "EMPTY_DATASET", message: "No bars provided" })
    return { valid: false, issues, cleaned: [] }
  }

  const seenDates = new Set<string>()
  let prevDate: string | null = null

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]
    let rowOk = true

    if (!b.symbol || !b.date) {
      issues.push({
        code: "MISSING_REQUIRED_FIELD",
        message: `Row ${i}: missing symbol or date`,
        index: i,
      })
      rowOk = false
    }

    const nums = [b.open, b.high, b.low, b.close, b.volume]
    if (nums.some((n) => n == null || Number.isNaN(n))) {
      issues.push({
        code: "NAN_VALUE",
        message: `Row ${i} (${b.date}): NaN or null in OHLC/volume`,
        index: i,
      })
      rowOk = false
    }

    if (b.high < b.low) {
      issues.push({
        code: "INVALID_OHLC",
        message: `Row ${i} (${b.date}): high < low`,
        index: i,
      })
      rowOk = false
    }

    if (b.close > b.high || b.close < b.low || b.open > b.high || b.open < b.low) {
      issues.push({
        code: "INVALID_OHLC",
        message: `Row ${i} (${b.date}): open/close outside high-low range`,
        index: i,
      })
      // Still keep the bar if dropInvalid is false; otherwise drop
      if (dropInvalid) rowOk = false
    }

    if (b.volume < 0) {
      issues.push({
        code: "NEGATIVE_VOLUME",
        message: `Row ${i} (${b.date}): negative volume`,
        index: i,
      })
      rowOk = false
    }

    if (seenDates.has(b.date)) {
      issues.push({
        code: "DUPLICATE_DATE",
        message: `Duplicate date ${b.date}`,
        index: i,
      })
      rowOk = false
    }
    seenDates.add(b.date)

    if (prevDate && b.date < prevDate) {
      issues.push({
        code: "UNSORTED",
        message: `Dates not ascending around ${b.date}`,
        index: i,
      })
    }
    prevDate = b.date

    if (rowOk || !dropInvalid) {
      cleaned.push({
        symbol: b.symbol,
        date: b.date,
        open: Number(b.open),
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
        volume: Number(b.volume),
        value: b.value != null ? Number(b.value) : undefined,
      })
    }
  }

  // Ensure sorted
  cleaned.sort((a, b) => a.date.localeCompare(b.date))

  if (cleaned.length < minBars) {
    issues.push({
      code: "INSUFFICIENT_HISTORY",
      message: `Only ${cleaned.length} valid bars (need ≥ ${minBars})`,
    })
  }

  const critical = issues.some((i) =>
    ["EMPTY_DATASET", "INSUFFICIENT_HISTORY"].includes(i.code)
  )

  return {
    valid: !critical && cleaned.length > 0,
    issues,
    cleaned,
  }
}
