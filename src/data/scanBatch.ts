/**
 * Client helper: call POST /api/scan in chunks (Streamlit-style sequential server-side).
 */
import type { OHLCV } from "@/models/market"
import { adaptBars, type RawBar } from "@/data/adapters/ohlcvAdapter"
import { validateOHLCV } from "@/data/validation/ohlcv"
import { getApiKey, getBaseUrl, getDataProvider } from "@/data/providers"
import { getOrFetch } from "@/data/cache"


/** Server hard-cap in api/scan.py */
export const SCAN_CHUNK_SIZE = 5
export const SCAN_DELAY_SEC = 0.2

export interface ScanChunkResult {
  seriesMap: Map<string, OHLCV[]>
  errors: { symbol: string; error: string }[]
  meta?: {
    ok: number
    failed: number
    duration_sec: number
    key_status: string
  }
}

function apiBase(): string {
  return (getBaseUrl() ?? "").replace(/\/$/, "")
}

/**
 * One POST /api/scan for up to SCAN_CHUNK_SIZE symbols.
 */
export async function fetchScanChunk(
  symbols: string[],
  start: string,
  end: string,
  options?: { delay?: number; apiKey?: string }
): Promise<ScanChunkResult> {
  const seriesMap = new Map<string, OHLCV[]>()
  const errors: { symbol: string; error: string }[] = []
  if (!symbols.length) return { seriesMap, errors }

  const apiKey = options?.apiKey ?? getApiKey() ?? undefined
  const delay = options?.delay ?? SCAN_DELAY_SEC
  const url = `${apiBase()}/api/scan`

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  }
  if (apiKey) headers["X-VNSTOCK-KEY"] = apiKey

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      symbols,
      start,
      end,
      delay,
      api_key: apiKey,
    }),
  })

  const text = await res.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Non-JSON from /api/scan: ${text.slice(0, 200)}`)
  }

  if (!res.ok) {
    const err = (json as { error?: string })?.error ?? res.statusText
    throw new Error(err)
  }

  const body = json as {
    data?: Record<string, unknown[]>
    errors?: { symbol: string; error: string }[]
    meta?: ScanChunkResult["meta"]
  }

  const data = body.data ?? {}
  for (const [sym, raw] of Object.entries(data)) {
    if (!Array.isArray(raw)) continue
    const adapted = adaptBars(raw as RawBar[], sym)
    const { valid, cleaned } = validateOHLCV(adapted, { minBars: 1 })
    if (valid && cleaned.length >= 30) {
      seriesMap.set(sym.toUpperCase(), cleaned)
    } else if (valid && cleaned.length > 0) {
      seriesMap.set(sym.toUpperCase(), cleaned)
    } else {
      errors.push({ symbol: sym, error: "INVALID_OR_SHORT" })
    }
  }

  for (const e of body.errors ?? []) {
    errors.push(e)
  }

  return { seriesMap, errors, meta: body.meta }
}

/**
 * Load many symbols via sequential chunks of /api/scan.
 * Also warms per-symbol OHLCV cache for Stock page reuse.
 */
export async function loadSeriesViaScanApi(
  symbols: string[],
  start: string,
  end: string,
  onProgress?: (done: number, total: number, message?: string) => void
): Promise<{
  seriesMap: Map<string, OHLCV[]>
  errors: { symbol: string; error: string }[]
  fresh: number
  failed: number
}> {
  const seriesMap = new Map<string, OHLCV[]>()
  const errors: { symbol: string; error: string }[] = []
  let fresh = 0
  let failed = 0
  const total = symbols.length
  const providerId = getDataProvider().id

  for (let offset = 0; offset < symbols.length; offset += SCAN_CHUNK_SIZE) {
    const chunk = symbols.slice(offset, offset + SCAN_CHUNK_SIZE)
    const chunkNo = Math.floor(offset / SCAN_CHUNK_SIZE) + 1
    const chunkTotal = Math.ceil(symbols.length / SCAN_CHUNK_SIZE)
    onProgress?.(
      offset,
      total,
      `Chunk ${chunkNo}/${chunkTotal} (${chunk.join(", ")})`
    )

    try {
      const result = await fetchScanChunk(chunk, start, end)
      for (const [sym, bars] of result.seriesMap) {
        seriesMap.set(sym, bars)
        if (bars.length >= 30) fresh++
        // Warm individual OHLCV cache
        try {
          await getOrFetch({
            providerId,
            kind: "ohlcv",
            symbol: sym,
            startDate: start,
            endDate: end,
            forceRefresh: true,
            ttlMs: 30 * 60 * 1000,
            fetchFn: async () => bars,
          })
        } catch {
          /* ignore cache warm failures */
        }
      }
      for (const e of result.errors) {
        if (!seriesMap.has(e.symbol.toUpperCase())) {
          errors.push(e)
          failed++
        }
      }
    } catch (e) {
      // Whole chunk failed — mark all symbols
      const msg = e instanceof Error ? e.message : "CHUNK_ERROR"
      for (const sym of chunk) {
        errors.push({ symbol: sym, error: msg })
        failed++
      }
    }

    onProgress?.(
      Math.min(offset + chunk.length, total),
      total,
      `Done chunk ${chunkNo}/${chunkTotal}`
    )
  }

  return { seriesMap, errors, fresh, failed }
}

/** True when active provider should use /api/scan batches */
export function shouldUseScanApi(): boolean {
  const id = getDataProvider().id
  return id === "vnstock"
}
