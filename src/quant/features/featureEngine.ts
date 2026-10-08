import type { OHLCV } from "@/models/market"
import { computeTrendFeatures } from "@/indicators/trend"
import { computeMomentumFeatures } from "@/indicators/momentum"
import { computeVolumeFeatures } from "@/indicators/volume"
import { computeStructureFeatures } from "@/indicators/structure"
import { computeRelativeStrength } from "@/indicators/relativeStrength"
import { computeIchimokuFeatures } from "@/indicators/ichimoku"
import { computeDivergenceFeatures } from "@/indicators/divergence"
import { computeVolumeProfile } from "@/indicators/volumeProfile"
import type { FeatureSnapshot, FeatureEngineOptions } from "./types"

const DEFAULT_MIN_BARS = 30

/**
 * Compute a full feature snapshot for a symbol from OHLCV bars.
 * Pure function – no I/O, no React, no look-ahead.
 */
export function computeFeatures(
  bars: OHLCV[],
  options: FeatureEngineOptions = {}
): FeatureSnapshot | null {
  const minBars = options.minBars ?? DEFAULT_MIN_BARS
  if (!bars || bars.length < minBars) return null

  // Ensure sorted ascending
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date))
  const last = sorted[sorted.length - 1]

  const emptyRS = {
    rs20: null,
    rs60: null,
    rs120: null,
    betaUp20: null,
    betaDown20: null,
    corr20: null,
    corr60: null,
    beta20: null,
    beta60: null,
  }

  return {
    symbol: last.symbol,
    date: last.date,
    close: last.close,
    trend: computeTrendFeatures(sorted),
    momentum: computeMomentumFeatures(sorted),
    volume: computeVolumeFeatures(sorted),
    structure: computeStructureFeatures(sorted),
    relativeStrength: options.indexBars
      ? computeRelativeStrength(sorted, options.indexBars)
      : emptyRS,
    ichimoku: computeIchimokuFeatures(sorted),
    divergence: computeDivergenceFeatures(sorted),
    volumeProfile: computeVolumeProfile(sorted),
    barCount: sorted.length,
  }
}

/**
 * Batch compute features for many symbols.
 * Isolates errors per symbol.
 */
export function computeFeaturesBatch(
  seriesMap: Map<string, OHLCV[]>,
  options: FeatureEngineOptions = {}
): Map<string, FeatureSnapshot | { error: string }> {
  const out = new Map<string, FeatureSnapshot | { error: string }>()
  for (const [symbol, bars] of seriesMap) {
    try {
      const snap = computeFeatures(bars, options)
      if (snap) out.set(symbol, snap)
      else out.set(symbol, { error: "INSUFFICIENT_HISTORY" })
    } catch (e) {
      out.set(symbol, {
        error: e instanceof Error ? e.message : "FEATURE_ERROR",
      })
    }
  }
  return out
}
