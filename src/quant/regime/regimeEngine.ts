import type { OHLCV } from "@/models/market"
import type { MarketRegime } from "@/models/market"
import { ema, slope, stdev, lastNonNull } from "@/indicators/math"
import { computeVolumeFeatures } from "@/indicators/volume"
import type {
  BreadthMetrics,
  RegimeInputs,
  RegimeResult,
  RegimeEngineOptions,
} from "./types"

/**
 * Multi-factor market regime classifier.
 * Does NOT rely on a single indicator.
 *
 * Hierarchy of signals:
 * 1. Trend location (price vs EMA50/200)
 * 2. Trend slopes (EMA20/50/200)
 * 3. ADX + DI direction
 * 4. Volatility regime
 * 5. Volume confirmation
 * 6. Breadth (when available)
 * 7. Short-term momentum (pullback vs breakdown)
 */
export function classifyRegime(
  indexBars: OHLCV[],
  options: RegimeEngineOptions = {}
): RegimeResult | null {
  if (!indexBars || indexBars.length < 60) return null

  const sorted = [...indexBars].sort((a, b) => a.date.localeCompare(b.date))
  const closes = sorted.map((b) => b.close)
  const last = sorted.length - 1
  const close = closes[last]
  const asOf = sorted[last].date

  const e20 = ema(closes, 20)
  const e50 = ema(closes, 50)
  const e200 = ema(closes, 200)
  const s20 = slope(e20, 5)
  const s50 = slope(e50, 10)
  const s200 = slope(e200, 20)

  const ema20 = lastNonNull(e20)
  const ema50 = lastNonNull(e50)
  const ema200 = lastNonNull(e200)
  const ema20Slope = lastNonNull(s20)
  const ema50Slope = lastNonNull(s50)
  const ema200Slope = lastNonNull(s200)

  // ADX from simplified true-range style on index
  const { adx, diPlus, diMinus } = computeSimpleADX(sorted, 14)

  // Volatility: 20d stdev of returns
  const rets: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const p = closes[i - 1]
    rets.push(p === 0 ? 0 : (closes[i] - p) / p)
  }
  const volSeries = stdev(rets, 20)
  // volSeries is aligned to rets which is length-1 vs closes
  const volatility20 = lastNonNull(volSeries)

  const volFeat = computeVolumeFeatures(sorted)
  const rvol20 = volFeat.rvol20

  const ret5 = periodReturn(closes, 5)
  const ret20 = periodReturn(closes, 20)

  const inputs: RegimeInputs = {
    close,
    ema20,
    ema50,
    ema200,
    ema20Slope,
    ema50Slope,
    ema200Slope,
    adx,
    diPlus,
    diMinus,
    volatility20,
    rvol20,
    ret5,
    ret20,
    breadth: options.breadth ?? null,
  }

  return scoreRegime(inputs, asOf)
}

function periodReturn(closes: number[], period: number): number | null {
  if (closes.length <= period) return null
  const a = closes[closes.length - 1 - period]
  const b = closes[closes.length - 1]
  if (a === 0) return null
  return (b - a) / a
}

function computeSimpleADX(bars: OHLCV[], period: number) {
  const n = bars.length
  if (n < period + 2) {
    return { adx: null as number | null, diPlus: null as number | null, diMinus: null as number | null }
  }
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

  let atr = 0,
    pDM = 0,
    mDM = 0
  for (let i = 0; i < period; i++) {
    atr += tr[i]
    pDM += plusDM[i]
    mDM += minusDM[i]
  }

  const dxList: number[] = []
  let lastDip = 0,
    lastDim = 0
  for (let i = period; i < n; i++) {
    if (i > period) {
      atr = atr - atr / period + tr[i]
      pDM = pDM - pDM / period + plusDM[i]
      mDM = mDM - mDM / period + minusDM[i]
    }
    const dip = atr === 0 ? 0 : (100 * pDM) / atr
    const dim = atr === 0 ? 0 : (100 * mDM) / atr
    lastDip = dip
    lastDim = dim
    const denom = dip + dim
    dxList.push(denom === 0 ? 0 : (100 * Math.abs(dip - dim)) / denom)
  }

  let adxVal = 0
  if (dxList.length >= period) {
    for (let i = 0; i < period; i++) adxVal += dxList[i]
    adxVal /= period
    for (let i = period; i < dxList.length; i++) {
      adxVal = (adxVal * (period - 1) + dxList[i]) / period
    }
  } else if (dxList.length > 0) {
    adxVal = dxList.reduce((a, c) => a + c, 0) / dxList.length
  }

  return {
    adx: dxList.length ? adxVal : null,
    diPlus: lastDip || null,
    diMinus: lastDim || null,
  }
}

function scoreRegime(inputs: RegimeInputs, asOf: string): RegimeResult {
  let score = 0
  const reasons: string[] = []
  const risks: string[] = []

  const {
    close,
    ema20,
    ema50,
    ema200,
    ema20Slope,
    ema50Slope,
    ema200Slope,
    adx,
    diPlus,
    diMinus,
    volatility20,
    rvol20,
    ret5,
    ret20,
    breadth,
  } = inputs

  // --- 1. Trend location ---
  if (ema200 != null) {
    if (close > ema200) {
      score += 20
      reasons.push("PRICE_ABOVE_EMA200")
    } else {
      score -= 20
      risks.push("PRICE_BELOW_EMA200")
    }
  }
  if (ema50 != null) {
    if (close > ema50) {
      score += 15
      reasons.push("PRICE_ABOVE_EMA50")
    } else {
      score -= 15
      risks.push("PRICE_BELOW_EMA50")
    }
  }
  if (ema20 != null) {
    if (close > ema20) {
      score += 8
      reasons.push("PRICE_ABOVE_EMA20")
    } else {
      score -= 8
      // mild – can be pullback
    }
  }

  // Stacked EMAs (bull alignment)
  if (ema20 != null && ema50 != null && ema200 != null) {
    if (ema20 > ema50 && ema50 > ema200) {
      score += 12
      reasons.push("EMA_STACK_BULL")
    } else if (ema20 < ema50 && ema50 < ema200) {
      score -= 12
      risks.push("EMA_STACK_BEAR")
    }
  }

  // --- 2. Slopes ---
  if (ema50Slope != null) {
    if (ema50Slope > 0.005) {
      score += 10
      reasons.push("EMA50_RISING")
    } else if (ema50Slope < -0.005) {
      score -= 10
      risks.push("EMA50_FALLING")
    }
  }
  if (ema200Slope != null) {
    if (ema200Slope > 0.002) {
      score += 8
      reasons.push("EMA200_RISING")
    } else if (ema200Slope < -0.002) {
      score -= 8
      risks.push("EMA200_FALLING")
    }
  }
  if (ema20Slope != null) {
    if (ema20Slope > 0.008) score += 4
    else if (ema20Slope < -0.008) score -= 4
  }

  // --- 3. ADX / DI ---
  if (adx != null && adx > 25) {
    if (diPlus != null && diMinus != null) {
      if (diPlus > diMinus) {
        score += 10
        reasons.push("ADX_TREND_UP")
      } else {
        score -= 10
        risks.push("ADX_TREND_DOWN")
      }
    }
  } else if (adx != null && adx < 18) {
    // weak trend → sideways lean
    score *= 0.7
    reasons.push("ADX_WEAK_SIDEWAYS_BIAS")
  }

  // --- 4. Volatility ---
  // Typical daily vol for VNINDEX ~0.8–1.5%; panic when elevated
  if (volatility20 != null) {
    if (volatility20 > 0.025) {
      score -= 15
      risks.push("HIGH_VOLATILITY")
    } else if (volatility20 > 0.018) {
      score -= 6
      risks.push("ELEVATED_VOLATILITY")
    } else if (volatility20 < 0.008) {
      reasons.push("LOW_VOLATILITY")
    }
  }

  // --- 5. Volume ---
  if (rvol20 != null) {
    if (rvol20 > 1.8 && ret5 != null && ret5 < -0.02) {
      score -= 8
      risks.push("HIGH_VOLUME_SELLING")
    } else if (rvol20 > 1.5 && ret5 != null && ret5 > 0.015) {
      score += 5
      reasons.push("HIGH_VOLUME_BUYING")
    }
  }

  // --- 6. Breadth ---
  if (breadth) {
    if (breadth.pctAboveEma20 != null) {
      if (breadth.pctAboveEma20 >= 60) {
        score += 10
        reasons.push("BREADTH_STRONG_EMA20")
      } else if (breadth.pctAboveEma20 <= 35) {
        score -= 10
        risks.push("BREADTH_WEAK_EMA20")
      }
    }
    if (breadth.pctAboveEma50 != null) {
      if (breadth.pctAboveEma50 >= 55) {
        score += 8
        reasons.push("BREADTH_STRONG_EMA50")
      } else if (breadth.pctAboveEma50 <= 30) {
        score -= 8
        risks.push("BREADTH_WEAK_EMA50")
      }
    }
    if (breadth.advanceDeclineRatio != null) {
      if (breadth.advanceDeclineRatio >= 1.5) {
        score += 6
        reasons.push("AD_RATIO_BULLISH")
      } else if (breadth.advanceDeclineRatio <= 0.6) {
        score -= 6
        risks.push("AD_RATIO_BEARISH")
      }
    }
  }

  // --- 7. Short-term momentum (pullback detection) ---
  const aboveEma50 = ema50 != null && close > ema50
  const aboveEma200 = ema200 != null && close > ema200
  const belowEma20 = ema20 != null && close < ema20
  const mildPullback =
    aboveEma50 &&
    belowEma20 &&
    ret5 != null &&
    ret5 > -0.04 &&
    ret5 < 0 &&
    (ema50Slope == null || ema50Slope > -0.003)

  // Clamp score
  score = Math.max(-100, Math.min(100, score))

  // --- Classify ---
  let regime: MarketRegime
  const highVol = volatility20 != null && volatility20 > 0.022
  const crash =
    (ret5 != null && ret5 < -0.05) ||
    (ret20 != null && ret20 < -0.1) ||
    (highVol && score < -30)

  if (crash && score < -25) {
    regime = "PANIC"
  } else if (score >= 35 && aboveEma50 && aboveEma200) {
    regime = mildPullback ? "BULL_PULLBACK" : "BULL"
  } else if (score >= 15 && aboveEma200) {
    regime = mildPullback ? "BULL_PULLBACK" : score >= 25 ? "BULL" : "SIDEWAYS"
  } else if (score <= -40 || (!aboveEma200 && score < -15)) {
    regime = "BEAR"
  } else if (
    aboveEma200 &&
    !aboveEma50 &&
    ret20 != null &&
    ret20 < 0 &&
    score < 10
  ) {
    regime = "DISTRIBUTION"
  } else if (Math.abs(score) < 20 || (adx != null && adx < 18)) {
    regime = "SIDEWAYS"
  } else if (score > 0) {
    regime = mildPullback ? "BULL_PULLBACK" : "SIDEWAYS"
  } else {
    regime = score < -25 ? "BEAR" : "DISTRIBUTION"
  }

  // Confidence
  let confidence: RegimeResult["confidence"] = "MEDIUM"
  const absScore = Math.abs(score)
  const hasBreadth = Boolean(breadth && breadth.sampleSize > 0)
  if (absScore >= 50 && (adx == null || adx > 22)) confidence = "HIGH"
  else if (absScore < 20 || (!hasBreadth && absScore < 35)) confidence = "LOW"
  if (regime === "PANIC") confidence = highVol ? "HIGH" : "MEDIUM"

  if (mildPullback && regime === "BULL_PULLBACK") {
    reasons.push("MILD_PULLBACK_IN_UPTREND")
  }

  return {
    regime,
    confidence,
    score: Math.round(score),
    reasons,
    risks,
    inputs,
    asOf,
  }
}

/**
 * Compute breadth metrics from a map of symbol → OHLCV bars.
 * Uses last bar vs EMA20/50 and daily advance/decline.
 */
export function computeBreadth(
  seriesMap: Map<string, OHLCV[]>
): BreadthMetrics {
  let above20 = 0
  let above50 = 0
  let advances = 0
  let declines = 0
  let sample = 0

  for (const bars of seriesMap.values()) {
    if (!bars || bars.length < 55) continue
    const closes = bars.map((b) => b.close)
    const e20 = ema(closes, 20)
    const e50 = ema(closes, 50)
    const last = closes.length - 1
    const c = closes[last]
    const prev = closes[last - 1]
    sample++
    if (e20[last] != null && c > (e20[last] as number)) above20++
    if (e50[last] != null && c > (e50[last] as number)) above50++
    if (c > prev) advances++
    else if (c < prev) declines++
  }

  return {
    pctAboveEma20: sample > 0 ? (above20 / sample) * 100 : null,
    pctAboveEma50: sample > 0 ? (above50 / sample) * 100 : null,
    advanceDeclineRatio:
      declines > 0 ? advances / declines : advances > 0 ? Infinity : null,
    netAdvances: advances - declines,
    sampleSize: sample,
  }
}
