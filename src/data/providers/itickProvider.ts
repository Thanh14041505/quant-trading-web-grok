import type { MarketDataProvider, ProviderConfig } from "./types"
import type { OHLCV, CompanyInfo, FundamentalData } from "@/models/market"
import { adaptBars } from "@/data/adapters/ohlcvAdapter"
import { validateOHLCV } from "@/data/validation/ohlcv"
import {
  DataProviderError,
  isLikelyCorsError,
} from "./errors"

/**
 * iTick-compatible provider (https://api.itick.org)
 * Uses token header. Historical kline endpoint.
 *
 * NOTE: CORS support depends on iTick's current policy.
 * If browser is blocked, testConnection will report CORS_UNSUPPORTED
 * and user should stay on Mock or use a CORS-enabled alternative.
 */
export class ItickMarketDataProvider implements MarketDataProvider {
  readonly id = "itick"
  readonly name = "iTick (VN)"
  readonly requiresApiKey = true

  private apiKey: string
  private base = "https://api.itick.org"

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new DataProviderError(
        "NOT_CONFIGURED",
        "iTick provider requires an API key (token)"
      )
    }
    this.apiKey = config.apiKey
  }

  async getHistoricalPrices(
    symbol: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCV[]> {
    // iTick uses kType=8 for daily; limit based on approximate range
    const days =
      (new Date(endDate).getTime() - new Date(startDate).getTime()) /
      (1000 * 60 * 60 * 24)
    const limit = Math.min(Math.max(Math.ceil(days * 0.8), 50), 1000)

    const url = `${this.base}/stock/kline?region=VN&code=${encodeURIComponent(
      symbol
    )}&kType=8&limit=${limit}`

    const json = await this.fetchJson(url)
    const data = (json as any)?.data
    if (!Array.isArray(data)) {
      throw new DataProviderError(
        "PARSE_ERROR",
        `Unexpected iTick response shape for ${symbol}`
      )
    }

    // Map t/o/h/l/c/v → internal
    const adapted = adaptBars(data, symbol)
    // Filter to requested range
    const filtered = adapted.filter(
      (b) => b.date >= startDate && b.date <= endDate
    )
    const { valid, cleaned, issues } = validateOHLCV(filtered, { minBars: 1 })
    if (!valid) {
      throw new DataProviderError(
        "DATA_ERROR",
        `Invalid data for ${symbol}: ${issues[0]?.message ?? "unknown"}`,
        { details: issues }
      )
    }
    return cleaned
  }

  async getCompanyInfo(symbol: string): Promise<CompanyInfo> {
    return {
      symbol: symbol.toUpperCase(),
      name: symbol.toUpperCase(),
      exchange: "HOSE",
    }
  }

  async getFundamentals(symbol: string): Promise<FundamentalData> {
    return {
      symbol: symbol.toUpperCase(),
      asOf: new Date().toISOString().slice(0, 10),
    }
  }

  async getMarketIndex(
    index: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCV[]> {
    // Map common index names
    const code =
      index.toUpperCase() === "VNINDEX"
        ? "VNINDEX"
        : index.toUpperCase() === "VN30"
          ? "VN30"
          : index
    return this.getHistoricalPrices(code, startDate, endDate)
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      // Small request
      const end = new Date()
      const start = new Date()
      start.setDate(start.getDate() - 14)
      await this.getHistoricalPrices(
        "VNM",
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10)
      )
      return { ok: true, message: "iTick connection OK (sample VNM data received)" }
    } catch (e) {
      if (e instanceof DataProviderError) {
        if (e.code === "CORS_UNSUPPORTED") {
          return {
            ok: false,
            message:
              "CORS blocked by iTick. Browser cannot call this API directly. Stay on Mock or use a CORS-enabled endpoint / self-hosted proxy (not provided by this app).",
          }
        }
        return { ok: false, message: `[${e.code}] ${e.message}` }
      }
      return {
        ok: false,
        message: e instanceof Error ? e.message : "Unknown error",
      }
    }
  }

  private async fetchJson(url: string): Promise<unknown> {
    let res: Response
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          token: this.apiKey,
        },
        mode: "cors",
      })
    } catch (err) {
      if (isLikelyCorsError(err)) {
        throw new DataProviderError(
          "CORS_UNSUPPORTED",
          "CORS blocked when calling iTick API",
          { cause: err }
        )
      }
      throw new DataProviderError("NETWORK_ERROR", "Network error calling iTick", {
        cause: err,
      })
    }

    if (res.status === 401 || res.status === 403) {
      throw new DataProviderError(
        "INVALID_API_KEY",
        "Invalid or missing iTick token",
        { status: res.status }
      )
    }
    if (res.status === 429) {
      throw new DataProviderError("RATE_LIMITED", "iTick rate limit", {
        status: 429,
      })
    }
    if (!res.ok) {
      throw new DataProviderError(
        "HTTP_ERROR",
        `iTick HTTP ${res.status}`,
        { status: res.status }
      )
    }
    return res.json()
  }
}
