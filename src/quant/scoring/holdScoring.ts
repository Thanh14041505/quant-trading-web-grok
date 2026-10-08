import type {
  HoldFundamentals,
  HoldScoreWeights,
  HoldSector,
} from "@/models/hold"
import { DEFAULT_HOLD_WEIGHTS } from "@/models/hold"
import type { FeatureSnapshot } from "@/quant/features"
import type { RegimeResult } from "@/quant/regime"

export interface HoldScoreBreakdown {
  total: number
  components: Record<string, number>
  reasons: string[]
  risks: string[]
  setup: string
}

/**
 * Infer coarse sector from free-text sector/industry if provider doesn't map.
 */
export function normalizeSector(
  sector?: string,
  industry?: string
): HoldSector {
  const s = `${sector ?? ""} ${industry ?? ""}`.toLowerCase()
  if (/bank|ngân hàng|ngan hang/.test(s)) return "BANK"
  if (/securit|chứng khoán|chung khoan|broker/.test(s)) return "SECURITIES"
  if (/real estate|bất động sản|bat dong san|property/.test(s))
    return "REAL_ESTATE"
  if (/steel|thép|manufactur|industrial|hóa chất|chemical|cement/.test(s))
    return "MANUFACTURING"
  if (/retail|consumer|thực phẩm|food|beverage|dược|pharma/.test(s))
    return "CONSUMER"
  if (/oil|gas|energy|điện|power|than/.test(s)) return "ENERGY"
  if (/tech|công nghệ|software|telecom|viễn thông/.test(s)) return "TECH"
  return "OTHER"
}

export function scoreHold(
  fundamentals: HoldFundamentals,
  features: FeatureSnapshot | null,
  regime: RegimeResult | null,
  weights: HoldScoreWeights = DEFAULT_HOLD_WEIGHTS
): HoldScoreBreakdown {
  const reasons: string[] = []
  const risks: string[] = []
  const sector = normalizeSector(
    fundamentals.sector as string,
    undefined
  ) as HoldSector

  const earnings_growth = scoreGrowth(fundamentals, reasons, risks)
  const business_quality = scoreQuality(fundamentals, sector, reasons, risks)
  const balance_sheet_cash_flow = scoreBalanceSheet(
    fundamentals,
    sector,
    reasons,
    risks
  )
  const valuation = scoreValuation(fundamentals, sector, reasons, risks)
  const long_term_trend = scoreLongTermTrend(features, reasons, risks)
  const catalyst_risk = scoreCatalystRisk(fundamentals, regime, reasons, risks)

  const components: Record<string, number> = {
    earnings_growth,
    business_quality,
    balance_sheet_cash_flow,
    valuation,
    long_term_trend,
    catalyst_risk,
  }

  let total = 0
  let wsum = 0
  for (const [k, w] of Object.entries(weights) as [
    keyof HoldScoreWeights,
    number,
  ][]) {
    total += (components[k] ?? 0) * w
    wsum += w
  }
  if (wsum > 0) total /= wsum

  const setup = pickHoldSetup(components, sector)

  return {
    total: Math.round(clamp(total, 0, 100)),
    components,
    reasons: dedupe(reasons),
    risks: dedupe(risks),
    setup,
  }
}

function scoreGrowth(
  f: HoldFundamentals,
  reasons: string[],
  risks: string[]
): number {
  let s = 45
  const eps = f.epsGrowth
  const rev = f.revenueGrowth
  const profit = f.profitGrowth

  if (eps != null) {
    if (eps >= 20) {
      s += 25
      reasons.push("EPS_GROWTH_STRONG")
    } else if (eps >= 10) {
      s += 15
      reasons.push("EPS_GROWTH_SOLID")
    } else if (eps >= 0) s += 5
    else {
      s -= 15
      risks.push("EPS_DECLINING")
    }
  }
  if (rev != null) {
    if (rev >= 15) {
      s += 15
      reasons.push("REVENUE_GROWTH_STRONG")
    } else if (rev >= 5) s += 8
    else if (rev < 0) {
      s -= 10
      risks.push("REVENUE_DECLINING")
    }
  }
  if (profit != null && profit >= 15) s += 8
  return clamp(s, 0, 100)
}

function scoreQuality(
  f: HoldFundamentals,
  sector: HoldSector,
  reasons: string[],
  risks: string[]
): number {
  let s = 45

  // Banks: emphasize ROE, NIM, NPL, CASA
  if (sector === "BANK") {
    if (f.roe != null) {
      if (f.roe >= 15) {
        s += 20
        reasons.push("BANK_ROE_STRONG")
      } else if (f.roe >= 10) s += 10
      else if (f.roe < 8) {
        s -= 10
        risks.push("BANK_ROE_WEAK")
      }
    }
    if (f.nim != null) {
      if (f.nim >= 3.5) {
        s += 12
        reasons.push("NIM_HEALTHY")
      } else if (f.nim < 2.5) {
        s -= 8
        risks.push("NIM_COMPRESSED")
      }
    }
    if (f.npl != null) {
      if (f.npl <= 1.5) {
        s += 12
        reasons.push("NPL_LOW")
      } else if (f.npl > 3) {
        s -= 15
        risks.push("NPL_ELEVATED")
      }
    }
    if (f.casa != null && f.casa >= 30) {
      s += 8
      reasons.push("CASA_STRONG")
    }
    return clamp(s, 0, 100)
  }

  // Securities: ROE, brokerage franchise
  if (sector === "SECURITIES") {
    if (f.roe != null) {
      if (f.roe >= 12) {
        s += 18
        reasons.push("SEC_ROE_STRONG")
      } else if (f.roe < 6) {
        s -= 10
        risks.push("SEC_ROE_WEAK")
      }
    }
    if (f.brokerageShare != null && f.brokerageShare >= 5) {
      s += 10
      reasons.push("BROKERAGE_SHARE")
    }
    // Cyclical — slightly lower base quality confidence
    s -= 5
    return clamp(s, 0, 100)
  }

  // Real estate: focus later on balance sheet; quality = margins if any
  if (sector === "REAL_ESTATE") {
    if (f.roe != null) {
      if (f.roe >= 12) s += 12
      else if (f.roe < 5) {
        s -= 8
        risks.push("RE_ROE_WEAK")
      }
    }
    if (f.netMargin != null && f.netMargin > 15) s += 8
    return clamp(s, 0, 100)
  }

  // Generic / manufacturing / consumer
  if (f.roe != null) {
    if (f.roe >= 18) {
      s += 20
      reasons.push("ROE_EXCELLENT")
    } else if (f.roe >= 12) {
      s += 12
      reasons.push("ROE_GOOD")
    } else if (f.roe < 8) {
      s -= 10
      risks.push("ROE_LOW")
    }
  }
  if (f.roa != null) {
    if (f.roa >= 8) s += 10
    else if (f.roa < 3) s -= 5
  }
  if (f.roic != null && f.roic >= 12) {
    s += 10
    reasons.push("ROIC_STRONG")
  }
  if (f.operatingMargin != null) {
    if (f.operatingMargin >= 15) s += 8
    else if (f.operatingMargin < 5) s -= 5
  }
  if (f.grossMargin != null && f.grossMargin >= 30) s += 5

  return clamp(s, 0, 100)
}

function scoreBalanceSheet(
  f: HoldFundamentals,
  sector: HoldSector,
  reasons: string[],
  risks: string[]
): number {
  let s = 50

  if (sector === "BANK") {
    // Banks are levered by nature — de-emphasize D/E, use NPL already in quality
    if (f.npl != null && f.npl <= 2) s += 10
    return clamp(s, 0, 100)
  }

  if (sector === "REAL_ESTATE") {
    if (f.debtToEquity != null) {
      if (f.debtToEquity <= 0.8) {
        s += 15
        reasons.push("RE_LEVERAGE_MODERATE")
      } else if (f.debtToEquity > 1.5) {
        s -= 20
        risks.push("RE_HIGH_LEVERAGE")
      } else if (f.debtToEquity > 1.1) {
        s -= 8
        risks.push("RE_ELEVATED_DEBT")
      }
    }
    if (f.fcf != null && f.fcf > 0) {
      s += 12
      reasons.push("POSITIVE_FCF")
    } else if (f.fcf != null && f.fcf < 0) {
      s -= 10
      risks.push("NEGATIVE_FCF")
    }
    return clamp(s, 0, 100)
  }

  if (f.debtToEquity != null) {
    if (f.debtToEquity <= 0.5) {
      s += 15
      reasons.push("LOW_LEVERAGE")
    } else if (f.debtToEquity <= 1) s += 5
    else if (f.debtToEquity > 2) {
      s -= 18
      risks.push("HIGH_DEBT")
    } else {
      s -= 8
      risks.push("ELEVATED_DEBT")
    }
  }
  if (f.interestCoverage != null) {
    if (f.interestCoverage >= 5) s += 10
    else if (f.interestCoverage < 2) {
      s -= 15
      risks.push("WEAK_INTEREST_COVERAGE")
    }
  }
  if (f.fcf != null) {
    if (f.fcf > 0) {
      s += 12
      reasons.push("POSITIVE_FCF")
    } else {
      s -= 10
      risks.push("NEGATIVE_FCF")
    }
  }
  if (f.operatingCashFlow != null && f.operatingCashFlow > 0) s += 5

  return clamp(s, 0, 100)
}

function scoreValuation(
  f: HoldFundamentals,
  sector: HoldSector,
  reasons: string[],
  risks: string[]
): number {
  let s = 50

  // Banks: P/B primary
  if (sector === "BANK" || sector === "SECURITIES") {
    if (f.pb != null) {
      if (f.pb < 1.0) {
        s += 20
        reasons.push("PB_DISCOUNT")
      } else if (f.pb < 1.5) s += 10
      else if (f.pb > 2.5) {
        s -= 12
        risks.push("PB_EXPENSIVE")
      }
    }
    if (f.pe != null && f.pe > 0 && f.pe < 10) {
      s += 8
      reasons.push("PE_ATTRACTIVE")
    }
    return clamp(s, 0, 100)
  }

  if (f.pe != null && f.pe > 0) {
    if (f.pe < 10) {
      s += 18
      reasons.push("PE_ATTRACTIVE")
    } else if (f.pe < 15) s += 10
    else if (f.pe > 30) {
      s -= 15
      risks.push("PE_EXPENSIVE")
    } else if (f.pe > 22) s -= 6
  }
  if (f.pb != null) {
    if (f.pb < 1.2) s += 10
    else if (f.pb > 4) {
      s -= 10
      risks.push("PB_EXPENSIVE")
    }
  }
  if (f.peg != null && f.peg > 0) {
    if (f.peg < 1) {
      s += 12
      reasons.push("PEG_ATTRACTIVE")
    } else if (f.peg > 2) s -= 8
  }
  if (f.dividendYield != null && f.dividendYield >= 4) {
    s += 6
    reasons.push("DIVIDEND_YIELD")
  }

  return clamp(s, 0, 100)
}

function scoreLongTermTrend(
  features: FeatureSnapshot | null,
  reasons: string[],
  risks: string[]
): number {
  if (!features) return 50
  let s = 45
  if (features.trend.aboveEma200) {
    s += 20
    reasons.push("ABOVE_EMA200")
  } else {
    s -= 15
    risks.push("BELOW_EMA200")
  }
  if (features.trend.ema200Slope != null) {
    if (features.trend.ema200Slope > 0.001) {
      s += 12
      reasons.push("EMA200_RISING")
    } else if (features.trend.ema200Slope < -0.001) {
      s -= 12
      risks.push("EMA200_FALLING")
    }
  }
  const rs120 = features.relativeStrength.rs120
  if (rs120 != null) {
    if (rs120 > 0.05) {
      s += 15
      reasons.push("RS120_OUTPERFORM")
    } else if (rs120 < -0.05) {
      s -= 12
      risks.push("RS120_UNDERPERFORM")
    }
  }
  // Accumulation hint via CMF
  if (features.volume.cmf20 != null && features.volume.cmf20 > 0.05) {
    s += 5
    reasons.push("ACCUMULATION_HINT")
  }
  return clamp(s, 0, 100)
}

function scoreCatalystRisk(
  f: HoldFundamentals,
  regime: RegimeResult | null,
  reasons: string[],
  risks: string[]
): number {
  let s = 55
  if (regime) {
    if (regime.regime === "BULL" || regime.regime === "BULL_PULLBACK") {
      s += 15
      reasons.push(`REGIME_${regime.regime}`)
    } else if (regime.regime === "BEAR" || regime.regime === "PANIC") {
      s -= 20
      risks.push(`REGIME_${regime.regime}`)
    } else if (regime.regime === "DISTRIBUTION") {
      s -= 8
      risks.push("REGIME_DISTRIBUTION")
    }
  }
  // Placeholder: negative FCF already risked elsewhere
  if (f.epsGrowth != null && f.epsGrowth > 25 && f.pe != null && f.pe < 15) {
    s += 10
    reasons.push("GROWTH_AT_REASONABLE_PRICE")
  }
  return clamp(s, 0, 100)
}

function pickHoldSetup(
  components: Record<string, number>,
  sector: HoldSector
): string {
  const g = components.earnings_growth ?? 0
  const q = components.business_quality ?? 0
  const v = components.valuation ?? 0
  const t = components.long_term_trend ?? 0

  if (g >= 65 && q >= 60 && t >= 55) return "QUALITY_GROWTH"
  if (v >= 70 && t >= 50) return "VALUE_TREND"
  if (q >= 70 && t >= 60) return "QUALITY_COMPOUND"
  if (g >= 70 && v >= 55) return "GROWTH_REASONABLE"
  if (sector === "BANK" && q >= 60) return "BANK_QUALITY"
  if (t >= 65) return "LONG_TERM_TREND"
  return "HOLD_MIXED"
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}
function dedupe(arr: string[]) {
  return [...new Set(arr)]
}
