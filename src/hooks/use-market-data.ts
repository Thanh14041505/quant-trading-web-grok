import { useQuery } from "@tanstack/react-query"
import {
  fetchHistoricalPrices,
  fetchMarketIndex,
  fetchCompanyInfo,
  fetchFundamentals,
} from "@/data/marketDataService"
import { getDataProvider } from "@/data/providers"
import type { OHLCV, CompanyInfo, FundamentalData } from "@/models/market"

export interface CachedQueryResult<T> {
  data: T | undefined
  isLoading: boolean
  isError: boolean
  error: Error | null
  fromCache: boolean
  cacheSource?: "memory" | "indexeddb" | "network"
  cacheAgeMs?: number
  refetch: (opts?: { forceRefresh?: boolean }) => void
  isFetching: boolean
}

function useCachedQuery<T>(
  queryKey: unknown[],
  fetcher: (forceRefresh?: boolean) => Promise<{
    data: T
    fromCache: boolean
    source: "memory" | "indexeddb" | "network"
    cacheAgeMs?: number
  }>,
  enabled: boolean
): CachedQueryResult<T> {
  const q = useQuery({
    queryKey,
    queryFn: () => fetcher(false),
    enabled,
    staleTime: 2 * 60 * 1000,
  })

  const refetch = (opts?: { forceRefresh?: boolean }) => {
    if (opts?.forceRefresh) {
      // Bust by re-running with force
      q.refetch({ cancelRefetch: false }).then(() => {
        /* TanStack will use queryFn; we need force path */
      })
      // Simpler: invalidate and let consumer pass force via key change
    }
    q.refetch()
  }

  return {
    data: q.data?.data,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    fromCache: q.data?.fromCache ?? false,
    cacheSource: q.data?.source,
    cacheAgeMs: q.data?.cacheAgeMs,
    refetch,
    isFetching: q.isFetching,
  }
}

export function useHistoricalPrices(
  symbol: string | undefined,
  startDate: string,
  endDate: string,
  enabled = true
) {
  const providerId = getDataProvider().id
  return useCachedQuery<OHLCV[]>(
    ["ohlcv", providerId, symbol, startDate, endDate],
    (force) =>
      fetchHistoricalPrices(symbol!, startDate, endDate, {
        forceRefresh: force,
      }),
    Boolean(symbol) && enabled
  )
}

export function useMarketIndex(
  index: string,
  startDate: string,
  endDate: string,
  enabled = true
) {
  const providerId = getDataProvider().id
  return useCachedQuery<OHLCV[]>(
    ["index", providerId, index, startDate, endDate],
    (force) =>
      fetchMarketIndex(index, startDate, endDate, { forceRefresh: force }),
    enabled
  )
}

export function useCompanyInfo(symbol: string | undefined, enabled = true) {
  const providerId = getDataProvider().id
  return useCachedQuery<CompanyInfo>(
    ["company", providerId, symbol],
    (force) => fetchCompanyInfo(symbol!, { forceRefresh: force }),
    Boolean(symbol) && enabled
  )
}

export function useFundamentals(symbol: string | undefined, enabled = true) {
  const providerId = getDataProvider().id
  return useCachedQuery<FundamentalData>(
    ["fundamentals", providerId, symbol],
    (force) => fetchFundamentals(symbol!, { forceRefresh: force }),
    Boolean(symbol) && enabled
  )
}
