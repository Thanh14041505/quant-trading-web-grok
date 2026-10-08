import type { CacheEntry, CacheKind } from "./types"

/**
 * In-memory LRU-ish cache.
 * Max entries controlled; oldest by createdAt evicted when full.
 */
const MAX_ENTRIES = 200

const store = new Map<string, CacheEntry>()

export const memoryCache = {
  get<T>(key: string): CacheEntry<T> | null {
    const entry = store.get(key) as CacheEntry<T> | undefined
    if (!entry) return null
    if (Date.now() > entry.meta.expiresAt) {
      store.delete(key)
      return null
    }
    return entry
  },

  set<T>(entry: CacheEntry<T>): void {
    if (store.size >= MAX_ENTRIES) {
      // Evict oldest
      let oldestKey: string | null = null
      let oldestTs = Infinity
      for (const [k, v] of store) {
        if (v.meta.createdAt < oldestTs) {
          oldestTs = v.meta.createdAt
          oldestKey = k
        }
      }
      if (oldestKey) store.delete(oldestKey)
    }
    store.set(entry.meta.key, entry as CacheEntry)
  },

  delete(key: string): void {
    store.delete(key)
  },

  clear(kind?: CacheKind): void {
    if (!kind) {
      store.clear()
      return
    }
    for (const [k, v] of store) {
      if (v.meta.kind === kind) store.delete(k)
    }
  },

  keys(): string[] {
    return Array.from(store.keys())
  },

  stats() {
    let valid = 0
    let expired = 0
    const now = Date.now()
    for (const v of store.values()) {
      if (now > v.meta.expiresAt) expired++
      else valid++
    }
    return { total: store.size, valid, expired }
  },
}
