import type { OHLCV } from "@/models/market"
import type {
  HoldFundamentals,
  HoldScoreWeights,
  HoldSignal,
  HoldSector,
} from "@/models/hold"
import { DEFAULT_HOLD_WEIGHTS } from "@/models/hold"
import type { SignalAction, ConfidenceLevel, TradeQuality } from "@/models/signal"
import { computeFeatures } from "@/quant/features"
import type { RegimeResult } from "@/quant/regime"
import {
  scoreHold,
  normalizeSector,
} from "@/quant/scoring/holdScoring"
import { fetchFundamentals, fetchCompanyInfo } from "@/data/marketDataService"

export const HOLD_STRATEGY_VERSION = "HOLD_QUALITY_GROWTH_v1"

export interface HoldEngineOptions {
  weights?: HoldScoreWeights
  regime?: RegimeResult | null
  indexBars?: OHLCV[]
  fundamentals?: HoldFundamentals
}

/**
 * Map provider FundamentalData → HoldFundamentals
 */
export function toHoldFundamentals(
  symbol: string,
  raw: Record<string, unknown>,
  sectorHint?: string
): HoldFundamentals {
  return {
    symbol: symbol.toUpperCase(),
    sector: normalizeSector(sectorHint ?? (raw.sector as string), raw.industry as string),
    roe: num(raw.roe),
    roa: num(raw.roa),
    roic: num(raw.roic),
    grossMargin: num(raw.grossMargin),
    operatingMargin: num(raw.operatingMargin),
    netMargin: num(raw.netMargin),
    debtToEquity: num(raw.debtToEquity),
    interestCoverage: num(raw.interestCoverage),
    operatingCashFlow: num(raw.operatingCashFlow),
    fcf: num(raw.fcf),
    revenueGrowth: num(raw.revenueGrowth),
    epsGrowth: num(raw.epsGrowth),
    profitGrowth: num(raw.profitGrowth),
    pe: num(raw.pe),
    pb: num(raw.pb),
    peg: num(raw.peg),
    dividendYield: num(raw.dividendYield),
    nim: num(raw.nim),
    npl: num(raw.npl),
    casa: num(raw.casa),
    brokerageShare: num(raw.brokerageShare),
  }
}

function num(v: unknown): number | undefined {
  if (v == null) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function runHoldEngine(
  bars: OHLCV[],
  options: HoldEngineOptions = {}
): HoldSignal | null {
  if (!bars || bars.length < 30) return null

  const features = computeFeatures(bars, { indexBars: options.indexBars })
  const fundamentals =
    options.fundamentals ??
    ({
      symbol: bars[bars.length - 1]?.symbol ?? "?",
      sector: "OTHER",
    } satisfies HoldFundamentals)

  const breakdown = scoreHold(
    fundamentals,
    features,
    options.regime ?? null,
    options.weights ?? DEFAULT_HOLD_WEIGHTS
  )

  const sector = (fundamentals.sector as HoldSector) ?? "OTHER"
  const { action, tradeQuality, confidence } = decideHoldAction(
    breakdown.total,
    breakdown.components,
    options.regime?.regime ?? "SIDEWAYS"
  )

  return {
    symbol: fundamentals.symbol.toUpperCase(),
    date: features?.date ?? bars[bars.length - 1].date,
    engine: "HOLD",
    setup: breakdown.setup,
    action,
    score: breakdown.total,
    tradeQuality,
    confidence,
    sector,
    metrics: {
      roe: fundamentals.roe,
      roa: fundamentals.roa,
      pe: fundamentals.pe,
      pb: fundamentals.pb,
      epsGrowth: fundamentals.epsGrowth,
      revenueGrowth: fundamentals.revenueGrowth,
      debtToEquity: fundamentals.debtToEquity,
      fcf: fundamentals.fcf,
      rs120: features?.relativeStrength.rs120 ?? undefined,
      aboveEma200: features?.trend.aboveEma200,
    },
    upsideHint: hintUpside(fundamentals, breakdown.total),
    catalyst: hintCatalyst(breakdown.reasons),
    reasons: breakdown.reasons,
    risks: breakdown.risks,
    marketRegime: options.regime?.regime ?? "SIDEWAYS",
    strategyVersion: HOLD_STRATEGY_VERSION,
    componentScores: breakdown.components,
  }
}

function decideHoldAction(
  score: number,
  components: Record<string, number>,
  regime: string
): {
  action: SignalAction
  tradeQuality: TradeQuality
  confidence: ConfidenceLevel
} {
  const trend = components.long_term_trend ?? 50
  const quality = components.business_quality ?? 50
  const growth = components.earnings_growth ?? 50

  let tradeQuality: TradeQuality = "LOW"
  if (quality >= 65 && growth >= 60 && trend >= 55) tradeQuality = "HIGH"
  else if (score >= 55 && trend >= 45) tradeQuality = "MEDIUM"

  let confidence: ConfidenceLevel = "LOW"
  if (score >= 72 && tradeQuality === "HIGH") confidence = "HIGH"
  else if (score >= 58) confidence = "MEDIUM"

  if (regime === "PANIC") {
    return {
      action: score >= 80 ? "WATCH" : "WAIT",
      tradeQuality,
      confidence: "LOW",
    }
  }
  if (regime === "BEAR" && trend < 40) {
    return { action: "WAIT", tradeQuality, confidence }
  }

  if (score >= 70 && tradeQuality !== "LOW") {
    return { action: "BUY", tradeQuality, confidence }
  }
  if (score >= 58) {
    return { action: "WATCH", tradeQuality, confidence }
  }
  if (score >= 45 && trend >= 50) {
    return { action: "HOLD", tradeQuality, confidence }
  }
  return { action: "NO_TRADE", tradeQuality, confidence }
}

function hintUpside(f: HoldFundamentals, score: number): string | undefined {
  if (f.pe != null && f.pe > 0 && f.pe < 12 && score >= 55) {
    return "Valuation discount vs growth profile"
  }
  if (f.pb != null && f.pb < 1 && score >= 50) {
    return "Trading below book — watch asset quality"
  }
  if ((f.epsGrowth ?? 0) >= 20 && score >= 60) {
    return "Earnings momentum supports multi-month hold"
  }
  return undefined
}

function hintCatalyst(reasons: string[]): string | undefined {
  if (reasons.some((r) => r.includes("GROWTH"))) return "Earnings growth trajectory"
  if (reasons.some((r) => r.includes("RS120"))) return "Relative strength vs market"
  if (reasons.some((r) => r.includes("FCF"))) return "Cash flow support"
  return undefined
}

/**
 * Load fundamentals from provider and run Hold engine.
 */
export async function runHoldEngineWithProvider(
  symbol: string,
  bars: OHLCV[],
  options: Omit<HoldEngineOptions, "fundamentals"> = {}
): Promise<HoldSignal | null> {
  let fundamentals: HoldFundamentals = {
    symbol,
    sector: "OTHER",
  }
  try {
    const [fundRes, companyRes] = await Promise.all([
      fetchFundamentals(symbol),
      fetchCompanyInfo(symbol),
    ])
    fundamentals = toHoldFundamentals(
      symbol,
      fundRes.data as unknown as Record<string, unknown>,
      companyRes.data.sector ?? companyRes.data.industry
    )
  } catch {
    // keep minimal fundamentals
  }
  return runHoldEngine(bars, { ...options, fundamentals })
}

export function runHoldScan(
  seriesMap: Map<string, OHLCV[]>,
  fundamentalsMap: Map<string, HoldFundamentals>,
  options: Omit<HoldEngineOptions, "fundamentals"> = {}
): { signals: HoldSignal[]; errors: { symbol: string; error: string }[] } {
  const signals: HoldSignal[] = []
  const errors: { symbol: string; error: string }[] = []

  for (const [symbol, bars] of seriesMap) {
    try {
      const fund = fundamentalsMap.get(symbol) ?? {
        symbol,
        sector: "OTHER" as HoldSector,
      }
      const sig = runHoldEngine(bars, { ...options, fundamentals: fund })
      if (sig) signals.push(sig)
      else errors.push({ symbol, error: "INSUFFICIENT_DATA" })
    } catch (e) {
      errors.push({
        symbol,
        error: e instanceof Error ? e.message : "HOLD_ERROR",
      })
    }
  }
  signals.sort((a, b) => b.score - a.score)
  return { signals, errors }
}
