import type { MarketDataProvider } from "./types"
import type { OHLCV, CompanyInfo, FundamentalData } from "@/models/market"
import { validateOHLCV } from "@/data/validation/ohlcv"

function generateMockOHLCV(
  symbol: string,
  startDate: string,
  endDate: string,
  basePrice = 50
): OHLCV[] {
  const bars: OHLCV[] = []
  const start = new Date(startDate)
  const end = new Date(endDate)
  let price = basePrice
  let d = new Date(start)

  // Deterministic seed from symbol for reproducible mock
  let seed = 0
  for (let i = 0; i < symbol.length; i++) seed = (seed * 31 + symbol.charCodeAt(i)) >>> 0
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0xffffffff
  }

  while (d <= end) {
    const day = d.getDay()
    if (day !== 0 && day !== 6) {
      const change = (rand() - 0.48) * 2.2
      const open = price
      const close = Math.max(1, price + change)
      const high = Math.max(open, close) + rand() * 1.5
      const low = Math.min(open, close) - rand() * 1.5
      const volume = Math.floor(80_000 + rand() * 3_000_000)
      bars.push({
        symbol: symbol.toUpperCase(),
        date: d.toISOString().slice(0, 10),
        open: +open.toFixed(2),
        high: +high.toFixed(2),
        low: +low.toFixed(2),
        close: +close.toFixed(2),
        volume,
        value: +(volume * close).toFixed(0),
      })
      price = close
    }
    d.setDate(d.getDate() + 1)
  }
  return bars
}

export class MockMarketDataProvider implements MarketDataProvider {
  readonly id = "mock"
  readonly name = "Mock Provider"
  readonly requiresApiKey = false

  async getHistoricalPrices(
    symbol: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCV[]> {
    await delay(60 + Math.random() * 80)
    const raw = generateMockOHLCV(symbol, startDate, endDate)
    const { cleaned } = validateOHLCV(raw)
    return cleaned
  }

  async getCompanyInfo(symbol: string): Promise<CompanyInfo> {
    await delay(40)
    const s = symbol.toUpperCase()
    const banks = ["VCB", "TCB", "MBB", "BID", "CTG", "VPB", "ACB", "HDB", "STB", "TPB"]
    const secs = ["SSI", "VCI", "HCM", "VND", "SHS"]
    const re = ["VIC", "VHM", "VRE", "NVL", "PDR", "DXG"]
    let sector = "Manufacturing"
    if (banks.includes(s)) sector = "Banking"
    else if (secs.includes(s)) sector = "Securities"
    else if (re.includes(s)) sector = "Real Estate"
    else if (["FPT", "CMG"].includes(s)) sector = "Technology"
    else if (["VNM", "MSN", "MWG", "PNJ"].includes(s)) sector = "Consumer"
    else if (["GAS", "PLX", "POW"].includes(s)) sector = "Energy"
    return {
      symbol: s,
      name: `${s} Joint Stock Company (Mock)`,
      exchange: "HOSE",
      sector,
      industry: sector,
    }
  }

  async getFundamentals(symbol: string): Promise<FundamentalData> {
    await delay(50)
    const s = symbol.toUpperCase()
    // Deterministic-ish profile by symbol hash for stable demos
    let seed = 0
    for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) >>> 0
    const r = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0xffffffff
    }
    const banks = new Set(["VCB", "TCB", "MBB", "BID", "CTG", "VPB", "ACB", "HDB", "STB", "TPB"])
    const isBank = banks.has(s)
    return {
      symbol: s,
      asOf: new Date().toISOString().slice(0, 10),
      roe: isBank ? 10 + r() * 12 : 8 + r() * 20,
      roa: isBank ? 0.8 + r() * 1.5 : 3 + r() * 10,
      pe: 6 + r() * 20,
      pb: isBank ? 0.8 + r() * 1.8 : 0.6 + r() * 3,
      eps: 1 + r() * 8,
      revenueGrowth: -5 + r() * 30,
      epsGrowth: -8 + r() * 40,
      debtToEquity: isBank ? 5 + r() * 8 : r() * 1.6,
      // extended fields used by Hold engine
      nim: isBank ? 2.5 + r() * 2 : undefined,
      npl: isBank ? 0.8 + r() * 2.5 : undefined,
      casa: isBank ? 15 + r() * 30 : undefined,
      fcf: (r() - 0.35) * 1e12,
      operatingCashFlow: (r() - 0.2) * 1e12,
      grossMargin: 15 + r() * 35,
      operatingMargin: 5 + r() * 20,
      netMargin: 3 + r() * 15,
      peg: 0.5 + r() * 2,
      dividendYield: r() * 6,
      sector: isBank ? "Banking" : undefined,
    } as FundamentalData
  }

  async getMarketIndex(
    index: string,
    startDate: string,
    endDate: string
  ): Promise<OHLCV[]> {
    await delay(60)
    const base = index.toUpperCase().includes("VN30") ? 1350 : 1280
    const raw = generateMockOHLCV(index, startDate, endDate, base)
    const { cleaned } = validateOHLCV(raw)
    return cleaned
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    await delay(200)
    return { ok: true, message: "Mock provider is always available (synthetic data)" }
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
