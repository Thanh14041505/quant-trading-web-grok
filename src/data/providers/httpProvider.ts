import type { MarketDataProvider, ProviderConfig } from "./types"
import type { OHLCV, CompanyInfo, FundamentalData } from "@/models/market"
import { adaptBars } from "@/data/adapters/ohlcvAdapter"
import { validateOHLCV } from "@/data/validation/ohlcv"
import {
  DataProviderError,
  isLikelyCorsError,
} from "./errors"

/**
 * Generic HTTP provider.
 * User supplies baseUrl + optional API key / headers.
 *
 * Expected convention (can be adapted later):
 *   GET {baseUrl}/ohlcv?symbol=XXX&start=YYYY-MM-DD&end=YYYY-MM-DD
 *   Response: { data: RawBar[] } | RawBar[]
 *
 * This is intentionally flexible so users can point it at any
 * CORS-enabled endpoint (self-hosted proxy, iTick, StockInSheet, etc.).
 */
export class HttpMarketDataProvider implements MarketDataProvider {
  readonly id = "http"
  readonly name = "Generic HTTP Provider"
  readonly requiresApiKey = false // optional

  private baseUrl: string
  private apiKey?: string
  private headers: Record<string, string>

  constructor(config: ProviderConfig) {
    if (!config.baseUrl) {
      throw new DataProviderError(
        "NOT_CONFIGURED",
        "HTTP provider requires a baseUrl"
      )
    }
    this.baseUrl = config.baseUrl.replace(/\/$/, "")
    this.apiKey = config.apiKey
    this.headers = {
      Accept: "application/json",
      ...config.headers,
    }
    if (this.apiKey) {
      // Common patterns
      this.headers["Authorization"] = `Bearer ${this.apiKey}`
      this.headers["X-API-KEY"] = this.apiKey
      this.headers["token"] = this.apiKey
    }
  }

  async getHistoricalPrices(
    symbol: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCV[]> {
    const url = `${this.baseUrl}/ohlcv?symbol=${encodeURIComponent(symbol)}&start=${startDate}&end=${endDate}`
    const json = await this.fetchJson(url)
    const rawList = extractArray(json)
    const adapted = adaptBars(rawList, symbol)
    const { valid, cleaned, issues } = validateOHLCV(adapted, { minBars: 1 })
    if (!valid) {
      throw new DataProviderError(
        "DATA_ERROR",
        `Invalid OHLCV for ${symbol}: ${issues.map((i) => i.message).join("; ")}`,
        { details: issues }
      )
    }
    return cleaned
  }

  async getCompanyInfo(symbol: string): Promise<CompanyInfo> {
    const url = `${this.baseUrl}/company?symbol=${encodeURIComponent(symbol)}`
    try {
      const json = await this.fetchJson(url)
      const data = (json as any).data ?? json
      return {
        symbol: symbol.toUpperCase(),
        name: data.name ?? data.companyName ?? symbol,
        exchange: data.exchange ?? "HOSE",
        sector: data.sector,
        industry: data.industry,
      }
    } catch {
      // Fallback minimal info
      return {
        symbol: symbol.toUpperCase(),
        name: symbol.toUpperCase(),
        exchange: "HOSE",
      }
    }
  }

  async getFundamentals(symbol: string): Promise<FundamentalData> {
    const url = `${this.baseUrl}/fundamentals?symbol=${encodeURIComponent(symbol)}`
    try {
      const json = await this.fetchJson(url)
      const data = (json as any).data ?? json
      return {
        symbol: symbol.toUpperCase(),
        asOf: data.asOf ?? new Date().toISOString().slice(0, 10),
        ...data,
      }
    } catch {
      return {
        symbol: symbol.toUpperCase(),
        asOf: new Date().toISOString().slice(0, 10),
      }
    }
  }

  async getMarketIndex(
    index: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCV[]> {
    // Reuse ohlcv endpoint with index symbol
    return this.getHistoricalPrices(index, startDate, endDate)
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      // Prefer a lightweight health endpoint; fall back to a short OHLCV
      const healthUrl = `${this.baseUrl}/health`
      try {
        await this.fetchJson(healthUrl)
        return { ok: true, message: "HTTP provider reachable (health OK)" }
      } catch {
        // Try a small data request
        const testUrl = `${this.baseUrl}/ohlcv?symbol=VNM&start=2024-01-01&end=2024-01-10`
        await this.fetchJson(testUrl)
        return { ok: true, message: "HTTP provider reachable (sample OHLCV OK)" }
      }
    } catch (e) {
      if (e instanceof DataProviderError) {
        if (e.code === "CORS_UNSUPPORTED") {
          return {
            ok: false,
            message:
              "CORS blocked. This endpoint does not allow browser requests. Use a CORS-enabled API or keep Mock provider.",
          }
        }
        return { ok: false, message: e.message }
      }
      return {
        ok: false,
        message: e instanceof Error ? e.message : "Unknown connection error",
      }
    }
  }

  private async fetchJson(url: string): Promise<unknown> {
    let res: Response
    try {
      res = await fetch(url, {
        method: "GET",
        headers: this.headers,
        mode: "cors",
      })
    } catch (err) {
      if (isLikelyCorsError(err)) {
        throw new DataProviderError(
          "CORS_UNSUPPORTED",
          `CORS blocked when calling ${url}. Frontend-only apps cannot bypass this.`,
          { cause: err }
        )
      }
      throw new DataProviderError(
        "NETWORK_ERROR",
        `Network error calling ${url}`,
        { cause: err }
      )
    }

    if (res.status === 401 || res.status === 403) {
      throw new DataProviderError(
        "INVALID_API_KEY",
        `Unauthorized (${res.status}). Check API key.`,
        { status: res.status }
      )
    }
    if (res.status === 429) {
      throw new DataProviderError(
        "RATE_LIMITED",
        "Rate limit exceeded. Slow down or upgrade plan.",
        { status: 429 }
      )
    }
    if (!res.ok) {
      throw new DataProviderError(
        "HTTP_ERROR",
        `HTTP ${res.status} from ${url}`,
        { status: res.status }
      )
    }

    try {
      return await res.json()
    } catch (err) {
      throw new DataProviderError(
        "PARSE_ERROR",
        "Failed to parse JSON response",
        { cause: err }
      )
    }
  }
}

function extractArray(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>
    if (Array.isArray(obj.data)) return obj.data
    if (Array.isArray(obj.results)) return obj.results
    if (Array.isArray(obj.items)) return obj.items
    if (Array.isArray(obj.bars)) return obj.bars
  }
  return []
}
