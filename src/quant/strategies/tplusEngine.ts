import type { OHLCV } from "@/models/market"
import type { TradingSignal, TPlusScoreWeights } from "@/models/signal"
import { DEFAULT_TPLUS_WEIGHTS } from "@/models/signal"
import { computeFeatures } from "@/quant/features"
import type { FeatureSnapshot } from "@/quant/features"
import type { RegimeResult } from "@/quant/regime"
import { detectTPlusSetup } from "./tplusSetups"
import { scoreTPlus } from "@/quant/scoring/tplusScoring"
import { buildRiskPlan, decideAction } from "@/quant/risk/tplusRisk"

export const TPLUS_STRATEGY_VERSION = "TPLUS_MULTI_v1.2"

export interface TPlusEngineOptions {
  weights?: TPlusScoreWeights
  regime?: RegimeResult | null
  indexBars?: OHLCV[]
}

export interface TPlusEngineResult {
  signal: TradingSignal
  features: FeatureSnapshot
}

function collectHardRisks(features: FeatureSnapshot): string[] {
  const risks: string[] = []
  const close = features.close
  const ema200 = features.trend?.ema200
  const cloud =
    (features as { ichimoku?: { cloudTop?: number; cloudBottom?: number; position?: string } })
      .ichimoku ??
    (features as { Ichimoku?: { cloudTop?: number } }).Ichimoku

  // Ichimoku below cloud
  const pos = (features as { ichimoku?: { cloudPosition?: string } }).ichimoku
    ?.cloudPosition
  if (
    pos === "BELOW" ||
    pos === "below" ||
    (cloud &&
      typeof (cloud as { cloudTop?: number }).cloudTop === "number" &&
      close < (cloud as { cloudTop: number }).cloudTop)
  ) {
    risks.push("BELOW_ICHIMOKU_CLOUD")
  }

  if (ema200 != null && close < ema200) {
    risks.push("BELOW_EMA200")
  }

  const div = (features as {
    divergence?: { rsiBearish?: boolean; macdBearish?: boolean }
  }).divergence
  if (div?.rsiBearish || div?.macdBearish) {
    risks.push("BEARISH_DIVERGENCE")
  }

  const structure = (features as { structure?: { swing?: string; pattern?: string } })
    .structure
  const swing = String(structure?.swing ?? structure?.pattern ?? "").toUpperCase()
  if (swing.includes("DISTRIBUTION") || swing.includes("LH_LL")) {
    risks.push("DISTRIBUTION_STRUCTURE")
  }

  return risks
}

/**
 * Full T+ pipeline for one symbol.
 * Returns signal + features so scan can pre-build export rows (no re-fetch).
 */
export function runTPlusEngine(
  bars: OHLCV[],
  options: TPlusEngineOptions = {}
): TradingSignal | null {
  const full = runTPlusEngineDetailed(bars, options)
  return full?.signal ?? null
}

export function runTPlusEngineDetailed(
  bars: OHLCV[],
  options: TPlusEngineOptions = {}
): TPlusEngineResult | null {
  if (!bars || bars.length < 30) return null

  const features = computeFeatures(bars, { indexBars: options.indexBars })
  if (!features) return null

  const setup = detectTPlusSetup(features, bars)
  const breakdown = scoreTPlus(
    features,
    setup,
    options.regime ?? null,
    options.weights ?? DEFAULT_TPLUS_WEIGHTS
  )

  const riskPlan =
    setup.setup !== "NONE"
      ? buildRiskPlan(features, bars, setup.setup)
      : null

  const regimeName = options.regime?.regime ?? "SIDEWAYS"
  const hardRisks = collectHardRisks(features)

  const { action, tradeQuality, confidence, tradabilityScore } = decideAction({
    score: breakdown.total,
    riskPlan,
    setup,
    regimeName,
    hardRisks,
  })

  const reasons = [...breakdown.reasons]
  const risks = [...new Set([...breakdown.risks, ...hardRisks])]

  if (riskPlan) {
    const rrCons = Math.min(riskPlan.riskReward, riskPlan.riskRewardAtHigh)
    if (rrCons < 1.5) risks.push("LOW_REWARD_RISK")
    if (rrCons >= 1.8) reasons.push("FAVORABLE_RR")
    if (riskPlan.entryWidthPct > 3) risks.push("WIDE_ENTRY_ZONE")
  }

  const avgVal20 = (() => {
    const slice = bars.slice(-20)
    if (!slice.length) return null
    let s = 0
    for (const b of slice) {
      s += (b.value != null ? b.value : b.close * b.volume) as number
    }
    return s / slice.length
  })()
  if (avgVal20 != null && avgVal20 < 3_000_000_000) {
    risks.push("LOW_LIQUIDITY_VALUE")
  }

  const signal: TradingSignal = {
    symbol: features.symbol,
    date: features.date,
    featureDate: features.date,
    computedAt: new Date().toISOString(),
    engine: "TPLUS",
    setup: setup.setup,
    action,
    score: breakdown.total,
    tradabilityScore,
    tradeQuality,
    confidence,
    entryZone: riskPlan?.entryZone,
    trigger: riskPlan?.trigger,
    triggerPrice: riskPlan?.triggerPrice ?? null,
    stopLoss: riskPlan?.stopLoss,
    tp1: riskPlan?.tp1,
    tp2: riskPlan?.tp2,
    riskReward: riskPlan?.riskReward,
    riskRewardAtHigh: riskPlan?.riskRewardAtHigh,
    riskRewardAtLow: riskPlan?.riskRewardAtLow,
    riskPct: riskPlan?.riskPct,
    rewardPct: riskPlan?.rewardPctAtMid,
    entryWidthPct: riskPlan?.entryWidthPct,
    atr14: riskPlan?.atr14,
    referenceClose: features.close,
    reasons: [...new Set(reasons)],
    risks: [...new Set(risks)],
    marketRegime: regimeName,
    strategyVersion: TPLUS_STRATEGY_VERSION,
    componentScores: breakdown.components,
  }

  return { signal, features }
}

export function runTPlusScan(
  seriesMap: Map<string, OHLCV[]>,
  options: TPlusEngineOptions = {}
): {
  signals: TradingSignal[]
  exportRows: Record<string, string | number | boolean | null>[]
  errors: { symbol: string; error: string }[]
} {
  const signals: TradingSignal[] = []
  const exportRows: Record<string, string | number | boolean | null>[] = []
  const errors: { symbol: string; error: string }[] = []

  for (const [symbol, bars] of seriesMap) {
    try {
      const detailed = runTPlusEngineDetailed(bars, options)
      if (!detailed) {
        errors.push({ symbol, error: "INSUFFICIENT_OR_NO_SIGNAL" })
        continue
      }
      signals.push(detailed.signal)
      exportRows.push(buildExportRow(detailed.signal, detailed.features, bars.length))
    } catch (e) {
      errors.push({
        symbol,
        error: e instanceof Error ? e.message : "TPLUS_ERROR",
      })
    }
  }

  // Rank by tradability first, then raw score
  signals.sort(
    (a, b) =>
      (b.tradabilityScore ?? b.score) - (a.tradabilityScore ?? a.score) ||
      b.score - a.score
  )
  exportRows.sort((a, b) => {
    const ta = Number(a.tradabilityScore ?? a.score ?? 0)
    const tb = Number(b.tradabilityScore ?? b.score ?? 0)
    return tb - ta
  })

  return { signals, exportRows, errors }
}

/** Compact audit row — built once at scan time for instant Excel export */
export function buildExportRow(
  s: TradingSignal,
  f: FeatureSnapshot,
  barCount: number
): Record<string, string | number | boolean | null> {
  const flatFeat = (obj: unknown, prefix: string, depth = 0): Record<string, string | number | boolean | null> => {
    const out: Record<string, string | number | boolean | null> = {}
    if (obj == null || depth > 3) return out
    if (typeof obj !== "object") {
      out[prefix] = obj as string | number | boolean
      return out
    }
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = `${prefix}.${k}`
      if (v != null && typeof v === "object" && !Array.isArray(v)) {
        Object.assign(out, flatFeat(v, key, depth + 1))
      } else if (Array.isArray(v)) {
        out[key] = v.map(String).join("|")
      } else if (
        typeof v === "number" ||
        typeof v === "boolean" ||
        typeof v === "string"
      ) {
        out[key] = v as string | number | boolean
      }
    }
    return out
  }

  const comps = s.componentScores ?? {}
  return {
    symbol: s.symbol,
    featureDate: s.featureDate ?? s.date,
    computedAt: s.computedAt ?? "",
    referenceClose: s.referenceClose ?? f.close,
    barCount,
    setup: s.setup,
    action: s.action,
    score: s.score,
    tradabilityScore: s.tradabilityScore ?? s.score,
    tradeQuality: s.tradeQuality,
    confidence: s.confidence,
    marketRegime: String(s.marketRegime),
    entryLow: s.entryZone?.low ?? null,
    entryHigh: s.entryZone?.high ?? null,
    entryWidthPct: s.entryWidthPct ?? null,
    trigger: s.trigger ?? "",
    triggerPrice: s.triggerPrice ?? null,
    stopLoss: s.stopLoss ?? null,
    tp1: s.tp1 ?? null,
    tp2: s.tp2 ?? null,
    riskReward_mid: s.riskReward ?? null,
    riskReward_atHigh: s.riskRewardAtHigh ?? null,
    riskReward_atLow: s.riskRewardAtLow ?? null,
    riskPct: s.riskPct ?? null,
    rewardPct: s.rewardPct ?? null,
    atr14: s.atr14 ?? null,
    reasons: s.reasons.join(" | "),
    risks: s.risks.join(" | "),
    strategyVersion: s.strategyVersion,
    // component scores flat
    ...Object.fromEntries(
      Object.entries(comps).map(([k, v]) => [`comp.${k}`, v])
    ),
    // key features only (not entire tree — saves CPU/memory)
    "feat.close": f.close,
    "feat.trend.ema20": f.trend?.ema20 ?? null,
    "feat.trend.ema50": f.trend?.ema50 ?? null,
    "feat.trend.ema200": f.trend?.ema200 ?? null,
    "feat.momentum.rsi14": (f as { momentum?: { rsi14?: number } }).momentum?.rsi14 ?? null,
    "feat.structure.high20": f.structure?.high20 ?? null,
    "feat.structure.low20": f.structure?.low20 ?? null,
    "feat.structure.high50": f.structure?.high50 ?? null,
    "feat.volume.rvol20": (f as { volume?: { rvol20?: number } }).volume?.rvol20 ?? null,
    features_ok: true,
    live_equals_snapshot: true,
    note_live:
      "Snapshot at scan time. live_*=snapshot (no second recompute). Re-scan to refresh.",
  }
}
