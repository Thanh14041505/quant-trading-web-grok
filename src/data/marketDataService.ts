import { getDataProvider } from "@/data/providers"
import { getOrFetch, type CacheLookupResult } from "@/data/cache"
import type { OHLCV, CompanyInfo, FundamentalData } from "@/models/market"

/**
 * Application-level data access.
 * Always goes through cache → provider.
 * Strategies should prefer this over calling the provider directly.
 */
export async function fetchHistoricalPrices(
  symbol: string,
  startDate: string,
  endDate: string,
  options?: { forceRefresh?: boolean }
): Promise<CacheLookupResult<OHLCV[]>> {
  const provider = getDataProvider()
  return getOrFetch<OHLCV[]>({
    providerId: provider.id,
    kind: "ohlcv",
    symbol,
    startDate,
    endDate,
    forceRefresh: options?.forceRefresh,
    fetchFn: () => provider.getHistoricalPrices(symbol, startDate, endDate),
  })
}

export async function fetchMarketIndex(
  index: string,
  startDate: string,
  endDate: string,
  options?: { forceRefresh?: boolean }
): Promise<CacheLookupResult<OHLCV[]>> {
  const provider = getDataProvider()
  return getOrFetch<OHLCV[]>({
    providerId: provider.id,
    kind: "index",
    symbol: index,
    startDate,
    endDate,
    forceRefresh: options?.forceRefresh,
    fetchFn: () => provider.getMarketIndex(index, startDate, endDate),
  })
}

export async function fetchCompanyInfo(
  symbol: string,
  options?: { forceRefresh?: boolean }
): Promise<CacheLookupResult<CompanyInfo>> {
  const provider = getDataProvider()
  return getOrFetch<CompanyInfo>({
    providerId: provider.id,
    kind: "company",
    symbol,
    forceRefresh: options?.forceRefresh,
    fetchFn: () => provider.getCompanyInfo(symbol),
  })
}

export async function fetchFundamentals(
  symbol: string,
  options?: { forceRefresh?: boolean }
): Promise<CacheLookupResult<FundamentalData>> {
  const provider = getDataProvider()
  return getOrFetch<FundamentalData>({
    providerId: provider.id,
    kind: "fundamentals",
    symbol,
    forceRefresh: options?.forceRefresh,
    fetchFn: () => provider.getFundamentals(symbol),
  })
}
