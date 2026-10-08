import type { OHLCV } from "@/models/market"
import { rollingMax, rollingMin, lastNonNull } from "./math"

export type StructureState =
  | "ACCUMULATION"
  | "BREAKOUT"
  | "MARKUP"
  | "PULLBACK"
  | "DISTRIBUTION"
  | "MARKDOWN"
  | "REVERSAL"
  | "UNKNOWN"

export interface StructureFeatures {
  high20: number | null
  low20: number | null
  high50: number | null
  low50: number | null
  high120: number | null
  low120: number | null
  high200: number | null
  low200: number | null
  distanceFromHigh20: number | null
  distanceFromLow20: number | null
  distanceFromHigh50: number | null
  rangePosition20: number | null
  rangePosition50: number | null
  rangePosition120: number | null
  state: StructureState
}

export function computeStructureFeatures(bars: OHLCV[]): StructureFeatures {
  const highs = bars.map((b) => b.high)
  const lows = bars.map((b) => b.low)
  const closes = bars.map((b) => b.close)
  const last = bars.length - 1
  const close = closes[last]

  const h20 = rollingMax(highs, 20)
  const l20 = rollingMin(lows, 20)
  const h50 = rollingMax(highs, 50)
  const l50 = rollingMin(lows, 50)
  const h120 = rollingMax(highs, 120)
  const l120 = rollingMin(lows, 120)
  const h200 = rollingMax(highs, 200)
  const l200 = rollingMin(lows, 200)

  const hh20 = lastNonNull(h20)
  const ll20 = lastNonNull(l20)
  const hh50 = lastNonNull(h50)
  const ll50 = lastNonNull(l50)
  const hh120 = lastNonNull(h120)
  const ll120 = lastNonNull(l120)
  const hh200 = lastNonNull(h200)
  const ll200 = lastNonNull(l200)

  const dist = (ref: number | null, isHigh: boolean) => {
    if (ref == null || ref === 0) return null
    return isHigh ? (ref - close) / ref : (close - ref) / ref
  }

  const rangePos = (hi: number | null, lo: number | null) => {
    if (hi == null || lo == null || hi === lo) return null
    return (close - lo) / (hi - lo)
  }

  const rp20 = rangePos(hh20, ll20)
  const rp50 = rangePos(hh50, ll50)
  const rp120 = rangePos(hh120, ll120)

  // Heuristic structure state (no look-ahead; based on current location + recent slope)
  let state: StructureState = "UNKNOWN"
  const recent = closes.slice(-20)
  const slope20 =
    recent.length >= 2
      ? (recent[recent.length - 1] - recent[0]) / (recent[0] || 1)
      : 0

  if (rp20 != null && rp50 != null) {
    if (rp20 > 0.95 && slope20 > 0.02) state = "BREAKOUT"
    else if (rp50 > 0.7 && slope20 > 0.03) state = "MARKUP"
    else if (rp50 > 0.5 && slope20 < -0.02 && slope20 > -0.06) state = "PULLBACK"
    else if (rp20 < 0.15 && slope20 < -0.03) state = "MARKDOWN"
    else if (rp50 < 0.35 && Math.abs(slope20) < 0.02) state = "ACCUMULATION"
    else if (rp50 > 0.75 && Math.abs(slope20) < 0.015) state = "DISTRIBUTION"
    else if (
      (slope20 > 0.04 && rp20 < 0.4) ||
      (slope20 < -0.04 && rp20 > 0.6)
    )
      state = "REVERSAL"
  }

  return {
    high20: hh20,
    low20: ll20,
    high50: hh50,
    low50: ll50,
    high120: hh120,
    low120: ll120,
    high200: hh200,
    low200: ll200,
    distanceFromHigh20: dist(hh20, true),
    distanceFromLow20: dist(ll20, false),
    distanceFromHigh50: dist(hh50, true),
    rangePosition20: rp20,
    rangePosition50: rp50,
    rangePosition120: rp120,
    state,
  }
}
