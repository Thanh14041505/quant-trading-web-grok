import type { OHLCV } from "@/models/market"
import type { TradingSignal } from "@/models/signal"
import type { HoldSignal, HoldFundamentals } from "@/models/hold"
import {
  fetchHistoricalPrices,
  fetchMarketIndex,
  fetchFundamentals,
  fetchCompanyInfo,
} from "@/data/marketDataService"
import { getOrFetch, clearCache, buildCacheKey } from "@/data/cache"
import { getDataProvider } from "@/data/providers"
import { classifyRegime, type RegimeResult } from "@/quant/regime"
import {
  runTPlusScan,
  runHoldScan,
  toHoldFundamentals,
} from "@/quant/strategies"
import { resolveUniverse, type UniverseConfig } from "@/config/universe"
import {
  loadSeriesViaScanApi,
  shouldUseScanApi,
} from "@/data/scanBatch"

export type ScannerKind = "tplus" | "hold"

export interface ScanProgress {
  phase: "regime" | "loading" | "computing" | "done" | "error"
  done: number
  total: number
  cached: number
  fresh: number
  failed: number
  message?: string
}

export interface TPlusScanResult {
  kind: "tplus"
  asOf: string
  regime: RegimeResult | null
  signals: TradingSignal[]
  errors: { symbol: string; error: string }[]
  universeSize: number
  durationMs: number
  fromCache: boolean
}

export interface HoldScanResult {
  kind: "hold"
  asOf: string
  regime: RegimeResult | null
  signals: HoldSignal[]
  errors: { symbol: string; error: string }[]
  universeSize: number
  durationMs: number
  fromCache: boolean
}

export type ScanResult = TPlusScanResult | HoldScanResult

const LOOKBACK_TPLUS = 300
const LOOKBACK_HOLD = 400

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function scannerCacheKey(kind: ScannerKind): string {
  return buildCacheKey({
    providerId: getDataProvider().id,
    kind: "scanner",
    extra: kind,
  })
}

/** Load last cached scan without network */
export async function loadCachedScan(
  kind: ScannerKind
): Promise<ScanResult | null> {
  const key = scannerCacheKey(kind)
  const { peekCache } = await import("@/data/cache")
  const entry = await peekCache<ScanResult>(key)
  if (!entry) return null
  return { ...entry.data, fromCache: true }
}

export async function clearScannerCache(kind?: ScannerKind): Promise<void> {
  if (kind) {
    const { invalidate } = await import("@/data/cache")
    await invalidate(scannerCacheKey(kind))
  } else {
    await clearCache("scanner")
  }
}

async function loadSeriesMap(
  symbols: string[],
  start: string,
  end: string,
  onProgress: (p: Partial<ScanProgress>) => void
): Promise<{
  seriesMap: Map<string, OHLCV[]>
  cached: number
  fresh: number
  failed: number
  errors: { symbol: string; error: string }[]
}> {
  // vnstock on Vercel: batch via POST /api/scan (one process, delay 0.3, chunks)
  if (shouldUseScanApi()) {
    // Do NOT close over destructured const before assignment (TDZ crash)
    const loaded = await loadSeriesViaScanApi(
      symbols,
      start,
      end,
      (done, total, message) =>
        onProgress({
          phase: "loading",
          done,
          total,
          cached: 0,
          fresh: 0,
          failed: 0,
          message,
        })
    )
    const seriesMap = loaded.seriesMap
    for (const [sym, bars] of [...seriesMap.entries()]) {
      if (bars.length < 30) {
        seriesMap.delete(sym)
      }
    }
    return {
      seriesMap,
      cached: 0,
      fresh: loaded.fresh,
      failed: loaded.failed,
      errors: loaded.errors,
    }
  }

  const seriesMap = new Map<string, OHLCV[]>()
  const errors: { symbol: string; error: string }[] = []
  let cached = 0
  let fresh = 0
  let failed = 0

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i]!
    let ok = false
    let lastErr = ""
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 800 * attempt))
        }
        const res = await fetchHistoricalPrices(sym, start, end)
        if (res.data.length >= 30) {
          seriesMap.set(sym, res.data)
          if (res.fromCache) cached++
          else fresh++
          ok = true
          break
        }
        lastErr = "INSUFFICIENT_HISTORY"
        break
      } catch (e) {
        lastErr = e instanceof Error ? e.message : "DATA_ERROR"
      }
    }
    if (!ok) {
      failed++
      errors.push({ symbol: sym, error: lastErr })
    }
    await new Promise((r) => setTimeout(r, 150))
    onProgress({
      phase: "loading",
      done: i + 1,
      total: symbols.length,
      cached,
      fresh,
      failed,
    })
  }

  return { seriesMap, cached, fresh, failed, errors }
}

/**
 * Run T+ scanner with progress + result cache.
 */
export async function runTPlusScanner(
  options: {
    universe?: UniverseConfig
    forceRefresh?: boolean
    onProgress?: (p: ScanProgress) => void
  } = {}
): Promise<TPlusScanResult> {
  const t0 = performance.now()
  const progress = (p: Partial<ScanProgress> & { phase: ScanProgress["phase"] }) => {
    options.onProgress?.({
      phase: p.phase,
      done: p.done ?? 0,
      total: p.total ?? 0,
      cached: p.cached ?? 0,
      fresh: p.fresh ?? 0,
      failed: p.failed ?? 0,
      message: p.message,
    })
  }

  if (!options.forceRefresh) {
    const cached = await loadCachedScan("tplus")
    if (cached && cached.kind === "tplus") {
      progress({
        phase: "done",
        done: cached.universeSize,
        total: cached.universeSize,
        message: "Loaded from cache",
      })
      return cached
    }
  }

  const symbols = resolveUniverse(options.universe)
  const end = daysAgo(0)
  const start = daysAgo(LOOKBACK_TPLUS)

  progress({ phase: "regime", done: 0, total: symbols.length, message: "Loading VNINDEX…" })
  const idx = await fetchMarketIndex("VNINDEX", start, end)
  const regime =
    idx.data.length >= 60 ? classifyRegime(idx.data) : null

  progress({ phase: "loading", done: 0, total: symbols.length })
  const { seriesMap, cached, fresh, failed, errors } = await loadSeriesMap(
    symbols,
    start,
    end,
    (p) => progress({ phase: "loading", ...p })
  )

  progress({
    phase: "computing",
    done: seriesMap.size,
    total: symbols.length,
    cached,
    fresh,
    failed,
    message: "Running T+ engine…",
  })

  const { signals, errors: engErrs } = runTPlusScan(seriesMap, {
    regime,
    indexBars: idx.data,
  })

  const result: TPlusScanResult = {
    kind: "tplus",
    asOf: new Date().toISOString(),
    regime,
    signals,
    errors: [...errors, ...engErrs],
    universeSize: symbols.length,
    durationMs: Math.round(performance.now() - t0),
    fromCache: false,
  }

  // Persist scan result
  await getOrFetch({
    providerId: getDataProvider().id,
    kind: "scanner",
    extra: "tplus",
    forceRefresh: true,
    ttlMs: 30 * 60 * 1000,
    fetchFn: async () => result,
  })

  progress({
    phase: "done",
    done: symbols.length,
    total: symbols.length,
    cached,
    fresh,
    failed: failed + engErrs.length,
  })

  return result
}

/**
 * Run Hold scanner with progress + result cache.
 */
export async function runHoldScanner(
  options: {
    universe?: UniverseConfig
    forceRefresh?: boolean
    onProgress?: (p: ScanProgress) => void
  } = {}
): Promise<HoldScanResult> {
  const t0 = performance.now()
  const progress = (p: Partial<ScanProgress> & { phase: ScanProgress["phase"] }) => {
    options.onProgress?.({
      phase: p.phase,
      done: p.done ?? 0,
      total: p.total ?? 0,
      cached: p.cached ?? 0,
      fresh: p.fresh ?? 0,
      failed: p.failed ?? 0,
      message: p.message,
    })
  }

  if (!options.forceRefresh) {
    const cached = await loadCachedScan("hold")
    if (cached && cached.kind === "hold") {
      progress({
        phase: "done",
        done: cached.universeSize,
        total: cached.universeSize,
        message: "Loaded from cache",
      })
      return cached
    }
  }

  const symbols = resolveUniverse(options.universe)
  const end = daysAgo(0)
  const start = daysAgo(LOOKBACK_HOLD)

  progress({ phase: "regime", done: 0, total: symbols.length, message: "Loading VNINDEX…" })
  const idx = await fetchMarketIndex("VNINDEX", start, end)
  const regime =
    idx.data.length >= 60 ? classifyRegime(idx.data) : null

  const seriesMap = new Map<string, OHLCV[]>()
  const fundMap = new Map<string, HoldFundamentals>()
  const errors: { symbol: string; error: string }[] = []
  let cached = 0
  let fresh = 0
  let failed = 0

  // Prices via /api/scan chunks when vnstock; else sequential single-symbol
  if (shouldUseScanApi()) {
    const loaded = await loadSeriesViaScanApi(
      symbols,
      start,
      end,
      (done, total, message) =>
        progress({
          phase: "loading",
          done,
          total,
          cached: 0,
          fresh,
          failed,
          message: message ? `Prices: ${message}` : undefined,
        })
    )
    for (const [sym, bars] of loaded.seriesMap) {
      if (bars.length >= 30) seriesMap.set(sym, bars)
    }
    fresh = loaded.fresh
    failed = loaded.failed
    errors.push(...loaded.errors)
  }

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i]!
    // Skip fund fetch if no price series (unless not using scan api path for prices)
    if (shouldUseScanApi() && !seriesMap.has(sym)) {
      progress({
        phase: "loading",
        done: i + 1,
        total: symbols.length,
        cached,
        fresh,
        failed,
        message: `Skip fund ${sym}`,
      })
      continue
    }
    try {
      if (!shouldUseScanApi()) {
        const priceRes = await fetchHistoricalPrices(sym, start, end)
        if (priceRes.data.length >= 30) {
          seriesMap.set(sym, priceRes.data)
          if (priceRes.fromCache) cached++
          else fresh++
        } else {
          failed++
          errors.push({ symbol: sym, error: "INSUFFICIENT_HISTORY" })
          progress({
            phase: "loading",
            done: i + 1,
            total: symbols.length,
            cached,
            fresh,
            failed,
          })
          continue
        }
      }
      const [fundRes, companyRes] = await Promise.all([
        fetchFundamentals(sym),
        fetchCompanyInfo(sym),
      ])
      fundMap.set(
        sym,
        toHoldFundamentals(
          sym,
          fundRes.data as unknown as Record<string, unknown>,
          companyRes.data.sector ?? companyRes.data.industry
        )
      )
    } catch (e) {
      failed++
      errors.push({
        symbol: sym,
        error: e instanceof Error ? e.message : "DATA_ERROR",
      })
    }
    progress({
      phase: "loading",
      done: i + 1,
      total: symbols.length,
      cached,
      fresh,
      failed,
    })
  }

  progress({
    phase: "computing",
    done: seriesMap.size,
    total: symbols.length,
    cached,
    fresh,
    failed,
    message: "Running Hold engine…",
  })

  const { signals, errors: engErrs } = runHoldScan(seriesMap, fundMap, {
    regime,
    indexBars: idx.data,
  })

  const result: HoldScanResult = {
    kind: "hold",
    asOf: new Date().toISOString(),
    regime,
    signals,
    errors: [...errors, ...engErrs],
    universeSize: symbols.length,
    durationMs: Math.round(performance.now() - t0),
    fromCache: false,
  }

  await getOrFetch({
    providerId: getDataProvider().id,
    kind: "scanner",
    extra: "hold",
    forceRefresh: true,
    ttlMs: 30 * 60 * 1000,
    fetchFn: async () => result,
  })

  progress({
    phase: "done",
    done: symbols.length,
    total: symbols.length,
    cached,
    fresh,
    failed: failed + engErrs.length,
  })

  return result
}
