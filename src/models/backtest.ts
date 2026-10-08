export interface BacktestCosts {
  /** Commission rate per side, e.g. 0.0015 = 0.15% */
  commissionRate: number
  /** Slippage rate per side, e.g. 0.001 = 0.1% */
  slippageRate: number
  /** Sell-side tax (e.g. Vietnam 0.1%) */
  sellTaxRate: number
}

export const DEFAULT_COSTS: BacktestCosts = {
  commissionRate: 0.0015,
  slippageRate: 0.001,
  sellTaxRate: 0.001,
}

export interface BacktestConfig {
  initialCapital: number
  /** Risk per trade as fraction of equity, e.g. 0.01 = 1% */
  riskPerTrade: number
  maxConcurrentPositions: number
  /** Max fraction of equity in one position */
  maxPositionPct: number
  lotSize: number
  costs: BacktestCosts
  /** Min R:R to take trade */
  minRiskReward: number
  /** Min signal score */
  minScore: number
  /** Max hold sessions (T+ horizon) */
  maxHoldSessions: number
  /** Take profit at TP1 (partial) then trail / exit at TP2 or SL */
  useTp1: boolean
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  initialCapital: 1_000_000_000, // 1 tỷ VND
  riskPerTrade: 0.01,
  maxConcurrentPositions: 5,
  maxPositionPct: 0.2,
  lotSize: 100,
  costs: DEFAULT_COSTS,
  minRiskReward: 1.3,
  minScore: 55,
  maxHoldSessions: 15,
  useTp1: true,
}

export type TradeExitReason =
  | "SL"
  | "TP1"
  | "TP2"
  | "TIME"
  | "SIGNAL_EXIT"
  | "END"

export interface BacktestTrade {
  id: string
  symbol: string
  setup: string
  score: number
  entryDate: string
  exitDate: string
  entryPrice: number
  exitPrice: number
  shares: number
  stopLoss: number
  tp1?: number
  tp2?: number
  riskPerShare: number
  /** Realized R multiple vs initial risk */
  rMultiple: number
  grossPnl: number
  costs: number
  netPnl: number
  holdSessions: number
  exitReason: TradeExitReason
  /** Side always long in V1 */
  side: "LONG"
}

export interface EquityPoint {
  date: string
  equity: number
  cash: number
  openPositions: number
}

export interface BacktestMetrics {
  totalReturn: number
  cagr: number | null
  maxDrawdown: number
  maxDrawdownDuration: number
  winRate: number
  profitFactor: number
  expectancy: number
  avgR: number
  avgWin: number
  avgLoss: number
  tradeCount: number
  winCount: number
  lossCount: number
  /** Rough daily Sharpe proxy */
  sharpeLike: number | null
  avgHoldSessions: number
  totalCosts: number
  finalEquity: number
}

export interface BacktestResult {
  config: BacktestConfig
  trades: BacktestTrade[]
  equityCurve: EquityPoint[]
  metrics: BacktestMetrics
  strategyVersion: string
  asOf: string
  durationMs: number
  symbolsScanned: number
  notes: string[]
}
