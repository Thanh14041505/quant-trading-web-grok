import type { OHLCV } from "@/models/market"
import { rsiSeries, macdSeries } from "./momentum"

export type DivergenceType =
  | "NONE"
  | "RSI_BULLISH"
  | "RSI_BEARISH"
  | "MACD_BULLISH"
  | "MACD_BEARISH"

export interface DivergenceFeatures {
  rsiDivergence: DivergenceType
  macdDivergence: DivergenceType
}

/**
 * Detect divergence using confirmed pivots only.
 * A pivot at index i is confirmed when i+left < length (right bars already exist).
 * We never use unconfirmed future pivots → no look-ahead bias.
 */
function findPivots(
  series: number[],
  left = 3,
  right = 3
): { highs: { i: number; v: number }[]; lows: { i: number; v: number }[] } {
  const highs: { i: number; v: number }[] = []
  const lows: { i: number; v: number }[] = []
  // Only scan up to length - right so pivot is confirmed
  for (let i = left; i < series.length - right; i++) {
    let isH = true
    let isL = true
    for (let j = 1; j <= left; j++) {
      if (series[i] <= series[i - j]) isH = false
      if (series[i] >= series[i - j]) isL = false
    }
    for (let j = 1; j <= right; j++) {
      if (series[i] <= series[i + j]) isH = false
      if (series[i] >= series[i + j]) isL = false
    }
    if (isH) highs.push({ i, v: series[i] })
    if (isL) lows.push({ i, v: series[i] })
  }
  return { highs, lows }
}

function detectDiv(
  price: number[],
  indicator: (number | null)[],
  mode: "rsi" | "macd"
): DivergenceType {
  // Build aligned indicator array (nulls skipped in pivot search via dense)
  const ind: number[] = indicator.map((v) => (v == null ? NaN : v))
  const pricePivots = findPivots(price)
  // For indicator, replace NaN with linear-ish skip by only using finite values indices
  const finiteInd = ind.map((v) => (Number.isFinite(v) ? v : 0))
  const indPivots = findPivots(finiteInd)

  // Bullish: price lower low, indicator higher low
  if (pricePivots.lows.length >= 2 && indPivots.lows.length >= 2) {
    const p1 = pricePivots.lows[pricePivots.lows.length - 2]
    const p2 = pricePivots.lows[pricePivots.lows.length - 1]
    // Find indicator lows near those indices
    const i1 = indPivots.lows.filter((x) => Math.abs(x.i - p1.i) <= 5).pop()
    const i2 = indPivots.lows.filter((x) => Math.abs(x.i - p2.i) <= 5).pop()
    if (i1 && i2 && p2.v < p1.v && i2.v > i1.v) {
      return mode === "rsi" ? "RSI_BULLISH" : "MACD_BULLISH"
    }
  }

  // Bearish: price higher high, indicator lower high
  if (pricePivots.highs.length >= 2 && indPivots.highs.length >= 2) {
    const p1 = pricePivots.highs[pricePivots.highs.length - 2]
    const p2 = pricePivots.highs[pricePivots.highs.length - 1]
    const i1 = indPivots.highs.filter((x) => Math.abs(x.i - p1.i) <= 5).pop()
    const i2 = indPivots.highs.filter((x) => Math.abs(x.i - p2.i) <= 5).pop()
    if (i1 && i2 && p2.v > p1.v && i2.v < i1.v) {
      return mode === "rsi" ? "RSI_BEARISH" : "MACD_BEARISH"
    }
  }

  return "NONE"
}

export function computeDivergenceFeatures(bars: OHLCV[]): DivergenceFeatures {
  if (bars.length < 40) {
    return { rsiDivergence: "NONE", macdDivergence: "NONE" }
  }
  const closes = bars.map((b) => b.close)
  const rsi = rsiSeries(closes, 14)
  const { macdLine } = macdSeries(closes)

  return {
    rsiDivergence: detectDiv(closes, rsi, "rsi"),
    macdDivergence: detectDiv(closes, macdLine, "macd"),
  }
}
