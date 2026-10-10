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

/**
 * SL: capped (agreed).
 * TP: realistic structure + ATR — NEVER stretch TP just to force R:R >= 2.
 * R:R is measured honestly; action layer filters poor R:R.
 */
export const TPLUS_RISK_DEFAULTS = {
  maxSlAtr: 1.8,
  minSlAtr: 0.7,
  /** Soft ATR guides when structure is missing / too close */
  tp1AtrMult: 1.8,
  tp2AtrMult: 3.0,
  /** Min gap TP above entry high (ATR) so TP is not inside entry zone */
  minTpClearAtr: 0.35,
} as const

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

function pickNearestResistanceAbove(
  level: number,
  candidates: (number | null | undefined)[],
  atr14: number
): number | null {
  const min = level + 0.15 * atr14
  let best: number | null = null
  for (const c of candidates) {
    if (c == null || !Number.isFinite(c)) continue
    if (c < min) continue
    if (best == null || c < best) best = c
  }
  return best
}

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
  const high20 = features.structure.high20
  const high50 = features.structure.high50
  const ema20 = features.trend.ema20
  const ema50 = features.trend.ema50

  let entryLow: number
  let entryHigh: number
  let trigger: string
  let rawSl: number

  switch (setup) {
    case "BREAKOUT": {
      const res = high20 ?? close
      entryLow = res
      entryHigh = res + 0.35 * atr14
      trigger = "breakout + RVOL confirmation"
      rawSl = Math.min(
        res - 0.9 * atr14,
        (features.structure.low20 ?? res) - 0.15 * atr14
      )
      break
    }
    case "PULLBACK": {
      const e = ema20 ?? close
      entryLow = Math.min(e, close) - 0.25 * atr14
      entryHigh = Math.max(e, close) + 0.12 * atr14
      trigger = "bullish reversal above support / EMA20"
      rawSl = Math.min(entryLow - 0.7 * atr14, structLow - 0.1 * atr14)
      break
    }
    case "MOMENTUM_CONTINUATION": {
      entryLow = close - 0.25 * atr14
      entryHigh = close + 0.2 * atr14
      trigger = "hold above EMA20 with positive MACD hist"
      rawSl = close - 1.2 * atr14
      if (ema20 != null) rawSl = Math.min(rawSl, ema20 - 0.4 * atr14)
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

  // ----- SL cap (kept — user agreed) -----
  const maxSlDist = cfg.maxSlAtr * atr14
  const minSlDist = cfg.minSlAtr * atr14
  let stopLoss = rawSl
  if (stopLoss >= entryMid - minSlDist) stopLoss = entryMid - minSlDist
  if (entryMid - stopLoss > maxSlDist) stopLoss = entryMid - maxSlDist
  if (
    rawSl < entryMid &&
    entryMid - rawSl >= minSlDist &&
    entryMid - rawSl <= maxSlDist
  ) {
    stopLoss = rawSl
  }

  let riskPerShare = entryMid - stopLoss
  if (riskPerShare <= 0) {
    stopLoss = entryMid - minSlDist
    riskPerShare = minSlDist
  }

  // ----- TP: realistic only — no forced 2R stretch -----
  // Priority:
  //  1) Nearest structure resistance above entry (high20 / high50 / EMA if above)
  //  2) Else ATR projection from entry (measured move style)
  //  3) TP2 = next resistance or wider ATR — must stay above TP1
  //
  // We do NOT push TP higher just to make R:R look good.

  const atrTp1 = entryMid + cfg.tp1AtrMult * atr14
  const atrTp2 = entryMid + cfg.tp2AtrMult * atr14

  const res1 = pickNearestResistanceAbove(entryHigh, [high20, ema50, ema20], atr14)
  const res2 = pickNearestResistanceAbove(
    entryHigh,
    [high50, high20 != null ? high20 + atr14 : null],
    atr14
  )

  let tp1: number
  if (res1 != null && res1 > entryHigh + cfg.minTpClearAtr * atr14) {
    // Structure target — honest ceiling of path of least resistance
    tp1 = res1
  } else {
    // No clear overhead structure → ATR measured objective
    tp1 = atrTp1
  }

  let tp2: number
  if (res2 != null && res2 > tp1 + 0.25 * atr14) {
    tp2 = res2
  } else if (high50 != null && high50 > tp1 + 0.25 * atr14) {
    tp2 = high50
  } else {
    tp2 = Math.max(atrTp2, tp1 + 1.0 * atr14)
  }

  // Keep TP outside entry zone; do not invent far targets
  if (tp1 <= entryHigh) tp1 = entryHigh + cfg.minTpClearAtr * atr14
  if (tp2 <= tp1) tp2 = tp1 + 0.75 * atr14

  // Honest R:R to TP1 (may be < 2 — that is intentional signal quality)
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
 * Gate actions by measured R:R — do not assume TP is reachable at 2R.
 * Poor geometry → WAIT / NO_TRADE even if score is high.
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
  else if (rr >= 2.0 && setup.quality >= 50) tradeQuality = "HIGH"
  else if (rr >= 1.5 && setup.quality >= 45) tradeQuality = "MEDIUM"
  else if (rr >= 1.2) tradeQuality = "MEDIUM"

  let confidence: ConfidenceLevel = "LOW"
  if (score >= 70 && setup.quality >= 65 && rr >= 2) confidence = "HIGH"
  else if (score >= 55 && setup.quality >= 50 && rr >= 1.5) confidence = "MEDIUM"
  else if (score >= 45) confidence = "MEDIUM"

  const regime = String(regimeName).toUpperCase()
  const bearish = regime.includes("BEAR") || regime.includes("PANIC")

  // BUY only when geometry is actually good — not forced
  if (score >= 65 && rr >= 2.0 && setup.quality >= 55 && !bearish) {
    return { action: "BUY", tradeQuality, confidence }
  }
  if (score >= 55 && rr >= 1.5 && setup.quality >= 45) {
    return { action: "WATCH", tradeQuality, confidence }
  }
  if (score >= 45 && rr >= 1.2) {
    return { action: "WAIT", tradeQuality, confidence }
  }
  // High opportunity score but bad path-to-target geometry
  if (score >= 60 && rr < 1.5) {
    return { action: "WAIT", tradeQuality: "LOW", confidence: "LOW" }
  }

  return { action: "NO_TRADE", tradeQuality, confidence }
}