import type { MarketDataProvider, ProviderConfig } from "./types"
import type { OHLCV, CompanyInfo, FundamentalData } from "@/models/market"
import { adaptBars } from "@/data/adapters/ohlcvAdapter"
import { validateOHLCV } from "@/data/validation/ohlcv"
import { DataProviderError, isLikelyCorsError } from "./errors"

/**
 * Calls same-origin Vercel Python functions:
 *   GET /api/ohlcv?symbol=&start=&end=
 *   GET /api/index?symbol=VNINDEX&start=&end=
 *
 * No API key. Requires deployment with api/*.py + requirements.txt.
 */
export class VnstockMarketDataProvider implements MarketDataProvider {
  readonly id = "vnstock"
  readonly name = "VNStock (Vercel API)"
  readonly requiresApiKey = false

  private base: string

  constructor(config: ProviderConfig = { id: "vnstock" }) {
    // Empty = same origin (production). Override for custom proxy.
    this.base = (config.baseUrl ?? "").replace(/\/$/, "")
  }

  private url(path: string, params: Record<string, string>) {
    const q = new URLSearchParams(params).toString()
    return `${this.base}${path}?${q}`
  }

  private async fetchJson(url: string): Promise<unknown> {
    let res: Response
    try {
      res = await fetch(url, {
        headers: { Accept: "application/json" },
      })
    } catch (e) {
      if (isLikelyCorsError(e)) {
        throw new DataProviderError(
          "CORS_UNSUPPORTED",
          "Cannot reach /api — deploy Python functions on Vercel or check network",
          { cause: e }
        )
      }
      throw new DataProviderError("NETWORK_ERROR", String(e), { cause: e })
    }
    const text = await res.text()
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new DataProviderError(
        "PARSE_ERROR",
        `Non-JSON from ${url}: ${text.slice(0, 200)}`
      )
    }
    if (!res.ok) {
      const err = (json as { error?: string })?.error ?? res.statusText
      throw new DataProviderError("DATA_ERROR", err)
    }
    return json
  }

  async getHistoricalPrices(
    symbol: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCV[]> {
    const json = await this.fetchJson(
      this.url("/api/ohlcv", {
        symbol,
        start: startDate,
        end: endDate,
      })
    )
    const raw = (json as { data?: unknown }).data
    if (!Array.isArray(raw)) {
      throw new DataProviderError("PARSE_ERROR", "Missing data array from /api/ohlcv")
    }
    const adapted = adaptBars(raw, symbol)
    const { valid, cleaned, issues } = validateOHLCV(adapted, { minBars: 1 })
    if (!valid) {
      throw new DataProviderError(
        "DATA_ERROR",
        issues[0]?.message ?? "Invalid OHLCV",
        { details: issues }
      )
    }
    return cleaned
  }

  async getMarketIndex(
    indexSymbol: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCV[]> {
    const json = await this.fetchJson(
      this.url("/api/index", {
        symbol: indexSymbol,
        start: startDate,
        end: endDate,
      })
    )
    const raw = (json as { data?: unknown }).data
    if (!Array.isArray(raw)) {
      // fallback to ohlcv endpoint
      return this.getHistoricalPrices(indexSymbol, startDate, endDate)
    }
    const adapted = adaptBars(raw, indexSymbol)
    const { cleaned } = validateOHLCV(adapted, { minBars: 1 })
    return cleaned
  }

  async getCompanyInfo(symbol: string): Promise<CompanyInfo> {
    return {
      symbol: symbol.toUpperCase(),
      name: `${symbol.toUpperCase()} (VNStock)`,
      exchange: "HOSE",
      sector: "Unknown",
      industry: "Unknown",
    }
  }

  async getFundamentals(symbol: string): Promise<FundamentalData> {
    return {
      symbol: symbol.toUpperCase(),
      asOf: new Date().toISOString().slice(0, 10),
    }
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      const healthUrl = `${this.base}/api/health`
      const res = await fetch(healthUrl)
      if (!res.ok) {
        return {
          ok: false,
          message: `Health HTTP ${res.status} — has the project been deployed with Python api/?`,
        }
      }
      // light OHLCV probe
      const end = new Date().toISOString().slice(0, 10)
      const start = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
      const bars = await this.getHistoricalPrices("VCB", start, end)
      return {
        ok: bars.length > 0,
        message: `VNStock API OK — VCB ${bars.length} bars (latest ${bars[bars.length - 1]?.date})`,
      }
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      }
    }
  }
}
