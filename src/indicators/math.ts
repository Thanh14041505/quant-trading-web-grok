/** Shared numeric helpers for indicators */

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (period <= 0 || values.length < period) return out
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (period <= 0 || values.length < period) return out
  const k = 2 / (period + 1)
  // Seed with SMA
  let sum = 0
  for (let i = 0; i < period; i++) sum += values[i]
  let prev = sum / period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export function slope(
  series: (number | null)[],
  lookback: number
): (number | null)[] {
  const out: (number | null)[] = new Array(series.length).fill(null)
  for (let i = lookback; i < series.length; i++) {
    const a = series[i - lookback]
    const b = series[i]
    if (a == null || b == null || a === 0) continue
    out[i] = (b - a) / a
  }
  return out
}

export function rollingMax(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  for (let i = period - 1; i < values.length; i++) {
    let m = -Infinity
    for (let j = i - period + 1; j <= i; j++) m = Math.max(m, values[j])
    out[i] = m
  }
  return out
}

export function rollingMin(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  for (let i = period - 1; i < values.length; i++) {
    let m = Infinity
    for (let j = i - period + 1; j <= i; j++) m = Math.min(m, values[j])
    out[i] = m
  }
  return out
}

export function stdev(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += values[j]
    const mean = sum / period
    let varSum = 0
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - mean
      varSum += d * d
    }
    out[i] = Math.sqrt(varSum / period)
  }
  return out
}

export function lastNonNull<T>(arr: (T | null)[]): T | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i] as T
  }
  return null
}

export function atIndex<T>(arr: (T | null)[], i: number): T | null {
  if (i < 0 || i >= arr.length) return null
  return arr[i]
}
