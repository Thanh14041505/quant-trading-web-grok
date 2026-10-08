import type { OHLCV } from "@/models/market"
import { sma, lastNonNull, slope } from "./math"

export type VsaPattern =
  | "NONE"
  | "STOPPING_VOLUME"
  | "NO_DEMAND"
  | "NO_SUPPLY"
  | "CLIMAX_UP"
  | "CLIMAX_DOWN"
  | "ABSORPTION"

export interface VolumeFeatures {
  volume: number
  rvol20: number | null
  rvol60: number | null
  obv: number | null
  obvSlope: number | null
  cmf20: number | null
  /** Close Location Value average */
  clv20: number | null
  upVolumeRatio: number | null
  vsaPattern: VsaPattern
}

function obvSeries(bars: OHLCV[]): number[] {
  const out: number[] = new Array(bars.length).fill(0)
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].close > bars[i - 1].close) out[i] = out[i - 1] + bars[i].volume
    else if (bars[i].close < bars[i - 1].close)
      out[i] = out[i - 1] - bars[i].volume
    else out[i] = out[i - 1]
  }
  return out
}

function cmfSeries(bars: OHLCV[], period = 20): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null)
  for (let i = period - 1; i < bars.length; i++) {
    let mfv = 0
    let vol = 0
    for (let j = i - period + 1; j <= i; j++) {
      const h = bars[j].high
      const l = bars[j].low
      const c = bars[j].close
      const range = h - l
      const clv = range === 0 ? 0 : (2 * c - h - l) / range
      mfv += clv * bars[j].volume
      vol += bars[j].volume
    }
    out[i] = vol === 0 ? 0 : mfv / vol
  }
  return out
}

function detectVsa(bars: OHLCV[], rvol20: number | null): VsaPattern {
  if (bars.length < 5 || rvol20 == null) return "NONE"
  const i = bars.length - 1
  const b = bars[i]
  const range = b.high - b.low
  const body = Math.abs(b.close - b.open)
  const prevRanges = []
  for (let j = i - 4; j < i; j++) prevRanges.push(bars[j].high - bars[j].low)
  const avgRange = prevRanges.reduce((a, c) => a + c, 0) / prevRanges.length || 1

  // High volume + narrow spread near lows → stopping volume
  if (rvol20 > 1.8 && range < avgRange * 0.7 && b.close > b.low + range * 0.5) {
    return "STOPPING_VOLUME"
  }
  // High volume up-bar with close near low → climax up / distribution hint
  if (rvol20 > 2 && b.close > bars[i - 1].close && b.close < b.low + range * 0.35) {
    return "CLIMAX_UP"
  }
  // High volume down-bar with close near high → climax down / capitulation
  if (rvol20 > 2 && b.close < bars[i - 1].close && b.close > b.high - range * 0.35) {
    return "CLIMAX_DOWN"
  }
  // Low volume up-bar (no demand)
  if (rvol20 < 0.6 && b.close > b.open && range < avgRange * 0.8) {
    return "NO_DEMAND"
  }
  // Low volume down-bar (no supply)
  if (rvol20 < 0.6 && b.close < b.open && range < avgRange * 0.8) {
    return "NO_SUPPLY"
  }
  // Absorption: high volume, small body
  if (rvol20 > 1.5 && body < range * 0.3) {
    return "ABSORPTION"
  }
  return "NONE"
}

export function computeVolumeFeatures(bars: OHLCV[]): VolumeFeatures {
  const vols = bars.map((b) => b.volume)
  const vSma20 = sma(vols, 20)
  const vSma60 = sma(vols, 60)
  const last = bars.length - 1
  const vol = bars[last]?.volume ?? 0

  const rvol20 =
    vSma20[last] != null && (vSma20[last] as number) > 0
      ? vol / (vSma20[last] as number)
      : null
  const rvol60 =
    vSma60[last] != null && (vSma60[last] as number) > 0
      ? vol / (vSma60[last] as number)
      : null

  const obv = obvSeries(bars)
  const obvAsNullable = obv.map((v) => v as number | null)
  const obvSl = slope(obvAsNullable, 10)

  const cmf = cmfSeries(bars, 20)

  // CLV20
  let clvSum = 0
  let clvN = 0
  for (let i = Math.max(0, last - 19); i <= last; i++) {
    const h = bars[i].high
    const l = bars[i].low
    const c = bars[i].close
    const range = h - l
    clvSum += range === 0 ? 0 : (2 * c - h - l) / range
    clvN++
  }

  // Up volume ratio (20)
  let upVol = 0
  let totalVol = 0
  for (let i = Math.max(1, last - 19); i <= last; i++) {
    totalVol += bars[i].volume
    if (bars[i].close >= bars[i - 1].close) upVol += bars[i].volume
  }

  return {
    volume: vol,
    rvol20,
    rvol60,
    obv: lastNonNull(obvAsNullable),
    obvSlope: lastNonNull(obvSl),
    cmf20: lastNonNull(cmf),
    clv20: clvN > 0 ? clvSum / clvN : null,
    upVolumeRatio: totalVol > 0 ? upVol / totalVol : null,
    vsaPattern: detectVsa(bars, rvol20),
  }
}
