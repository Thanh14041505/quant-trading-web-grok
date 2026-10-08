import type { OHLCV } from "@/models/market"

export interface VolumeProfileFeatures {
  /** Point of Control – price level with highest volume */
  poc: number | null
  /** Value Area High (~70% volume) */
  vah: number | null
  /** Value Area Low */
  val: number | null
  /** High Volume Node levels (top 3) */
  hvn: number[]
  /** Low Volume Node levels (bottom gaps – approximate) */
  lvn: number[]
  /** NOTE: approximated from daily OHLCV, not tick/intraday */
  approximate: true
}

/**
 * Approximate volume profile from daily bars.
 * Distributes each bar's volume uniformly across its [low, high] range
 * into discrete price bins. Not as accurate as tick data.
 */
export function computeVolumeProfile(
  bars: OHLCV[],
  bins = 40
): VolumeProfileFeatures {
  if (bars.length < 10) {
    return { poc: null, vah: null, val: null, hvn: [], lvn: [], approximate: true }
  }

  // Use last 60 sessions by default for profile context
  const window = bars.slice(-Math.min(60, bars.length))
  let minP = Infinity
  let maxP = -Infinity
  for (const b of window) {
    minP = Math.min(minP, b.low)
    maxP = Math.max(maxP, b.high)
  }
  if (minP >= maxP) {
    return { poc: null, vah: null, val: null, hvn: [], lvn: [], approximate: true }
  }

  const step = (maxP - minP) / bins
  const volBins = new Array(bins).fill(0)

  for (const b of window) {
    const loBin = Math.max(0, Math.floor((b.low - minP) / step))
    const hiBin = Math.min(bins - 1, Math.floor((b.high - minP) / step))
    const span = hiBin - loBin + 1
    const share = b.volume / span
    for (let i = loBin; i <= hiBin; i++) volBins[i] += share
  }

  // POC
  let pocBin = 0
  for (let i = 1; i < bins; i++) {
    if (volBins[i] > volBins[pocBin]) pocBin = i
  }
  const poc = minP + (pocBin + 0.5) * step

  // Value Area: expand from POC until ~70% of volume
  const totalVol = volBins.reduce((a, c) => a + c, 0)
  const target = totalVol * 0.7
  let lo = pocBin
  let hi = pocBin
  let acc = volBins[pocBin]
  while (acc < target && (lo > 0 || hi < bins - 1)) {
    const expandLo = lo > 0 ? volBins[lo - 1] : -1
    const expandHi = hi < bins - 1 ? volBins[hi + 1] : -1
    if (expandHi >= expandLo) {
      hi++
      acc += volBins[hi]
    } else {
      lo--
      acc += volBins[lo]
    }
  }
  const val = minP + lo * step
  const vah = minP + (hi + 1) * step

  // HVN: local maxima
  const hvn: number[] = []
  for (let i = 1; i < bins - 1; i++) {
    if (volBins[i] > volBins[i - 1] && volBins[i] > volBins[i + 1] && volBins[i] > totalVol / bins) {
      hvn.push(minP + (i + 0.5) * step)
    }
  }
  hvn.sort((a, b) => b - a)
  const topHvn = hvn.slice(0, 3)

  // LVN: local minima
  const lvn: number[] = []
  for (let i = 1; i < bins - 1; i++) {
    if (volBins[i] < volBins[i - 1] && volBins[i] < volBins[i + 1]) {
      lvn.push(minP + (i + 0.5) * step)
    }
  }
  const topLvn = lvn.slice(0, 3)

  return {
    poc,
    vah,
    val,
    hvn: topHvn,
    lvn: topLvn,
    approximate: true,
  }
}
