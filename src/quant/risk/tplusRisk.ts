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
  /** Numeric level for breakout / confirmation */
  triggerPrice: number | null
  stopLoss: number
  tp1: number
  tp2: number
  /** R:R at entry midpoint (legacy / display) */
  riskReward: number
  /** Conservative R:R if filled at entry high */
  riskRewardAtHigh: number
  riskRewardAtLow: number
  riskPerShare: number
  riskPct: number
  rewardPctAtMid: number
  atr14: number
  entryWidthPct: number
}

/**
 * SL: ATR-capped.
 * TP: structure (high20/50) + ATR fallback — never stretch to fake R>=2.
 * Report R at entry low / mid / high for honest geometry.
 */
export const TPLUS_RISK_DEFAULTS = {
  maxSlAtr: 1.8,
  minSlAtr: 0.7,
  tp1AtrMult: 1.8,
  tp2AtrMult: 3.0,
  minTpClearAtr: 0.35,
  /** Cap entry zone width so user is not chasing a 4–5% band */
  maxEntryWidthAtr: 0.55,
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

function clampEntryWidth(
  low: number,
  high: number,
  atr14: number,
  maxWidthAtr: number
): { low: number; high: number } {
  if (high <= low) return { low, high: low + 0.2 * atr14 }
  const width = high - low
  const maxW = maxWidthAtr * atr14
  if (width <= maxW) return { low, high }
  const mid = (low + high) / 2
  return { low: mid - maxW / 2, high: mid + maxW / 2 }
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
  let triggerPrice: number | null = null
  let rawSl: number

  switch (setup) {
    case "BREAKOUT": {
      const res = high20 ?? close
      // Entry starts at/above breakout level — not below close if already lagging
      entryLow = Math.max(res, close)
      entryHigh = entryLow + 0.35 * atr14
      triggerPrice = round2(res)
      trigger = `breakout above ${triggerPrice} + RVOL≥1.3`
      rawSl = Math.min(
        res - 0.9 * atr14,
        (features.structure.low20 ?? res) - 0.15 * atr14
      )
      break
    }
    case "PULLBACK": {
      const e = ema20 ?? close
      entryLow = Math.min(e, close) - 0.15 * atr14
      entryHigh = Math.max(e, close) + 0.1 * atr14
      triggerPrice = round2(e)
      trigger = `hold/reclaim EMA20≈${triggerPrice}`
      rawSl = Math.min(entryLow - 0.7 * atr14, structLow - 0.1 * atr14)
      break
    }
    case "MOMENTUM_CONTINUATION": {
      entryLow = close - 0.2 * atr14
      entryHigh = close + 0.15 * atr14
      triggerPrice = round2(ema20 ?? close)
      trigger = `hold above EMA20≈${triggerPrice}, MACD hist>0`
      rawSl = close - 1.2 * atr14
      break
    }
    case "RSI_DIVERGENCE_REVERSAL":
    case "VSA_REVERSAL":
    case "MEAN_REVERSION": {
      entryLow = close - 0.3 * atr14
      entryHigh = close + 0.15 * atr14
      triggerPrice = round2(structLow)
      trigger = `reversal confirmation above ${triggerPrice}`
      rawSl = structLow - 0.35 * atr14
      break
    }
    default: {
      entryLow = close - 0.2 * atr14
      entryHigh = close + 0.15 * atr14
      trigger = "setup confirmation"
      rawSl = close - 1.2 * atr14
    }
  }

  const clamped = clampEntryWidth(
    entryLow,
    entryHigh,
    atr14,
    cfg.maxEntryWidthAtr
  )
  entryLow = clamped.low
  entryHigh = clamped.high

  const entryMid = (entryLow + entryHigh) / 2

  // SL floor/cap in ATR
  let stopLoss = rawSl
  const minSl = entryMid - cfg.maxSlAtr * atr14
  const maxSl = entryMid - cfg.minSlAtr * atr14
  if (stopLoss < minSl) stopLoss = minSl
  if (stopLoss > maxSl) stopLoss = maxSl
  if (stopLoss >= entryLow) stopLoss = entryLow - cfg.minSlAtr * atr14

  const riskAtMid = entryMid - stopLoss
  const riskAtHigh = entryHigh - stopLoss
  const riskAtLow = entryLow - stopLoss
  if (riskAtMid <= 0 || riskAtHigh <= 0) return null

  const atrTp1 = entryMid + cfg.tp1AtrMult * atr14
  const atrTp2 = entryMid + cfg.tp2AtrMult * atr14

  const res1 = pickNearestResistanceAbove(
    entryHigh,
    [high20, high50, ema50, ema20],
    atr14
  )
  const res2 = pickNearestResistanceAbove(
    entryHigh,
    [high50, high20 != null ? high20 + atr14 : null],
    atr14
  )

  let tp1: number
  if (res1 != null && res1 > entryHigh + cfg.minTpClearAtr * atr14) {
    tp1 = res1
  } else {
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

  if (tp1 <= entryHigh) tp1 = entryHigh + cfg.minTpClearAtr * atr14
  if (tp2 <= tp1) tp2 = tp1 + 0.75 * atr14

  const rrMid = (tp1 - entryMid) / riskAtMid
  const rrHigh = (tp1 - entryHigh) / riskAtHigh
  const rrLow = (tp1 - entryLow) / Math.max(riskAtLow, 1e-9)

  return {
    entryZone: { low: round2(entryLow), high: round2(entryHigh) },
    trigger,
    triggerPrice,
    stopLoss: round2(stopLoss),
    tp1: round2(tp1),
    tp2: round2(tp2),
    riskReward: round2(rrMid),
    riskRewardAtHigh: round2(rrHigh),
    riskRewardAtLow: round2(rrLow),
    riskPerShare: round2(riskAtMid),
    riskPct: round2((riskAtMid / entryMid) * 100),
    rewardPctAtMid: round2(((tp1 - entryMid) / entryMid) * 100),
    atr14: round2(atr14),
    entryWidthPct: round2(((entryHigh - entryLow) / entryMid) * 100),
  }
}

export interface DecideActionInput {
  score: number
  riskPlan: RiskPlan | null
  setup: SetupDetection
  regimeName: string
  /** Structural / feature hard risks collected by engine */
  hardRisks?: string[]
}

/**
 * Gate by conservative R (entry high) + hard risks.
 * Regime BEAR is a penalty, not an automatic kill switch for strong setups.
 */
export function decideAction(
  scoreOrInput: number | DecideActionInput,
  riskPlanArg?: RiskPlan | null,
  setupArg?: SetupDetection,
  regimeNameArg?: string
): {
  action: SignalAction
  tradeQuality: TradeQuality
  confidence: ConfidenceLevel
  tradabilityScore: number
} {
  let score: number
  let riskPlan: RiskPlan | null
  let setup: SetupDetection
  let regimeName: string
  let hardRisks: string[] = []

  if (typeof scoreOrInput === "object") {
    score = scoreOrInput.score
    riskPlan = scoreOrInput.riskPlan
    setup = scoreOrInput.setup
    regimeName = scoreOrInput.regimeName
    hardRisks = scoreOrInput.hardRisks ?? []
  } else {
    score = scoreOrInput
    riskPlan = riskPlanArg ?? null
    setup = setupArg!
    regimeName = regimeNameArg ?? "SIDEWAYS"
  }

  if (setup.setup === "NONE" || !riskPlan) {
    return {
      action: "NO_TRADE",
      tradeQuality: "LOW",
      confidence: "LOW",
      tradabilityScore: 0,
    }
  }

  // Conservative geometry for eligibility
  const rrCons = Math.min(riskPlan.riskReward, riskPlan.riskRewardAtHigh)

  let tradeQuality: TradeQuality = "LOW"
  if (rrCons >= 2.2 && setup.quality >= 65) tradeQuality = "HIGH"
  else if (rrCons >= 1.8 && setup.quality >= 50) tradeQuality = "HIGH"
  else if (rrCons >= 1.4 && setup.quality >= 45) tradeQuality = "MEDIUM"
  else if (rrCons >= 1.15) tradeQuality = "MEDIUM"

  let confidence: ConfidenceLevel = "LOW"
  if (score >= 70 && setup.quality >= 65 && rrCons >= 1.8) confidence = "HIGH"
  else if (score >= 55 && setup.quality >= 50 && rrCons >= 1.4)
    confidence = "MEDIUM"
  else if (score >= 45) confidence = "MEDIUM"

  const regime = String(regimeName).toUpperCase()
  const bearish = regime.includes("BEAR") || regime.includes("PANIC")
  const hardBlock = hardRisks.some((r) =>
    [
      "BELOW_ICHIMOKU_CLOUD",
      "BELOW_EMA200",
      "BEARISH_DIVERGENCE",
      "DISTRIBUTION_STRUCTURE",
    ].includes(r)
  )

  // Tradability: what you can actually trade, not raw opportunity score
  let tradability = score * 0.45 + Math.min(rrCons, 3) * 15 + setup.quality * 0.25
  if (bearish) tradability -= 12
  if (hardBlock) tradability -= 25
  if (rrCons < 1.2) tradability -= 15
  if (riskPlan.entryWidthPct > 3) tradability -= 5
  tradability = Math.max(0, Math.min(100, Math.round(tradability)))

  if (hardBlock) {
    return {
      action: score >= 55 ? "WAIT" : "NO_TRADE",
      tradeQuality: "LOW",
      confidence: "LOW",
      tradabilityScore: tradability,
    }
  }

  // BUY: good score + conservative R — regime only soft-blocks unless panic
  if (
    score >= 65 &&
    rrCons >= 1.8 &&
    setup.quality >= 55 &&
    (!bearish || (score >= 75 && rrCons >= 2.2))
  ) {
    return {
      action: "BUY",
      tradeQuality,
      confidence,
      tradabilityScore: tradability,
    }
  }

  if (score >= 55 && rrCons >= 1.4 && setup.quality >= 45) {
    return {
      action: "WATCH",
      tradeQuality,
      confidence,
      tradabilityScore: tradability,
    }
  }

  if (score >= 45 && rrCons >= 1.15) {
    return {
      action: "WAIT",
      tradeQuality,
      confidence,
      tradabilityScore: tradability,
    }
  }

  if (score >= 60 && rrCons < 1.4) {
    return {
      action: "WAIT",
      tradeQuality: "LOW",
      confidence: "LOW",
      tradabilityScore: tradability,
    }
  }

  return {
    action: "NO_TRADE",
    tradeQuality,
    confidence,
    tradabilityScore: tradability,
  }
}
