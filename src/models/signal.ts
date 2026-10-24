import type { MarketRegime } from "./market"

export type TPlusSetup =
  | "BREAKOUT"
  | "PULLBACK"
  | "MOMENTUM_CONTINUATION"
  | "RSI_DIVERGENCE_REVERSAL"
  | "VSA_REVERSAL"
  | "MEAN_REVERSION"
  | "NONE"

export type SignalAction =
  | "BUY"
  | "WATCH"
  | "WAIT"
  | "NO_TRADE"
  | "EXIT"
  | "HOLD"
  | "TRIM"

export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH"

export type TradeQuality = "LOW" | "MEDIUM" | "HIGH"

export interface EntryZone {
  low: number
  high: number
}

export interface TradingSignal {
  symbol: string
  date: string
  engine: "TPLUS" | "HOLD"
  setup: TPlusSetup | string
  action: SignalAction
  /** Opportunity / candidate score 0–100 (not the same as tradability) */
  score: number
  /**
   * Execution attractiveness 0–100 — combines score, conservative R:R,
   * setup quality, hard risks, regime penalty. Prefer this for ranking trades.
   */
  tradabilityScore?: number
  tradeQuality: TradeQuality
  confidence: ConfidenceLevel
  entryZone?: EntryZone
  trigger?: string
  triggerPrice?: number | null
  stopLoss?: number
  tp1?: number
  tp2?: number
  /** R:R at entry midpoint */
  riskReward?: number
  /** Conservative R:R if filled at entry high */
  riskRewardAtHigh?: number
  riskRewardAtLow?: number
  riskPct?: number
  rewardPct?: number
  entryWidthPct?: number
  atr14?: number
  referenceClose?: number
  reasons: string[]
  risks: string[]
  marketRegime: MarketRegime | string
  strategyVersion: string
  componentScores?: Record<string, number>
  /** Feature / decision bar date */
  featureDate?: string
  /** ISO timestamp when signal was computed client-side */
  computedAt?: string
}

export interface TPlusScoreWeights {
  trend_structure: number
  relative_strength: number
  setup_quality: number
  volume_money_flow: number
  momentum: number
  market_regime: number
  price_location: number
  liquidity_risk: number
}

export const DEFAULT_TPLUS_WEIGHTS: TPlusScoreWeights = {
  trend_structure: 0.2,
  relative_strength: 0.15,
  setup_quality: 0.2,
  volume_money_flow: 0.15,
  momentum: 0.1,
  market_regime: 0.1,
  price_location: 0.05,
  liquidity_risk: 0.05,
}
