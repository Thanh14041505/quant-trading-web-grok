import type { FeatureSnapshot } from "@/quant/features"
import type { OHLCV } from "@/models/market"
import type { TPlusSetup, EntryZone, TradeQuality, ConfidenceLevel, SignalAction } from "@/models/signal"
import type { SetupDetection } from "@/quant/strategies/tplusSetups"

export interface RiskPlan {
  entryZone: EntryZone
  trigger: string
  stopLoss: number
  tp1: number
  tp2: number
  riskReward: number
  riskPerShare: number
}

/**
 * ATR (Wilder) for SL/TP sizing
 */
export function atr(bars: OHLCV[], period = 14): number | null {
  if (bars.length < period + 1) return null
  const trs: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high
    const l = bars[i].low
    const prevC = bars[i - 1].close
    trs.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)))
  }
  // Wilder seed
  let val = 0
  for (let i = 0; i < period; i++) val += trs[i]
  val /= period
  for (let i = period; i < trs.length; i++) {
    val = (val * (period - 1) + trs[i]) / period
  }
  return val
}

export function buildRiskPlan(
  features: FeatureSnapshot,
  bars: OHLCV[],
  setup: TPlusSetup
): RiskPlan | null {
  const close = features.close
  const atr14 = atr(bars, 14)
  if (atr14 == null || atr14 <= 0) return null

  const structLow =
    features.structure.low20 ??
    features.structure.low50 ??
    close - 2 * atr14

  let entryLow: number
  let entryHigh: number
  let trigger: string
  let stopLoss: number
  let tp1: number
  let tp2: number

  switch (setup) {
    case "BREAKOUT": {
      const res = features.structure.high20 ?? close
      entryLow = res
      entryHigh = res + 0.5 * atr14
      trigger = "breakout + RVOL confirmation"
      stopLoss = Math.min(structLow, close - 1.5 * atr14)
      // Prefer structure invalidation under recent range
      if (features.structure.low20 != null) {
        stopLoss = Math.min(stopLoss, features.structure.low20 - 0.2 * atr14)
      }
      tp1 = entryHigh + 1.5 * atr14
      tp2 = entryHigh + 2.5 * atr14
      break
    }
    case "PULLBACK": {
      const ema20 = features.trend.ema20 ?? close
      entryLow = Math.min(ema20, close) - 0.3 * atr14
      entryHigh = Math.max(ema20, close) + 0.15 * atr14
      trigger = "bullish reversal above support / EMA20"
      stopLoss = Math.min(entryLow - 0.8 * atr14, structLow - 0.2 * atr14)
      tp1 = entryHigh + 1.2 * atr14
      tp2 = (features.structure.high20 ?? entryHigh + 2 * atr14)
      break
    }
    case "MOMENTUM_CONTINUATION": {
      entryLow = close - 0.3 * atr14
      entryHigh = close + 0.2 * atr14
      trigger = "hold above EMA20 with positive MACD hist"
      stopLoss = close - 1.5 * atr14
      if (features.trend.ema20 != null) {
        stopLoss = Math.min(stopLoss, features.trend.ema20 - 0.5 * atr14)
      }
      tp1 = close + 1.5 * atr14
      tp2 = close + 2.5 * atr14
      break
    }
    case "RSI_DIVERGENCE_REVERSAL":
    case "VSA_REVERSAL":
    case "MEAN_REVERSION": {
      entryLow = close - 0.4 * atr14
      entryHigh = close + 0.15 * atr14
      trigger =
        setup === "VSA_REVERSAL"
          ? "VSA reversal confirmation"
          : setup === "RSI_DIVERGENCE_REVERSAL"
            ? "RSI bullish divergence + price confirmation"
            : "mean-reversion bounce from oversold"
      stopLoss = Math.min(structLow - 0.3 * atr14, close - 1.8 * atr14)
      tp1 = close + 1.2 * atr14
      tp2 = features.trend.ema20 ?? close + 2 * atr14
      break
    }
    default:
      return null
  }

  // Normalize entry zone
  if (entryLow > entryHigh) {
    const t = entryLow
    entryLow = entryHigh
    entryHigh = t
  }

  // Ensure SL is below entry
  const entryMid = (entryLow + entryHigh) / 2
  if (stopLoss >= entryMid) {
    stopLoss = entryMid - 1.2 * atr14
  }

  // Ensure TPs above entry
  if (tp1 <= entryHigh) tp1 = entryHigh + 1 * atr14
  if (tp2 <= tp1) tp2 = tp1 + 1 * atr14

  const riskPerShare = entryMid - stopLoss
  if (riskPerShare <= 0) return null

  // R:R to TP1
  const reward = tp1 - entryMid
  const riskReward = reward / riskPerShare

  return {
    entryZone: {
      low: round2(entryLow),
      high: round2(entryHigh),
    },
    trigger,
    stopLoss: round2(stopLoss),
    tp1: round2(tp1),
    tp2: round2(tp2),
    riskReward: round2(riskReward),
    riskPerShare: round2(riskPerShare),
  }
}

/**
 * Separate Opportunity Score vs Trade Quality vs Confidence.
 * High score + poor R:R → NO_TRADE / WAIT, not automatic BUY.
 */
export function decideAction(
  score: number,
  riskPlan: RiskPlan | null,
  setup: SetupDetection,
  regimeName: string
): {
  action: SignalAction
  tradeQuality: TradeQuality
  confidence: ConfidenceLevel
} {
  if (setup.setup === "NONE" || !riskPlan) {
    return { action: "NO_TRADE", tradeQuality: "LOW", confidence: "LOW" }
  }

  const rr = riskPlan.riskReward

  // Trade quality from R:R and setup quality
  let tradeQuality: TradeQuality = "LOW"
  if (rr >= 2 && setup.quality >= 65) tradeQuality = "HIGH"
  else if (rr >= 1.4 && setup.quality >= 50) tradeQuality = "MEDIUM"
  else tradeQuality = "LOW"

  // Confidence from score + regime + setup quality
  let confidence: ConfidenceLevel = "LOW"
  if (score >= 75 && setup.quality >= 65 && (regimeName === "BULL" || regimeName === "BULL_PULLBACK")) {
    confidence = "HIGH"
  } else if (score >= 60 && setup.quality >= 50) {
    confidence = "MEDIUM"
  }

  // Hostile regime
  if (regimeName === "PANIC" || regimeName === "BEAR") {
    if (score < 80) {
      return { action: "NO_TRADE", tradeQuality, confidence: "LOW" }
    }
    return { action: "WAIT", tradeQuality, confidence }
  }

  // Decision matrix
  if (score >= 70 && tradeQuality !== "LOW" && rr >= 1.5) {
    return { action: "BUY", tradeQuality, confidence }
  }
  if (score >= 60 && rr >= 1.3) {
    return { action: "WATCH", tradeQuality, confidence }
  }
  if (score >= 55) {
    return { action: "WAIT", tradeQuality, confidence }
  }
  // High opportunity but poor R:R
  if (score >= 70 && rr < 1.3) {
    return { action: "WAIT", tradeQuality: "LOW", confidence }
  }

  return { action: "NO_TRADE", tradeQuality, confidence }
}

/** Risk-based position size (shares), lot-aware optional */
export function positionSize(params: {
  capital: number
  riskPct: number // e.g. 0.01 = 1%
  entry: number
  stopLoss: number
  lotSize?: number
  maxPositionPct?: number
}): number {
  const {
    capital,
    riskPct,
    entry,
    stopLoss,
    lotSize = 100,
    maxPositionPct = 0.2,
  } = params
  const riskPerShare = entry - stopLoss
  if (riskPerShare <= 0 || entry <= 0) return 0
  const riskAmount = capital * riskPct
  let shares = Math.floor(riskAmount / riskPerShare)
  // Cap by max position
  const maxShares = Math.floor((capital * maxPositionPct) / entry)
  shares = Math.min(shares, maxShares)
  // Round down to lot
  shares = Math.floor(shares / lotSize) * lotSize
  return Math.max(0, shares)
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
