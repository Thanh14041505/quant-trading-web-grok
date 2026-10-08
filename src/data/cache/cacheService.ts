import type { CacheEntry, CacheKind, CacheMeta } from "./types"
import { CACHE_TTL, buildCacheKey } from "./types"
import { memoryCache } from "./memoryCache"
import { indexedDbCache } from "./indexedDbCache"

export interface GetOrFetchOptions<T> {
  providerId: string
  kind: CacheKind
  symbol?: string
  startDate?: string
  endDate?: string
  extra?: string
  /** Override default TTL */
  ttlMs?: number
  /** Force network fetch, still write cache */
  forceRefresh?: boolean
  /** Skip writing to IndexedDB (memory only) */
  memoryOnly?: boolean
  fetchFn: () => Promise<T>
}

export interface CacheLookupResult<T> {
  data: T
  fromCache: boolean
  cacheAgeMs?: number
  source: "memory" | "indexeddb" | "network"
}

/**
 * Unified cache: Memory → IndexedDB → network.
 * Writes back to both layers on network fetch.
 */
export async function getOrFetch<T>(
  opts: GetOrFetchOptions<T>
): Promise<CacheLookupResult<T>> {
  const key = buildCacheKey({
    providerId: opts.providerId,
    kind: opts.kind,
    symbol: opts.symbol,
    startDate: opts.startDate,
    endDate: opts.endDate,
    extra: opts.extra,
  })

  const ttl = opts.ttlMs ?? CACHE_TTL[opts.kind] ?? 60 * 60 * 1000

  if (!opts.forceRefresh) {
    // 1. Memory
    const mem = memoryCache.get<T>(key)
    if (mem) {
      return {
        data: mem.data,
        fromCache: true,
        cacheAgeMs: Date.now() - mem.meta.createdAt,
        source: "memory",
      }
    }

    // 2. IndexedDB
    const idb = await indexedDbCache.get<T>(key)
    if (idb) {
      // Promote to memory
      memoryCache.set(idb)
      return {
        data: idb.data,
        fromCache: true,
        cacheAgeMs: Date.now() - idb.meta.createdAt,
        source: "indexeddb",
      }
    }
  }

  // 3. Network
  const data = await opts.fetchFn()
  const now = Date.now()
  const entry: CacheEntry<T> = {
    meta: {
      key,
      providerId: opts.providerId,
      symbol: (opts.symbol ?? "").toUpperCase(),
      kind: opts.kind,
      startDate: opts.startDate,
      endDate: opts.endDate,
      createdAt: now,
      expiresAt: now + ttl,
    },
    data,
  }

  memoryCache.set(entry)
  if (!opts.memoryOnly) {
    void indexedDbCache.set(entry)
  }

  return {
    data,
    fromCache: false,
    source: "network",
  }
}

/** Read-only cache lookup (no network) */
export async function peekCache<T>(key: string): Promise<CacheEntry<T> | null> {
  const mem = memoryCache.get<T>(key)
  if (mem) return mem
  return indexedDbCache.get<T>(key)
}

export async function invalidate(key: string): Promise<void> {
  memoryCache.delete(key)
  await indexedDbCache.delete(key)
}

export async function clearCache(kind?: CacheKind): Promise<void> {
  memoryCache.clear(kind)
  await indexedDbCache.clear(kind)
}

export async function clearAllData(): Promise<void> {
  memoryCache.clear()
  await indexedDbCache.clear()
  // Also purge expired just in case
  await indexedDbCache.purgeExpired()
}

export async function getCacheStats() {
  const mem = memoryCache.stats()
  const idb = await indexedDbCache.stats()
  return {
    memory: mem,
    indexedDb: idb,
  }
}

export async function listCacheMeta(): Promise<CacheMeta[]> {
  return indexedDbCache.listMeta()
}

export { buildCacheKey, CACHE_TTL }
export type { CacheKind, CacheMeta, CacheEntry }
