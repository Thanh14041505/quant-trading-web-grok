import type { OHLCV } from "@/models/market"
import { ema, sma, slope, rollingMax, rollingMin, lastNonNull } from "./math"

export interface TrendFeatures {
  ema10: number | null
  ema20: number | null
  ema50: number | null
  ema100: number | null
  ema200: number | null
  sma20: number | null
  sma50: number | null
  sma200: number | null
  ema20Slope: number | null
  ema50Slope: number | null
  ema200Slope: number | null
  adx: number | null
  diPlus: number | null
  diMinus: number | null
  /** Price vs EMAs */
  aboveEma20: boolean
  aboveEma50: boolean
  aboveEma200: boolean
  /** Structure labels from swing points (confirmed, no look-ahead) */
  recentHH: boolean
  recentHL: boolean
  recentLH: boolean
  recentLL: boolean
}

/** Wilder-smoothed ADX / DI */
function computeADX(bars: OHLCV[], period = 14) {
  const n = bars.length
  const diPlus: (number | null)[] = new Array(n).fill(null)
  const diMinus: (number | null)[] = new Array(n).fill(null)
  const adx: (number | null)[] = new Array(n).fill(null)
  if (n < period + 1) return { diPlus, diMinus, adx }

  const tr: number[] = []
  const plusDM: number[] = []
  const minusDM: number[] = []

  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tr.push(bars[i].high - bars[i].low)
      plusDM.push(0)
      minusDM.push(0)
      continue
    }
    const h = bars[i].high
    const l = bars[i].low
    const prevC = bars[i - 1].close
    const prevH = bars[i - 1].high
    const prevL = bars[i - 1].low
    tr.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)))
    const up = h - prevH
    const down = prevL - l
    plusDM.push(up > down && up > 0 ? up : 0)
    minusDM.push(down > up && down > 0 ? down : 0)
  }

  // Wilder smooth
  let atr = 0
  let pDM = 0
  let mDM = 0
  for (let i = 0; i < period; i++) {
    atr += tr[i]
    pDM += plusDM[i]
    mDM += minusDM[i]
  }

  const dxArr: number[] = []
  for (let i = period; i < n; i++) {
    if (i === period) {
      // first
    } else {
      atr = atr - atr / period + tr[i]
      pDM = pDM - pDM / period + plusDM[i]
      mDM = mDM - mDM / period + minusDM[i]
    }
    const dip = atr === 0 ? 0 : (100 * pDM) / atr
    const dim = atr === 0 ? 0 : (100 * mDM) / atr
    diPlus[i] = dip
    diMinus[i] = dim
    const denom = dip + dim
    dxArr.push(denom === 0 ? 0 : (100 * Math.abs(dip - dim)) / denom)
  }

  // ADX = Wilder smooth of DX
  if (dxArr.length >= period) {
    let adxVal = 0
    for (let i = 0; i < period; i++) adxVal += dxArr[i]
    adxVal /= period
    const startIdx = period + period - 1 // rough alignment
    // Align: first ADX at index period + period - 1
    let dxIdx = period - 1
    for (let i = period; i < n; i++) {
      if (i === period) {
        // wait until we have period DX values
      }
      if (dxIdx < dxArr.length) {
        if (i === period + period - 1) {
          adx[i] = adxVal
        } else if (i > period + period - 1) {
          adxVal = (adxVal * (period - 1) + dxArr[dxIdx]) / period
          adx[i] = adxVal
        }
        dxIdx++
      }
    }
    // Simpler fill: compute sequential from first full window
    adxVal = 0
    for (let i = 0; i < period && i < dxArr.length; i++) adxVal += dxArr[i]
    adxVal /= Math.min(period, dxArr.length)
    for (let i = 0; i < dxArr.length; i++) {
      if (i >= period - 1) {
        if (i === period - 1) {
          // already averaged
        } else {
          adxVal = (adxVal * (period - 1) + dxArr[i]) / period
        }
        const barIdx = period + i
        if (barIdx < n) adx[barIdx] = adxVal
      }
    }
  }

  return { diPlus, diMinus, adx }
}

/** Confirmed swing HH/HL/LH/LL using lookback pivots (no future bars) */
function swingStructure(closes: number[], highs: number[], lows: number[], left = 3) {
  // A pivot high at i is confirmed only when i+left has been seen,
  // so we only label pivots that are at least `left` bars in the past.
  let recentHH = false
  let recentHL = false
  let recentLH = false
  let recentLL = false

  const pivH: { i: number; v: number }[] = []
  const pivL: { i: number; v: number }[] = []

  for (let i = left; i < closes.length - left; i++) {
    let isPH = true
    let isPL = true
    for (let j = 1; j <= left; j++) {
      if (highs[i] <= highs[i - j] || highs[i] <= highs[i + j]) isPH = false
      if (lows[i] >= lows[i - j] || lows[i] >= lows[i + j]) isPL = false
    }
    // Only accept pivot if the right side is fully in the past relative to "now"
    // When computing at the end of series, i+left < length means confirmed.
    if (isPH) pivH.push({ i, v: highs[i] })
    if (isPL) pivL.push({ i, v: lows[i] })
  }

  if (pivH.length >= 2) {
    const a = pivH[pivH.length - 2]
    const b = pivH[pivH.length - 1]
    if (b.v > a.v) recentHH = true
    if (b.v < a.v) recentLH = true
  }
  if (pivL.length >= 2) {
    const a = pivL[pivL.length - 2]
    const b = pivL[pivL.length - 1]
    if (b.v > a.v) recentHL = true
    if (b.v < a.v) recentLL = true
  }

  return { recentHH, recentHL, recentLH, recentLL }
}

export function computeTrendFeatures(bars: OHLCV[]): TrendFeatures {
  const closes = bars.map((b) => b.close)
  const highs = bars.map((b) => b.high)
  const lows = bars.map((b) => b.low)

  const e10 = ema(closes, 10)
  const e20 = ema(closes, 20)
  const e50 = ema(closes, 50)
  const e100 = ema(closes, 100)
  const e200 = ema(closes, 200)
  const s20 = sma(closes, 20)
  const s50 = sma(closes, 50)
  const s200 = sma(closes, 200)

  const e20s = slope(e20, 5)
  const e50s = slope(e50, 10)
  const e200s = slope(e200, 20)

  const { diPlus, diMinus, adx } = computeADX(bars, 14)
  const structure = swingStructure(closes, highs, lows, 3)

  const last = closes.length - 1
  const close = closes[last]

  return {
    ema10: lastNonNull(e10),
    ema20: lastNonNull(e20),
    ema50: lastNonNull(e50),
    ema100: lastNonNull(e100),
    ema200: lastNonNull(e200),
    sma20: lastNonNull(s20),
    sma50: lastNonNull(s50),
    sma200: lastNonNull(s200),
    ema20Slope: lastNonNull(e20s),
    ema50Slope: lastNonNull(e50s),
    ema200Slope: lastNonNull(e200s),
    adx: lastNonNull(adx),
    diPlus: lastNonNull(diPlus),
    diMinus: lastNonNull(diMinus),
    aboveEma20: e20[last] != null ? close > (e20[last] as number) : false,
    aboveEma50: e50[last] != null ? close > (e50[last] as number) : false,
    aboveEma200: e200[last] != null ? close > (e200[last] as number) : false,
    ...structure,
  }
}

// Re-export series helpers for chart overlays
export function emaSeries(closes: number[], period: number) {
  return ema(closes, period)
}
export function smaSeries(closes: number[], period: number) {
  return sma(closes, period)
}
export { rollingMax, rollingMin }
