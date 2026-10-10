import type { FeatureSnapshot } from "@/quant/features"
import type { OHLCV } from "@/models/market"
import type {
  TPlusSetup,
  EntryZone,
  TradeQuality,
  ConfidenceLevel,
  SignalAction,
} from "@/models/signal"
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

/** Tunable T+ risk targets (aligned with VN Quant engine swing defaults) */
export const TPLUS_RISK_DEFAULTS = {
  /** Min R:R to TP1 after plan build */
  minRrTp1: 2.0,
  /** TP1 = entryMid + risk * mult (floor) */
  t1RiskMult: 2.0,
  /** TP2 = entryMid + risk * mult (floor) */
  t2RiskMult: 3.5,
  /** Cap SL distance from entry mid (ATR units) so structure SL cannot kill R:R */
  maxSlAtr: 1.8,
  /** Floor SL distance so noise doesn't make tiny risk / crazy R:R */
  minSlAtr: 0.7,
  /** Prefer at least this % gain to TP1 when ATR% is healthy (VN T+ style) */
  minTp1Pct: 0.06,
  /** Soft target % for TP2 */
  minTp2Pct: 0.1,
} as const

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
  let val = 0
  for (let i = 0; i < period; i++) val += trs[i]!
  val /= period
  for (let i = period; i < trs.length; i++) {
    val = (val * (period - 1) + trs[i]!) / period
  }
  return val
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

/**
 * Build entry / SL / TP with R-multiple targets.
 *
 * Old bug: SL from deep structure + TP = entry + 1.2 ATR → R:R ≈ 1.0–1.1.
 * Fix: cap SL depth, size TP1/TP2 as multiples of risk (2R / 3.5R),
 * optionally lift to structure highs / min % targets when higher.
 */
export function buildRiskPlan(
  features: FeatureSnapshot,
  bars: OHLCV[],
  setup: TPlusSetup
): RiskPlan | null {
  const close = features.close
  const atr14 = atr(bars, 14)
  if (atr14 == null || atr14 <= 0) return null

  const cfg = TPLUS_RISK_DEFAULTS
  const structLow =
    features.structure.low20 ?? features.structure.low50 ?? close - 2 * atr14
  const structHigh20 = features.structure.high20
  const structHigh50 = features.structure.high50

  let entryLow: number
  let entryHigh: number
  let trigger: string
  let rawSl: number

  switch (setup) {
    case "BREAKOUT": {
      const res = structHigh20 ?? close
      entryLow = res
      entryHigh = res + 0.35 * atr14
      trigger = "breakout + RVOL confirmation"
      // Invalidation just under breakout base / recent swing — not entire 20d range
      rawSl = Math.min(
        res - 0.9 * atr14,
        (features.structure.low20 ?? res) - 0.15 * atr14
      )
      break
    }
    case "PULLBACK": {
      const ema20 = features.trend.ema20 ?? close
      entryLow = Math.min(ema20, close) - 0.25 * atr14
      entryHigh = Math.max(ema20, close) + 0.12 * atr14
      trigger = "bullish reversal above support / EMA20"
      rawSl = Math.min(entryLow - 0.7 * atr14, structLow - 0.1 * atr14)
      break
    }
    case "MOMENTUM_CONTINUATION": {
      entryLow = close - 0.25 * atr14
      entryHigh = close + 0.2 * atr14
      trigger = "hold above EMA20 with positive MACD hist"
      rawSl = close - 1.2 * atr14
      if (features.trend.ema20 != null) {
        rawSl = Math.min(rawSl, features.trend.ema20 - 0.4 * atr14)
      }
      break
    }
    case "RSI_DIVERGENCE_REVERSAL":
    case "VSA_REVERSAL":
    case "MEAN_REVERSION": {
      entryLow = close - 0.35 * atr14
      entryHigh = close + 0.12 * atr14
      trigger =
        setup === "VSA_REVERSAL"
          ? "VSA reversal confirmation"
          : setup === "RSI_DIVERGENCE_REVERSAL"
            ? "RSI bullish divergence + price confirmation"
            : "mean-reversion bounce from oversold"
      rawSl = Math.min(structLow - 0.15 * atr14, close - 1.4 * atr14)
      break
    }
    default:
      return null
  }

  if (entryLow > entryHigh) {
    const t = entryLow
    entryLow = entryHigh
    entryHigh = t
  }

  const entryMid = (entryLow + entryHigh) / 2

  // --- Cap SL depth so risk stays tradeable ---
  const maxSlDist = cfg.maxSlAtr * atr14
  const minSlDist = cfg.minSlAtr * atr14
  let stopLoss = rawSl
  if (stopLoss >= entryMid - minSlDist) {
    stopLoss = entryMid - minSlDist
  }
  if (entryMid - stopLoss > maxSlDist) {
    stopLoss = entryMid - maxSlDist
  }
  // Still keep a structural hint if it is tighter (better) than cap
  if (rawSl < entryMid && entryMid - rawSl >= minSlDist && entryMid - rawSl <= maxSlDist) {
    stopLoss = rawSl
  }

  let riskPerShare = entryMid - stopLoss
  if (riskPerShare <= 0) {
    stopLoss = entryMid - minSlDist
    riskPerShare = minSlDist
  }

  // --- TP from risk multiples (primary) ---
  let tp1 = entryMid + cfg.t1RiskMult * riskPerShare
  let tp2 = entryMid + cfg.t2RiskMult * riskPerShare

  // Min % floors (VN T+ often needs meaningful move)
  tp1 = Math.max(tp1, entryMid * (1 + cfg.minTp1Pct))
  tp2 = Math.max(tp2, entryMid * (1 + cfg.minTp2Pct), tp1 + 0.5 * atr14)

  // Structure extension: if clear resistance is ABOVE min TP, use it for TP1/TP2
  if (structHigh20 != null && structHigh20 > tp1) {
    // Partial at first major high only if it still keeps R:R >= ~1.8
    const rrAtHigh = (structHigh20 - entryMid) / riskPerShare
    if (rrAtHigh >= 1.8) {
      tp1 = structHigh20
    }
  }
  if (structHigh50 != null && structHigh50 > tp2) {
    tp2 = structHigh50
  } else if (structHigh20 != null && structHigh20 > tp2) {
    tp2 = structHigh20 + 0.5 * atr14
  }

  // Ensure ordering
  if (tp1 <= entryHigh) tp1 = entryHigh + cfg.t1RiskMult * riskPerShare
  if (tp2 <= tp1) tp2 = tp1 + (cfg.t2RiskMult - cfg.t1RiskMult) * riskPerShare

  // Final R:R to TP1; if still below target, stretch TP1 (keep SL fixed)
  let reward = tp1 - entryMid
  let riskReward = reward / riskPerShare
  if (riskReward < cfg.minRrTp1) {
    tp1 = entryMid + cfg.minRrTp1 * riskPerShare
    reward = tp1 - entryMid
    riskReward = cfg.minRrTp1
    if (tp2 <= tp1) {
      tp2 = entryMid + cfg.t2RiskMult * riskPerShare
    }
  }

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

  let tradeQuality: TradeQuality = "LOW"
  if (rr >= 2.5 && setup.quality >= 65) tradeQuality = "HIGH"
  else if (rr >= 2 && setup.quality >= 50) tradeQuality = "HIGH"
  else if (rr >= 1.8 && setup.quality >= 45) tradeQuality = "MEDIUM"
  else if (rr >= 1.5) tradeQuality = "MEDIUM"

  let confidence: ConfidenceLevel = "LOW"
  if (score >= 70 && setup.quality >= 65 && rr >= 2) confidence = "HIGH"
  else if (score >= 55 && setup.quality >= 50 && rr >= 1.8) confidence = "MEDIUM"
  else if (score >= 45) confidence = "MEDIUM"

  const regime = String(regimeName).toUpperCase()
  const bearish = regime.includes("BEAR") || regime.includes("PANIC")

  // Action gates — require meaningful R:R for BUY
  if (score >= 65 && rr >= 2 && setup.quality >= 55 && !bearish) {
    return { action: "BUY", tradeQuality, confidence }
  }
  if (score >= 55 && rr >= 1.8 && setup.quality >= 45) {
    return { action: "WATCH", tradeQuality, confidence }
  }
  if (score >= 45 && rr >= 1.5) {
    return { action: "WAIT", tradeQuality, confidence }
  }
  // Strong setup but R:R still marginal after plan → WAIT not BUY
  if (score >= 60 && rr < 1.8) {
    return { action: "WAIT", tradeQuality: "LOW", confidence: "LOW" }
  }

  return { action: "NO_TRADE", tradeQuality, confidence }
}