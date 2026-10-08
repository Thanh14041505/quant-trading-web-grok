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
  const seriesMap = new Map<string, OHLCV[]>()
  const errors: { symbol: string; error: string }[] = []
  let cached = 0
  let fresh = 0
  let failed = 0

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i]
    let ok = false
    let lastErr = ""
    // Retry up to 3 times — Vercel / upstream often flakes under load
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
    // Small gap to avoid slamming Vercel Python concurrency
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

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i]
    try {
      const [priceRes, fundRes, companyRes] = await Promise.all([
        fetchHistoricalPrices(sym, start, end),
        fetchFundamentals(sym),
        fetchCompanyInfo(sym),
      ])
      if (priceRes.data.length >= 30) {
        seriesMap.set(sym, priceRes.data)
        fundMap.set(
          sym,
          toHoldFundamentals(
            sym,
            fundRes.data as unknown as Record<string, unknown>,
            companyRes.data.sector ?? companyRes.data.industry
          )
        )
        if (priceRes.fromCache) cached++
        else fresh++
      } else {
        failed++
        errors.push({ symbol: sym, error: "INSUFFICIENT_HISTORY" })
      }
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
