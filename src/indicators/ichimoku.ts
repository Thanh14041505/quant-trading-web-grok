import type { OHLCV } from "@/models/market"
import { lastNonNull } from "./math"

export interface IchimokuFeatures {
  tenkan: number | null
  kijun: number | null
  senkouA: number | null
  senkouB: number | null
  chikou: number | null
  /** Price vs cloud: ABOVE | INSIDE | BELOW */
  cloudPosition: "ABOVE" | "INSIDE" | "BELOW" | "UNKNOWN"
  cloudThickness: number | null
  distanceToCloud: number | null
  tkSpread: number | null
  /** Future cloud direction (SenkouA vs SenkouB at current) */
  futureCloudBullish: boolean | null
}

function midHighLow(highs: number[], lows: number[], period: number, i: number) {
  if (i < period - 1) return null
  let hh = -Infinity
  let ll = Infinity
  for (let j = i - period + 1; j <= i; j++) {
    hh = Math.max(hh, highs[j])
    ll = Math.min(ll, lows[j])
  }
  return (hh + ll) / 2
}

/**
 * Standard Ichimoku (9/26/52).
 * Senkou spans are plotted 26 periods ahead conceptually;
 * for feature-at-T we use the span values computed from data available at T
 * (no future price data).
 */
export function computeIchimokuFeatures(bars: OHLCV[]): IchimokuFeatures {
  const highs = bars.map((b) => b.high)
  const lows = bars.map((b) => b.low)
  const closes = bars.map((b) => b.close)
  const n = bars.length
  if (n < 52) {
    return {
      tenkan: null,
      kijun: null,
      senkouA: null,
      senkouB: null,
      chikou: null,
      cloudPosition: "UNKNOWN",
      cloudThickness: null,
      distanceToCloud: null,
      tkSpread: null,
      futureCloudBullish: null,
    }
  }

  const tenkanArr: (number | null)[] = new Array(n).fill(null)
  const kijunArr: (number | null)[] = new Array(n).fill(null)
  const senkouAArr: (number | null)[] = new Array(n).fill(null)
  const senkouBArr: (number | null)[] = new Array(n).fill(null)

  for (let i = 0; i < n; i++) {
    tenkanArr[i] = midHighLow(highs, lows, 9, i)
    kijunArr[i] = midHighLow(highs, lows, 26, i)
    if (tenkanArr[i] != null && kijunArr[i] != null) {
      senkouAArr[i] = ((tenkanArr[i] as number) + (kijunArr[i] as number)) / 2
    }
    senkouBArr[i] = midHighLow(highs, lows, 52, i)
  }

  const last = n - 1
  const tenkan = tenkanArr[last]
  const kijun = kijunArr[last]
  // Cloud at current bar uses spans computed 26 bars ago (standard displacement)
  const cloudIdx = last - 26
  const senkouA = cloudIdx >= 0 ? senkouAArr[cloudIdx] : senkouAArr[last]
  const senkouB = cloudIdx >= 0 ? senkouBArr[cloudIdx] : senkouBArr[last]
  // Chikou = close displaced 26 back (value is today's close; comparison uses past)
  const chikou = closes[last]

  const close = closes[last]
  let cloudPosition: IchimokuFeatures["cloudPosition"] = "UNKNOWN"
  if (senkouA != null && senkouB != null) {
    const top = Math.max(senkouA, senkouB)
    const bot = Math.min(senkouA, senkouB)
    if (close > top) cloudPosition = "ABOVE"
    else if (close < bot) cloudPosition = "BELOW"
    else cloudPosition = "INSIDE"
  }

  const cloudThickness =
    senkouA != null && senkouB != null
      ? Math.abs(senkouA - senkouB) / ((senkouA + senkouB) / 2 || 1)
      : null

  let distanceToCloud: number | null = null
  if (senkouA != null && senkouB != null) {
    const top = Math.max(senkouA, senkouB)
    const bot = Math.min(senkouA, senkouB)
    if (close > top) distanceToCloud = (close - top) / close
    else if (close < bot) distanceToCloud = (bot - close) / close
    else distanceToCloud = 0
  }

  const tkSpread =
    tenkan != null && kijun != null && kijun !== 0
      ? (tenkan - kijun) / kijun
      : null

  const futureCloudBullish =
    senkouAArr[last] != null && senkouBArr[last] != null
      ? (senkouAArr[last] as number) > (senkouBArr[last] as number)
      : null

  return {
    tenkan,
    kijun,
    senkouA,
    senkouB,
    chikou,
    cloudPosition,
    cloudThickness,
    distanceToCloud,
    tkSpread,
    futureCloudBullish,
  }
}
