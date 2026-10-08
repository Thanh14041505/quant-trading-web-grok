/** Cache entry metadata */
export interface CacheMeta {
  key: string
  providerId: string
  symbol: string
  kind: CacheKind
  startDate?: string
  endDate?: string
  createdAt: number // epoch ms
  expiresAt: number // epoch ms
  sizeBytes?: number
}

export type CacheKind =
  | "ohlcv"
  | "index"
  | "company"
  | "fundamentals"
  | "scanner"
  | "backtest"
  | "settings"

export interface CacheEntry<T = unknown> {
  meta: CacheMeta
  data: T
}

/** Default TTLs (ms) */
export const CACHE_TTL = {
  ohlcv: 4 * 60 * 60 * 1000, // 4 hours
  index: 1 * 60 * 60 * 1000, // 1 hour
  company: 24 * 60 * 60 * 1000, // 1 day
  fundamentals: 12 * 60 * 60 * 1000, // 12 hours
  scanner: 30 * 60 * 1000, // 30 min
  backtest: 7 * 24 * 60 * 60 * 1000, // 7 days
  settings: 365 * 24 * 60 * 60 * 1000,
} as const

export function buildCacheKey(parts: {
  providerId: string
  kind: CacheKind
  symbol?: string
  startDate?: string
  endDate?: string
  extra?: string
}): string {
  const segs = [
    parts.providerId,
    parts.kind,
    parts.symbol?.toUpperCase() ?? "",
    parts.startDate ?? "",
    parts.endDate ?? "",
    parts.extra ?? "",
  ]
  return segs.filter(Boolean).join(":")
}
