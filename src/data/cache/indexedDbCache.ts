import type { CacheEntry, CacheKind, CacheMeta } from "./types"

const DB_NAME = "vnquant_cache"
const DB_VERSION = 1
const STORE = "entries"

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "meta.key" })
        os.createIndex("byKind", "meta.kind", { unique: false })
        os.createIndex("byProvider", "meta.providerId", { unique: false })
        os.createIndex("byExpires", "meta.expiresAt", { unique: false })
      }
    }
  })
  return dbPromise
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const indexedDbCache = {
  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const db = await openDb()
      const tx = db.transaction(STORE, "readonly")
      const store = tx.objectStore(STORE)
      const entry = (await idbReq(store.get(key))) as CacheEntry<T> | undefined
      if (!entry) return null
      if (Date.now() > entry.meta.expiresAt) {
        // Lazy delete
        void this.delete(key)
        return null
      }
      return entry
    } catch {
      return null
    }
  },

  async set<T>(entry: CacheEntry<T>): Promise<void> {
    try {
      const db = await openDb()
      const tx = db.transaction(STORE, "readwrite")
      const store = tx.objectStore(STORE)
      // Approximate size
      const sizeBytes = new Blob([JSON.stringify(entry.data)]).size
      const withSize: CacheEntry<T> = {
        ...entry,
        meta: { ...entry.meta, sizeBytes },
      }
      await idbReq(store.put(withSize))
    } catch (e) {
      console.warn("[IDB] set failed", e)
    }
  },

  async delete(key: string): Promise<void> {
    try {
      const db = await openDb()
      const tx = db.transaction(STORE, "readwrite")
      await idbReq(tx.objectStore(STORE).delete(key))
    } catch {
      /* ignore */
    }
  },

  async clear(kind?: CacheKind): Promise<void> {
    try {
      const db = await openDb()
      const tx = db.transaction(STORE, "readwrite")
      const store = tx.objectStore(STORE)
      if (!kind) {
        await idbReq(store.clear())
        return
      }
      const idx = store.index("byKind")
      const keys = (await idbReq(idx.getAllKeys(kind))) as IDBValidKey[]
      for (const k of keys) {
        await idbReq(store.delete(k))
      }
    } catch (e) {
      console.warn("[IDB] clear failed", e)
    }
  },

  async listMeta(): Promise<CacheMeta[]> {
    try {
      const db = await openDb()
      const tx = db.transaction(STORE, "readonly")
      const all = (await idbReq(tx.objectStore(STORE).getAll())) as CacheEntry[]
      return all.map((e) => e.meta)
    } catch {
      return []
    }
  },

  async stats(): Promise<{
    count: number
    totalBytes: number
    byKind: Record<string, number>
  }> {
    const metas = await this.listMeta()
    const byKind: Record<string, number> = {}
    let totalBytes = 0
    for (const m of metas) {
      byKind[m.kind] = (byKind[m.kind] ?? 0) + 1
      totalBytes += m.sizeBytes ?? 0
    }
    return { count: metas.length, totalBytes, byKind }
  },

  /** Remove expired entries */
  async purgeExpired(): Promise<number> {
    try {
      const db = await openDb()
      const tx = db.transaction(STORE, "readwrite")
      const store = tx.objectStore(STORE)
      const all = (await idbReq(store.getAll())) as CacheEntry[]
      const now = Date.now()
      let removed = 0
      for (const e of all) {
        if (e.meta.expiresAt < now) {
          await idbReq(store.delete(e.meta.key))
          removed++
        }
      }
      return removed
    } catch {
      return 0
    }
  },
}
