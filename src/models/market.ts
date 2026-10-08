/** Normalized OHLCV bar used throughout the app */
export interface OHLCV {
  symbol: string
  date: string // YYYY-MM-DD
  open: number
  high: number
  low: number
  close: number
  volume: number
  value?: number
}

export interface CompanyInfo {
  symbol: string
  name: string
  exchange: "HOSE" | "HNX" | "UPCOM" | string
  sector?: string
  industry?: string
}

export interface FundamentalData {
  symbol: string
  asOf: string
  roe?: number
  roa?: number
  pe?: number
  pb?: number
  eps?: number
  revenueGrowth?: number
  epsGrowth?: number
  debtToEquity?: number
  // extensible
  [key: string]: unknown
}

export type MarketRegime =
  | "BULL"
  | "BULL_PULLBACK"
  | "SIDEWAYS"
  | "DISTRIBUTION"
  | "BEAR"
  | "PANIC"
