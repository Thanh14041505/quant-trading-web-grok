import type { FeatureSnapshot } from "@/quant/features"
import type { RegimeResult } from "@/quant/regime"
import type { SetupDetection } from "@/quant/strategies/tplusSetups"
import {
  DEFAULT_TPLUS_WEIGHTS,
  type TPlusScoreWeights,
} from "@/models/signal"
import type { MarketRegime } from "@/models/market"

export interface ScoreBreakdown {
  total: number // 0–100
  components: Record<string, number> // each 0–100
  reasons: string[]
  risks: string[]
}

/**
 * Weighted multi-factor T+ score.
 * Avoids naive indicator point-stacking; each component is a composite.
 */
export function scoreTPlus(
  features: FeatureSnapshot,
  setup: SetupDetection,
  regime: RegimeResult | null,
  weights: TPlusScoreWeights = DEFAULT_TPLUS_WEIGHTS
): ScoreBreakdown {
  const reasons: string[] = [...setup.reasons]
  const risks: string[] = [...setup.risks]

  const trend_structure = scoreTrendStructure(features, reasons, risks)
  const relative_strength = scoreRS(features, reasons, risks)
  const setup_quality = setup.quality
  const volume_money_flow = scoreVolume(features, reasons, risks)
  const momentum = scoreMomentum(features, reasons, risks)
  const market_regime = scoreRegime(regime, reasons, risks)
  const price_location = scorePriceLocation(features, reasons, risks)
  const liquidity_risk = scoreLiquidity(features, reasons, risks)

  const components: Record<string, number> = {
    trend_structure,
    relative_strength,
    setup_quality,
    volume_money_flow,
    momentum,
    market_regime,
    price_location,
    liquidity_risk,
  }

  let total = 0
  let wsum = 0
  for (const [k, w] of Object.entries(weights) as [keyof TPlusScoreWeights, number][]) {
    total += (components[k] ?? 0) * w
    wsum += w
  }
  if (wsum > 0) total = total / wsum

  // Setup NONE heavily penalizes
  if (setup.setup === "NONE") {
    total = Math.min(total, 35)
    risks.push("NO_CLEAR_SETUP")
  }

  return {
    total: Math.round(clamp(total, 0, 100)),
    components,
    reasons: dedupe(reasons),
    risks: dedupe(risks),
  }
}

function scoreTrendStructure(
  f: FeatureSnapshot,
  reasons: string[],
  risks: string[]
): number {
  let s = 40
  if (f.trend.aboveEma20) s += 10
  if (f.trend.aboveEma50) {
    s += 15
    reasons.push("ABOVE_EMA50")
  } else risks.push("BELOW_EMA50")
  if (f.trend.aboveEma200) {
    s += 12
    reasons.push("ABOVE_EMA200")
  }
  if (f.trend.ema50Slope != null && f.trend.ema50Slope > 0) s += 8
  if (f.trend.adx != null) {
    if (f.trend.adx > 25 && f.trend.diPlus != null && f.trend.diMinus != null) {
      if (f.trend.diPlus > f.trend.diMinus) s += 10
      else s -= 8
    }
  }
  if (f.trend.recentHH && f.trend.recentHL) {
    s += 8
    reasons.push("HH_HL_STRUCTURE")
  }
  if (f.trend.recentLH && f.trend.recentLL) {
    s -= 10
    risks.push("LH_LL_STRUCTURE")
  }
  return clamp(s, 0, 100)
}

function scoreRS(
  f: FeatureSnapshot,
  reasons: string[],
  risks: string[]
): number {
  let s = 50
  const rs20 = f.relativeStrength.rs20
  const rs60 = f.relativeStrength.rs60
  if (rs20 != null) {
    if (rs20 > 0.03) {
      s += 20
      reasons.push("RS20_OUTPERFORM")
    } else if (rs20 > 0) s += 8
    else if (rs20 < -0.03) {
      s -= 15
      risks.push("WEAK_RELATIVE_STRENGTH")
    }
  }
  if (rs60 != null) {
    if (rs60 > 0.05) s += 12
    else if (rs60 < -0.05) s -= 10
  }
  return clamp(s, 0, 100)
}

function scoreVolume(
  f: FeatureSnapshot,
  reasons: string[],
  risks: string[]
): number {
  let s = 45
  if (f.volume.rvol20 != null) {
    if (f.volume.rvol20 >= 1.5) {
      s += 18
      reasons.push("RVOL_HIGH")
    } else if (f.volume.rvol20 >= 1.1) s += 8
    else if (f.volume.rvol20 < 0.5) {
      s -= 10
      risks.push("LOW_VOLUME")
    }
  }
  if (f.volume.cmf20 != null) {
    if (f.volume.cmf20 > 0.05) {
      s += 15
      reasons.push("CMF_POSITIVE")
    } else if (f.volume.cmf20 < -0.05) {
      s -= 12
      risks.push("CMF_NEGATIVE")
    }
  }
  if (f.volume.obvSlope != null && f.volume.obvSlope > 0) s += 8
  return clamp(s, 0, 100)
}

function scoreMomentum(
  f: FeatureSnapshot,
  reasons: string[],
  risks: string[]
): number {
  let s = 50
  if (f.momentum.rsi14 != null) {
    if (f.momentum.rsi14 >= 45 && f.momentum.rsi14 <= 65) s += 12
    else if (f.momentum.rsi14 > 75) {
      s -= 15
      risks.push("RSI_EXTENDED")
    } else if (f.momentum.rsi14 < 30) s += 5 // potential reversal fuel
  }
  if (f.momentum.macdHist != null) {
    if (f.momentum.macdHist > 0) {
      s += 12
      reasons.push("MACD_HIST_POSITIVE")
    } else s -= 8
  }
  if (f.momentum.mfi14 != null) {
    if (f.momentum.mfi14 > 50 && f.momentum.mfi14 < 80) s += 8
    else if (f.momentum.mfi14 > 85) risks.push("MFI_EXTENDED")
  }
  return clamp(s, 0, 100)
}

function scoreRegime(
  regime: RegimeResult | null,
  reasons: string[],
  risks: string[]
): number {
  if (!regime) return 50
  const map: Record<MarketRegime, number> = {
    BULL: 85,
    BULL_PULLBACK: 75,
    SIDEWAYS: 50,
    DISTRIBUTION: 35,
    BEAR: 20,
    PANIC: 5,
  }
  const s = map[regime.regime] ?? 50
  if (regime.regime === "BULL" || regime.regime === "BULL_PULLBACK") {
    reasons.push(`MARKET_REGIME_${regime.regime}`)
  } else if (regime.regime === "BEAR" || regime.regime === "PANIC") {
    risks.push(`MARKET_REGIME_${regime.regime}`)
  } else if (regime.regime === "DISTRIBUTION") {
    risks.push("MARKET_REGIME_DISTRIBUTION")
  }
  return s
}

function scorePriceLocation(
  f: FeatureSnapshot,
  reasons: string[],
  risks: string[]
): number {
  let s = 50
  const rp = f.structure.rangePosition50
  if (rp == null) return s
  // Prefer not buying the absolute top for T+
  if (rp > 0.95) {
    s -= 15
    risks.push("NEAR_RESISTANCE")
  } else if (rp > 0.7 && rp <= 0.92) {
    s += 10 // healthy strength
  } else if (rp >= 0.3 && rp <= 0.55) {
    s += 15 // pullback zone
    reasons.push("PULLBACK_PRICE_LOCATION")
  } else if (rp < 0.15) {
    s += 5 // possible support, but weaker for momentum
  }
  return clamp(s, 0, 100)
}

function scoreLiquidity(
  f: FeatureSnapshot,
  _reasons: string[],
  risks: string[]
): number {
  // Higher volume = better liquidity score
  // Without average value in VND we use absolute volume heuristic
  const vol = f.volume.volume
  let s = 50
  if (vol >= 1_000_000) s = 90
  else if (vol >= 300_000) s = 75
  else if (vol >= 100_000) s = 55
  else {
    s = 30
    risks.push("LOW_LIQUIDITY")
  }
  return s
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function dedupe(arr: string[]) {
  return [...new Set(arr)]
}
