import type { MarketRegime } from "@/models/market"

export type { MarketRegime }

export interface BreadthMetrics {
  /** % of stocks above EMA20 (0–100) */
  pctAboveEma20: number | null
  /** % of stocks above EMA50 (0–100) */
  pctAboveEma50: number | null
  /** Advance / Decline ratio */
  advanceDeclineRatio: number | null
  /** Net advances (advances - declines) */
  netAdvances: number | null
  /** Number of symbols in breadth sample */
  sampleSize: number
}

export interface RegimeInputs {
  /** Latest close */
  close: number
  ema20: number | null
  ema50: number | null
  ema200: number | null
  ema20Slope: number | null
  ema50Slope: number | null
  ema200Slope: number | null
  adx: number | null
  diPlus: number | null
  diMinus: number | null
  /** Realized vol (e.g. 20d stdev of returns) */
  volatility20: number | null
  /** Volume vs 20d average */
  rvol20: number | null
  /** Recent return (e.g. 5d / 20d) */
  ret5: number | null
  ret20: number | null
  breadth?: BreadthMetrics | null
}

export interface RegimeResult {
  regime: MarketRegime
  confidence: "LOW" | "MEDIUM" | "HIGH"
  score: number // -100 (panic/bear) … +100 (strong bull)
  reasons: string[]
  risks: string[]
  inputs: RegimeInputs
  asOf: string
}

export interface RegimeEngineOptions {
  /** Override breadth if precomputed */
  breadth?: BreadthMetrics | null
}
