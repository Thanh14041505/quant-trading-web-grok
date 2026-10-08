import type { OHLCV } from "@/models/market"
import type { TradingSignal, TPlusScoreWeights } from "@/models/signal"
import { DEFAULT_TPLUS_WEIGHTS } from "@/models/signal"
import { computeFeatures } from "@/quant/features"
import type { RegimeResult } from "@/quant/regime"
import { detectTPlusSetup } from "./tplusSetups"
import { scoreTPlus } from "@/quant/scoring/tplusScoring"
import { buildRiskPlan, decideAction } from "@/quant/risk/tplusRisk"

export const TPLUS_STRATEGY_VERSION = "TPLUS_MULTI_v1"

export interface TPlusEngineOptions {
  weights?: TPlusScoreWeights
  regime?: RegimeResult | null
  indexBars?: OHLCV[]
}

/**
 * Full T+ pipeline for one symbol:
 * Features → Setup → Score → Risk plan → Action
 */
export function runTPlusEngine(
  bars: OHLCV[],
  options: TPlusEngineOptions = {}
): TradingSignal | null {
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
  const { action, tradeQuality, confidence } = decideAction(
    breakdown.total,
    riskPlan,
    setup,
    regimeName
  )

  // Merge reasons/risks
  const reasons = [...breakdown.reasons]
  const risks = [...breakdown.risks]
  if (riskPlan && riskPlan.riskReward < 1.3) {
    risks.push("LOW_REWARD_RISK")
  }
  if (riskPlan && riskPlan.riskReward >= 2) {
    reasons.push("FAVORABLE_RR")
  }

  return {
    symbol: features.symbol,
    date: features.date,
    engine: "TPLUS",
    setup: setup.setup,
    action,
    score: breakdown.total,
    tradeQuality,
    confidence,
    entryZone: riskPlan?.entryZone,
    trigger: riskPlan?.trigger,
    stopLoss: riskPlan?.stopLoss,
    tp1: riskPlan?.tp1,
    tp2: riskPlan?.tp2,
    riskReward: riskPlan?.riskReward,
    reasons: [...new Set(reasons)],
    risks: [...new Set(risks)],
    marketRegime: regimeName,
    strategyVersion: TPLUS_STRATEGY_VERSION,
    componentScores: breakdown.components,
  }
}

/**
 * Batch T+ scan with per-symbol error isolation.
 */
export function runTPlusScan(
  seriesMap: Map<string, OHLCV[]>,
  options: TPlusEngineOptions = {}
): { signals: TradingSignal[]; errors: { symbol: string; error: string }[] } {
  const signals: TradingSignal[] = []
  const errors: { symbol: string; error: string }[] = []

  for (const [symbol, bars] of seriesMap) {
    try {
      const sig = runTPlusEngine(bars, options)
      if (sig) signals.push(sig)
      else errors.push({ symbol, error: "INSUFFICIENT_OR_NO_SIGNAL" })
    } catch (e) {
      errors.push({
        symbol,
        error: e instanceof Error ? e.message : "TPLUS_ERROR",
      })
    }
  }

  // Rank by score desc
  signals.sort((a, b) => b.score - a.score)
  return { signals, errors }
}
