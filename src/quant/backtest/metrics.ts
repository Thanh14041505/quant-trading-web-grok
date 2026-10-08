import type {
  BacktestTrade,
  EquityPoint,
  BacktestMetrics,
  BacktestConfig,
} from "@/models/backtest"

export function computeMetrics(
  trades: BacktestTrade[],
  equityCurve: EquityPoint[],
  config: BacktestConfig
): BacktestMetrics {
  const finalEquity =
    equityCurve.length > 0
      ? equityCurve[equityCurve.length - 1].equity
      : config.initialCapital
  const totalReturn =
    (finalEquity - config.initialCapital) / config.initialCapital

  // Max drawdown
  let peak = -Infinity
  let maxDd = 0
  let ddStart = 0
  let maxDdDuration = 0
  let currentDdStart = 0
  for (let i = 0; i < equityCurve.length; i++) {
    const eq = equityCurve[i].equity
    if (eq > peak) {
      peak = eq
      currentDdStart = i
    }
    const dd = peak > 0 ? (peak - eq) / peak : 0
    if (dd > maxDd) {
      maxDd = dd
      ddStart = currentDdStart
      maxDdDuration = i - ddStart
    }
  }

  const wins = trades.filter((t) => t.netPnl > 0)
  const losses = trades.filter((t) => t.netPnl <= 0)
  const grossWin = wins.reduce((a, t) => a + t.netPnl, 0)
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.netPnl, 0))
  const profitFactor =
    grossLoss > 0 ? grossWin / grossLoss : wins.length > 0 ? Infinity : 0

  const avgWin = wins.length ? grossWin / wins.length : 0
  const avgLoss = losses.length
    ? losses.reduce((a, t) => a + t.netPnl, 0) / losses.length
    : 0
  const expectancy =
    trades.length > 0
      ? trades.reduce((a, t) => a + t.netPnl, 0) / trades.length
      : 0
  const avgR =
    trades.length > 0
      ? trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length
      : 0
  const avgHold =
    trades.length > 0
      ? trades.reduce((a, t) => a + t.holdSessions, 0) / trades.length
      : 0
  const totalCosts = trades.reduce((a, t) => a + t.costs, 0)

  // CAGR from first to last equity date
  let cagr: number | null = null
  if (equityCurve.length >= 2) {
    const d0 = new Date(equityCurve[0].date).getTime()
    const d1 = new Date(equityCurve[equityCurve.length - 1].date).getTime()
    const years = (d1 - d0) / (365.25 * 24 * 3600 * 1000)
    if (years > 0.05 && finalEquity > 0) {
      cagr = Math.pow(finalEquity / config.initialCapital, 1 / years) - 1
    }
  }

  // Sharpe-like from daily equity returns
  let sharpeLike: number | null = null
  if (equityCurve.length > 30) {
    const rets: number[] = []
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1].equity
      if (prev > 0) rets.push((equityCurve[i].equity - prev) / prev)
    }
    if (rets.length > 10) {
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length
      const variance =
        rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length
      const std = Math.sqrt(variance)
      if (std > 0) sharpeLike = (mean / std) * Math.sqrt(252)
    }
  }

  return {
    totalReturn,
    cagr,
    maxDrawdown: maxDd,
    maxDrawdownDuration: maxDdDuration,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: Number.isFinite(profitFactor) ? profitFactor : 99,
    expectancy,
    avgR,
    avgWin,
    avgLoss,
    tradeCount: trades.length,
    winCount: wins.length,
    lossCount: losses.length,
    sharpeLike,
    avgHoldSessions: avgHold,
    totalCosts,
    finalEquity,
  }
}
