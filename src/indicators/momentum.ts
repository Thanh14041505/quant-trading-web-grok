import type { OHLCV } from "@/models/market"
import { ema, lastNonNull, sma } from "./math"

export interface MomentumFeatures {
  rsi7: number | null
  rsi14: number | null
  rsi21: number | null
  macd: number | null
  macdSignal: number | null
  macdHist: number | null
  roc5: number | null
  roc20: number | null
  mfi14: number | null
  stochK: number | null
  stochD: number | null
}

function rsiSeries(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null)
  if (closes.length < period + 1) return out

  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) avgGain += d
    else avgLoss -= d
  }
  avgGain /= period
  avgLoss /= period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    const gain = d > 0 ? d : 0
    const loss = d < 0 ? -d : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

function macdSeries(closes: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast)
  const es = ema(closes, slow)
  const macdLine: (number | null)[] = closes.map((_, i) =>
    ef[i] != null && es[i] != null ? (ef[i] as number) - (es[i] as number) : null
  )
  // Signal on non-null macd values – simplified: treat null as skip by building dense array
  const dense: number[] = []
  const denseIdx: number[] = []
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] != null) {
      dense.push(macdLine[i] as number)
      denseIdx.push(i)
    }
  }
  const sigDense = ema(dense, signal)
  const signalLine: (number | null)[] = new Array(closes.length).fill(null)
  const hist: (number | null)[] = new Array(closes.length).fill(null)
  for (let j = 0; j < denseIdx.length; j++) {
    const i = denseIdx[j]
    signalLine[i] = sigDense[j]
    if (macdLine[i] != null && sigDense[j] != null) {
      hist[i] = (macdLine[i] as number) - (sigDense[j] as number)
    }
  }
  return { macdLine, signalLine, hist }
}

function rocSeries(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null)
  for (let i = period; i < closes.length; i++) {
    const prev = closes[i - period]
    if (prev !== 0) out[i] = ((closes[i] - prev) / prev) * 100
  }
  return out
}

function mfiSeries(bars: OHLCV[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null)
  if (bars.length < period + 1) return out

  const tp: number[] = bars.map(
    (b) => (b.high + b.low + b.close) / 3
  )
  const rmf: number[] = tp.map((t, i) => t * bars[i].volume)

  for (let i = period; i < bars.length; i++) {
    let pos = 0
    let neg = 0
    for (let j = i - period + 1; j <= i; j++) {
      if (tp[j] > tp[j - 1]) pos += rmf[j]
      else if (tp[j] < tp[j - 1]) neg += rmf[j]
    }
    out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg)
  }
  return out
}

function stochastic(bars: OHLCV[], kPeriod = 14, dPeriod = 3) {
  const kArr: (number | null)[] = new Array(bars.length).fill(null)
  for (let i = kPeriod - 1; i < bars.length; i++) {
    let hh = -Infinity
    let ll = Infinity
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hh = Math.max(hh, bars[j].high)
      ll = Math.min(ll, bars[j].low)
    }
    kArr[i] = hh === ll ? 50 : ((bars[i].close - ll) / (hh - ll)) * 100
  }
  // %D = SMA of %K
  const denseK: number[] = []
  const denseIdx: number[] = []
  for (let i = 0; i < kArr.length; i++) {
    if (kArr[i] != null) {
      denseK.push(kArr[i] as number)
      denseIdx.push(i)
    }
  }
  const dDense = sma(denseK, dPeriod)
  const dArr: (number | null)[] = new Array(bars.length).fill(null)
  for (let j = 0; j < denseIdx.length; j++) {
    dArr[denseIdx[j]] = dDense[j]
  }
  return { k: kArr, d: dArr }
}

export function computeMomentumFeatures(bars: OHLCV[]): MomentumFeatures {
  const closes = bars.map((b) => b.close)
  const r7 = rsiSeries(closes, 7)
  const r14 = rsiSeries(closes, 14)
  const r21 = rsiSeries(closes, 21)
  const { macdLine, signalLine, hist } = macdSeries(closes)
  const roc5 = rocSeries(closes, 5)
  const roc20 = rocSeries(closes, 20)
  const mfi = mfiSeries(bars, 14)
  const stoch = stochastic(bars)

  return {
    rsi7: lastNonNull(r7),
    rsi14: lastNonNull(r14),
    rsi21: lastNonNull(r21),
    macd: lastNonNull(macdLine),
    macdSignal: lastNonNull(signalLine),
    macdHist: lastNonNull(hist),
    roc5: lastNonNull(roc5),
    roc20: lastNonNull(roc20),
    mfi14: lastNonNull(mfi),
    stochK: lastNonNull(stoch.k),
    stochD: lastNonNull(stoch.d),
  }
}

export { rsiSeries, macdSeries, rocSeries, mfiSeries }
