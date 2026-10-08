import type { OHLCV } from "@/models/market"

export interface RelativeStrengthFeatures {
  rs20: number | null
  rs60: number | null
  rs120: number | null
  /** Performance of stock when index was up (20d) */
  betaUp20: number | null
  /** Performance when index was down */
  betaDown20: number | null
  corr20: number | null
  corr60: number | null
  beta20: number | null
  beta60: number | null
}

function alignByDate(
  stock: OHLCV[],
  index: OHLCV[]
): { s: number; i: number; date: string }[] {
  const map = new Map(index.map((b) => [b.date, b.close]))
  const out: { s: number; i: number; date: string }[] = []
  for (const b of stock) {
    const ic = map.get(b.date)
    if (ic != null) out.push({ s: b.close, i: ic, date: b.date })
  }
  return out
}

function periodReturn(closes: number[], period: number): number | null {
  if (closes.length <= period) return null
  const a = closes[closes.length - 1 - period]
  const b = closes[closes.length - 1]
  if (a === 0) return null
  return (b - a) / a
}

function correlation(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length)
  if (n < 5) return null
  const xs = x.slice(-n)
  const ys = y.slice(-n)
  let sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0
  for (let i = 0; i < n; i++) {
    sx += xs[i]
    sy += ys[i]
    sxx += xs[i] * xs[i]
    syy += ys[i] * ys[i]
    sxy += xs[i] * ys[i]
  }
  const num = n * sxy - sx * sy
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy))
  if (den === 0) return null
  return num / den
}

function beta(stockRet: number[], indexRet: number[]): number | null {
  const n = Math.min(stockRet.length, indexRet.length)
  if (n < 5) return null
  const xs = indexRet.slice(-n)
  const ys = stockRet.slice(-n)
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0
  for (let i = 0; i < n; i++) {
    sx += xs[i]
    sy += ys[i]
    sxx += xs[i] * xs[i]
    sxy += xs[i] * ys[i]
  }
  const varX = n * sxx - sx * sx
  if (varX === 0) return null
  return (n * sxy - sx * sy) / varX
}

function dailyReturns(closes: number[]): number[] {
  const r: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]
    r.push(prev === 0 ? 0 : (closes[i] - prev) / prev)
  }
  return r
}

/**
 * Relative strength vs a benchmark (e.g. VNINDEX).
 * RS = stockReturn / indexReturn over the window (ratio of cumulative returns).
 */
export function computeRelativeStrength(
  stockBars: OHLCV[],
  indexBars: OHLCV[]
): RelativeStrengthFeatures {
  const aligned = alignByDate(stockBars, indexBars)
  if (aligned.length < 25) {
    return {
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
  }

  const sCloses = aligned.map((a) => a.s)
  const iCloses = aligned.map((a) => a.i)

  const rs = (period: number) => {
    const sr = periodReturn(sCloses, period)
    const ir = periodReturn(iCloses, period)
    if (sr == null || ir == null) return null
    // Relative performance: stock excess return
    return sr - ir
  }

  const sRet = dailyReturns(sCloses)
  const iRet = dailyReturns(iCloses)

  // Conditional beta up / down over last 20 returns
  const window = Math.min(20, sRet.length)
  const sW = sRet.slice(-window)
  const iW = iRet.slice(-window)
  let upS = 0,
    upI = 0,
    upN = 0
  let dnS = 0,
    dnI = 0,
    dnN = 0
  for (let k = 0; k < window; k++) {
    if (iW[k] > 0) {
      upS += sW[k]
      upI += iW[k]
      upN++
    } else if (iW[k] < 0) {
      dnS += sW[k]
      dnI += iW[k]
      dnN++
    }
  }

  return {
    rs20: rs(20),
    rs60: rs(60),
    rs120: rs(120),
    betaUp20: upN > 3 && upI !== 0 ? upS / upI : null,
    betaDown20: dnN > 3 && dnI !== 0 ? dnS / dnI : null,
    corr20: correlation(sRet.slice(-20), iRet.slice(-20)),
    corr60: correlation(sRet.slice(-60), iRet.slice(-60)),
    beta20: beta(sRet.slice(-20), iRet.slice(-20)),
    beta60: beta(sRet.slice(-60), iRet.slice(-60)),
  }
}
