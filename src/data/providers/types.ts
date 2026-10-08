import type { OHLCV, CompanyInfo, FundamentalData } from "@/models/market"

export interface MarketDataProvider {
  readonly id: string
  readonly name: string
  readonly requiresApiKey: boolean

  getHistoricalPrices(
    symbol: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCV[]>

  getCompanyInfo(symbol: string): Promise<CompanyInfo>

  getFundamentals(symbol: string): Promise<FundamentalData>

  getMarketIndex(
    index: "VNINDEX" | "VN30" | string,
    startDate: string,
    endDate: string
  ): Promise<OHLCV[]>

  testConnection(): Promise<{ ok: boolean; message?: string }>
}

export type ProviderId = "mock" | "http" | "itick" | "vnstock"

export interface ProviderConfig {
  id: ProviderId
  apiKey?: string
  /** Base URL for generic HTTP provider */
  baseUrl?: string
  /** Extra headers (e.g. custom auth) */
  headers?: Record<string, string>
}
