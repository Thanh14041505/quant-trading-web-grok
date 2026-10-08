import type { ConfidenceLevel, SignalAction, TradeQuality } from "./signal"
import type { MarketRegime } from "./market"

/** Sector buckets for sector-aware fundamental scoring */
export type HoldSector =
  | "BANK"
  | "SECURITIES"
  | "REAL_ESTATE"
  | "MANUFACTURING"
  | "CONSUMER"
  | "ENERGY"
  | "TECH"
  | "OTHER"

export interface HoldScoreWeights {
  earnings_growth: number
  business_quality: number
  balance_sheet_cash_flow: number
  valuation: number
  long_term_trend: number
  catalyst_risk: number
}

export const DEFAULT_HOLD_WEIGHTS: HoldScoreWeights = {
  earnings_growth: 0.25,
  business_quality: 0.2,
  balance_sheet_cash_flow: 0.2,
  valuation: 0.15,
  long_term_trend: 0.15,
  catalyst_risk: 0.05,
}

/** Normalized fundamental inputs (provider-agnostic) */
export interface HoldFundamentals {
  symbol: string
  sector?: HoldSector | string
  roe?: number // %
  roa?: number
  roic?: number
  grossMargin?: number
  operatingMargin?: number
  netMargin?: number
  debtToEquity?: number
  interestCoverage?: number
  operatingCashFlow?: number
  fcf?: number
  revenueGrowth?: number // %
  epsGrowth?: number
  profitGrowth?: number
  pe?: number
  pb?: number
  peg?: number
  dividendYield?: number // %
  // Bank-specific
  nim?: number
  npl?: number
  casa?: number
  // Securities
  brokerageShare?: number
  // Real estate
  inventoryDays?: number
}

export interface HoldSignal {
  symbol: string
  date: string
  engine: "HOLD"
  setup: string // e.g. QUALITY_GROWTH, VALUE_TREND
  action: SignalAction
  score: number
  tradeQuality: TradeQuality
  confidence: ConfidenceLevel
  sector: HoldSector | string
  /** Key fundamental snapshot for UI */
  metrics: {
    roe?: number
    roa?: number
    pe?: number
    pb?: number
    epsGrowth?: number
    revenueGrowth?: number
    debtToEquity?: number
    fcf?: number
    rs120?: number
    aboveEma200?: boolean
  }
  upsideHint?: string
  catalyst?: string
  reasons: string[]
  risks: string[]
  marketRegime: MarketRegime | string
  strategyVersion: string
  componentScores?: Record<string, number>
}
