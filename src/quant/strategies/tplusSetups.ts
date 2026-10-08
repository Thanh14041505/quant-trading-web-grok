import type { FeatureSnapshot } from "@/quant/features"
import type { TPlusSetup } from "@/models/signal"
import type { OHLCV } from "@/models/market"

export interface SetupDetection {
  setup: TPlusSetup
  quality: number // 0–100
  reasons: string[]
  risks: string[]
}

/**
 * Detect the primary T+ setup from features + recent bars.
 * Priority order matters when multiple setups overlap.
 */
export function detectTPlusSetup(
  features: FeatureSnapshot,
  bars: OHLCV[]
): SetupDetection {
  const candidates: SetupDetection[] = []

  const breakout = detectBreakout(features, bars)
  if (breakout) candidates.push(breakout)

  const pullback = detectPullback(features, bars)
  if (pullback) candidates.push(pullback)

  const momentum = detectMomentumContinuation(features)
  if (momentum) candidates.push(momentum)

  const rsiDiv = detectRsiDivergenceReversal(features)
  if (rsiDiv) candidates.push(rsiDiv)

  const vsa = detectVsaReversal(features)
  if (vsa) candidates.push(vsa)

  const meanRev = detectMeanReversion(features)
  if (meanRev) candidates.push(meanRev)

  if (candidates.length === 0) {
    return {
      setup: "NONE",
      quality: 0,
      reasons: [],
      risks: ["NO_SETUP_DETECTED"],
    }
  }

  // Highest quality wins
  candidates.sort((a, b) => b.quality - a.quality)
  return candidates[0]
}

function detectBreakout(
  f: FeatureSnapshot,
  bars: OHLCV[]
): SetupDetection | null {
  const { structure, volume, trend } = f
  const rp20 = structure.rangePosition20
  const rvol = volume.rvol20
  if (rp20 == null || rvol == null) return null

  // Near/above 20D high with volume expansion
  const nearHigh = rp20 >= 0.92
  const volOk = rvol >= 1.3
  const trendOk = trend.aboveEma50 || trend.aboveEma20

  if (!nearHigh || !volOk) return null

  const reasons: string[] = ["BREAKOUT_RANGE_20"]
  const risks: string[] = []
  let quality = 55

  if (rvol >= 1.8) {
    quality += 15
    reasons.push("RVOL_HIGH")
  } else if (rvol >= 1.5) {
    quality += 8
    reasons.push("RVOL_ELEVATED")
  }

  if (trend.aboveEma50) {
    quality += 10
    reasons.push("ABOVE_EMA50")
  }
  if (trend.aboveEma200) {
    quality += 5
    reasons.push("ABOVE_EMA200")
  }
  if (structure.state === "BREAKOUT" || structure.state === "MARKUP") {
    quality += 8
    reasons.push(`STRUCTURE_${structure.state}`)
  }

  // Extended risk
  if (f.momentum.rsi14 != null && f.momentum.rsi14 > 75) {
    quality -= 12
    risks.push("RSI_EXTENDED")
  }
  if (structure.distanceFromHigh50 != null && structure.distanceFromHigh50 < 0.01) {
    risks.push("NEAR_RESISTANCE_50")
  }

  // Confirm last bar not a failure (close in upper half of range)
  const last = bars[bars.length - 1]
  const range = last.high - last.low
  if (range > 0 && (last.close - last.low) / range < 0.4) {
    quality -= 10
    risks.push("WEAK_BREAKOUT_CLOSE")
  }

  quality = clamp(quality, 0, 100)
  if (quality < 45) return null

  return { setup: "BREAKOUT", quality, reasons, risks }
}

function detectPullback(f: FeatureSnapshot, bars: OHLCV[]): SetupDetection | null {
  const { trend, structure, momentum, volume } = f
  // Pullback in uptrend: above EMA50/200, price near EMA20, not crashing
  if (!trend.aboveEma50) return null
  if (trend.ema20 == null) return null

  const distToEma20 = (f.close - trend.ema20) / trend.ema20
  const nearEma20 = distToEma20 > -0.04 && distToEma20 < 0.015
  const rp20 = structure.rangePosition20
  const midRange = rp20 != null && rp20 > 0.25 && rp20 < 0.75

  if (!nearEma20 && !midRange) return null
  if (momentum.rsi14 != null && momentum.rsi14 > 65) return null // not a real pullback

  const reasons: string[] = ["PULLBACK_IN_UPTREND"]
  const risks: string[] = []
  let quality = 50

  if (trend.aboveEma200) {
    quality += 12
    reasons.push("ABOVE_EMA200")
  }
  if (trend.ema50Slope != null && trend.ema50Slope > 0) {
    quality += 8
    reasons.push("EMA50_RISING")
  }
  if (nearEma20) {
    quality += 10
    reasons.push("NEAR_EMA20_SUPPORT")
  }
  if (volume.cmf20 != null && volume.cmf20 > 0) {
    quality += 8
    reasons.push("CMF_POSITIVE")
  }
  if (momentum.rsi14 != null && momentum.rsi14 >= 40 && momentum.rsi14 <= 55) {
    quality += 8
    reasons.push("RSI_RESET_ZONE")
  }

  // Last bar bullish reversal hint
  const last = bars[bars.length - 1]
  if (last.close > last.open) {
    quality += 5
    reasons.push("BULLISH_CANDLE")
  }

  if (volume.rvol20 != null && volume.rvol20 < 0.5) {
    risks.push("VERY_LOW_VOLUME")
    quality -= 5
  }
  if (trend.adx != null && trend.adx < 15) {
    risks.push("WEAK_TREND_ADX")
    quality -= 5
  }

  quality = clamp(quality, 0, 100)
  if (quality < 48) return null
  return { setup: "PULLBACK", quality, reasons, risks }
}

function detectMomentumContinuation(f: FeatureSnapshot): SetupDetection | null {
  const { trend, momentum, volume, structure } = f
  if (!trend.aboveEma20 || !trend.aboveEma50) return null
  if (momentum.macdHist == null || momentum.macdHist <= 0) return null
  if (momentum.rsi14 != null && (momentum.rsi14 < 50 || momentum.rsi14 > 78))
    return null

  const reasons: string[] = ["MOMENTUM_CONTINUATION"]
  const risks: string[] = []
  let quality = 48

  if (momentum.macdHist > 0) {
    quality += 10
    reasons.push("MACD_HIST_POSITIVE")
  }
  if (momentum.roc5 != null && momentum.roc5 > 0) {
    quality += 6
    reasons.push("ROC5_POSITIVE")
  }
  if (volume.rvol20 != null && volume.rvol20 >= 1.1) {
    quality += 8
    reasons.push("VOLUME_SUPPORT")
  }
  if (structure.rangePosition20 != null && structure.rangePosition20 > 0.6) {
    quality += 5
    reasons.push("UPPER_RANGE")
  }
  if (momentum.rsi14 != null && momentum.rsi14 > 72) {
    risks.push("RSI_EXTENDED")
    quality -= 10
  }

  quality = clamp(quality, 0, 100)
  if (quality < 50) return null
  return { setup: "MOMENTUM_CONTINUATION", quality, reasons, risks }
}

function detectRsiDivergenceReversal(f: FeatureSnapshot): SetupDetection | null {
  const div = f.divergence.rsiDivergence
  if (div !== "RSI_BULLISH") return null

  const reasons: string[] = ["RSI_BULLISH_DIVERGENCE"]
  const risks: string[] = []
  let quality = 55

  if (f.momentum.rsi14 != null && f.momentum.rsi14 < 40) {
    quality += 12
    reasons.push("RSI_OVERSOLD_ZONE")
  }
  if (f.volume.vsaPattern === "STOPPING_VOLUME" || f.volume.vsaPattern === "CLIMAX_DOWN") {
    quality += 10
    reasons.push(`VSA_${f.volume.vsaPattern}`)
  }
  if (f.trend.aboveEma200) {
    quality += 5
    reasons.push("ABOVE_EMA200")
  } else {
    risks.push("BELOW_EMA200_COUNTER_TREND")
    quality -= 8
  }
  if (f.structure.rangePosition20 != null && f.structure.rangePosition20 < 0.25) {
    quality += 6
    reasons.push("NEAR_RANGE_LOW")
  }

  quality = clamp(quality, 0, 100)
  return { setup: "RSI_DIVERGENCE_REVERSAL", quality, reasons, risks }
}

function detectVsaReversal(f: FeatureSnapshot): SetupDetection | null {
  const p = f.volume.vsaPattern
  if (p !== "STOPPING_VOLUME" && p !== "CLIMAX_DOWN" && p !== "NO_SUPPLY") {
    return null
  }

  const reasons: string[] = [`VSA_${p}`]
  const risks: string[] = []
  let quality = 50

  if (p === "STOPPING_VOLUME") quality += 12
  if (p === "NO_SUPPLY") quality += 8
  if (f.structure.rangePosition20 != null && f.structure.rangePosition20 < 0.35) {
    quality += 10
    reasons.push("NEAR_SUPPORT_ZONE")
  }
  if (f.momentum.rsi14 != null && f.momentum.rsi14 < 45) {
    quality += 6
    reasons.push("RSI_NOT_EXTENDED")
  }
  if (!f.trend.aboveEma50 && !f.trend.aboveEma200) {
    risks.push("NO_MAJOR_TREND_SUPPORT")
    quality -= 8
  }

  quality = clamp(quality, 0, 100)
  if (quality < 48) return null
  return { setup: "VSA_REVERSAL", quality, reasons, risks }
}

function detectMeanReversion(f: FeatureSnapshot): SetupDetection | null {
  // Fade extended move back toward mean (EMA20) in non-panic conditions
  const { momentum, trend, structure } = f
  if (momentum.rsi14 == null || trend.ema20 == null) return null

  const oversold = momentum.rsi14 < 30
  const overbought = momentum.rsi14 > 75
  if (!oversold && !overbought) return null

  // Prefer mean reversion only when not in strong ADX trend against us
  if (trend.adx != null && trend.adx > 35) return null

  const reasons: string[] = oversold
    ? ["MEAN_REVERSION_OVERSOLD"]
    : ["MEAN_REVERSION_OVERBOUGHT"]
  const risks: string[] = ["COUNTER_TREND_RISK"]
  let quality = 45

  if (oversold) {
    quality += 10
    if (structure.rangePosition20 != null && structure.rangePosition20 < 0.2) {
      quality += 8
      reasons.push("AT_RANGE_EXTREME")
    }
  } else {
    // Overbought fade is lower priority for long-biased T+
    quality -= 5
    risks.push("SHORT_SIDE_NOT_PRIMARY")
  }

  quality = clamp(quality, 0, 100)
  if (quality < 48 || overbought) return null // long-biased engine for now
  return { setup: "MEAN_REVERSION", quality, reasons, risks }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}
