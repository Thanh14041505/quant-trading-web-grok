import type { OHLCV } from "@/models/market"
import type {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  EquityPoint,
  TradeExitReason,
} from "@/models/backtest"
import { DEFAULT_BACKTEST_CONFIG } from "@/models/backtest"
import { runTPlusEngine, TPLUS_STRATEGY_VERSION } from "@/quant/strategies"
import { classifyRegime } from "@/quant/regime"
import { buyPrice, sellPrice, buyCostAmount, sellCostAmount } from "./costs"
import { computeMetrics } from "./metrics"

interface OpenPosition {
  symbol: string
  setup: string
  score: number
  entryDate: string
  entryPrice: number
  shares: number
  stopLoss: number
  tp1?: number
  tp2?: number
  riskPerShare: number
  entryCosts: number
  sessionsHeld: number
  partialTaken: boolean
}

interface PendingEntry {
  symbol: string
  setup: string
  score: number
  stopLoss: number
  tp1?: number
  tp2?: number
  signalDate: string
}

export interface BacktestRunInput {
  seriesMap: Map<string, OHLCV[]>
  indexBars?: OHLCV[]
  config?: Partial<BacktestConfig>
  warmupBars?: number
}

/**
 * Event-driven long-only backtest (T+ engine signals).
 *
 * Anti look-ahead:
 * - Signal on day T uses only bars with date ≤ T
 * - Entry filled at day T+1 open (+ slippage/commission)
 * - Same-bar SL & TP: SL checked first (adverse path)
 */
export function runBacktest(input: BacktestRunInput): BacktestResult {
  const t0 = performance.now()
  const config: BacktestConfig = {
    ...DEFAULT_BACKTEST_CONFIG,
    ...input.config,
    costs: {
      ...DEFAULT_BACKTEST_CONFIG.costs,
      ...(input.config?.costs ?? {}),
    },
  }
  const warmup = input.warmupBars ?? 80
  const notes: string[] = [
    "ENTRY_NEXT_OPEN",
    "SL_FIRST_INTRABAR",
    "NO_LOOKAHEAD_PREFIX",
  ]

  const dateSet = new Set<string>()
  for (const bars of input.seriesMap.values()) {
    for (const b of bars) dateSet.add(b.date)
  }
  const calendar = [...dateSet].sort()

  const barIndex = new Map<string, Map<string, OHLCV>>()
  for (const [sym, bars] of input.seriesMap) {
    const m = new Map<string, OHLCV>()
    for (const b of bars) m.set(b.date, b)
    barIndex.set(sym, m)
  }

  const prefixes = new Map<string, OHLCV[]>()
  for (const sym of input.seriesMap.keys()) prefixes.set(sym, [])

  let cash = config.initialCapital
  const open = new Map<string, OpenPosition>()
  const trades: BacktestTrade[] = []
  const equityCurve: EquityPoint[] = []
  let tradeSeq = 0
  const pending: PendingEntry[] = []

  for (let di = 0; di < calendar.length; di++) {
    const date = calendar[di]

    for (const [sym, idx] of barIndex) {
      const bar = idx.get(date)
      if (bar) prefixes.get(sym)!.push(bar)
    }

    const indexPrefix = input.indexBars
      ? input.indexBars.filter((b) => b.date <= date)
      : undefined

    // --- exits ---
    for (const [sym, pos] of [...open.entries()]) {
      const bar = barIndex.get(sym)?.get(date)
      if (!bar) continue
      pos.sessionsHeld++

      let exitReason: TradeExitReason | null = null
      let exitRaw = bar.close

      if (bar.low <= pos.stopLoss) {
        exitReason = "SL"
        exitRaw = pos.stopLoss
      } else if (
        config.useTp1 &&
        !pos.partialTaken &&
        pos.tp1 != null &&
        bar.high >= pos.tp1
      ) {
        const half =
          Math.floor(pos.shares / 2 / config.lotSize) * config.lotSize
        if (half >= config.lotSize) {
          bookExit({
            pos,
            shares: half,
            exitRaw: pos.tp1,
            date,
            reason: "TP1",
            config,
            trades,
            seq: () => {
              tradeSeq++
              return tradeSeq
            },
          })
          cash += sellPrice(pos.tp1, config.costs) * half
          pos.shares -= half
          pos.partialTaken = true
          pos.stopLoss = pos.entryPrice
          pos.entryCosts *= pos.shares / (pos.shares + half)
        } else {
          exitReason = "TP1"
          exitRaw = pos.tp1
        }
      } else if (pos.tp2 != null && bar.high >= pos.tp2) {
        exitReason = "TP2"
        exitRaw = pos.tp2
      } else if (pos.sessionsHeld >= config.maxHoldSessions) {
        exitReason = "TIME"
        exitRaw = bar.close
      }

      if (exitReason && pos.shares > 0) {
        bookExit({
          pos,
          shares: pos.shares,
          exitRaw,
          date,
          reason: exitReason,
          config,
          trades,
          seq: () => {
            tradeSeq++
            return tradeSeq
          },
        })
        cash += sellPrice(exitRaw, config.costs) * pos.shares
        open.delete(sym)
      }
    }

    // --- fill pending at open ---
    const nextPending: PendingEntry[] = []
    for (const pe of pending) {
      if (open.has(pe.symbol)) continue
      if (open.size >= config.maxConcurrentPositions) {
        nextPending.push(pe)
        continue
      }
      const bar = barIndex.get(pe.symbol)?.get(date)
      if (!bar) continue
      const signalIdx = calendar.indexOf(pe.signalDate)
      if (signalIdx >= 0 && di - signalIdx > 3) continue

      const riskPerShare = bar.open - pe.stopLoss
      if (riskPerShare <= 0) continue

      const equityNow = markEquity(cash, open, barIndex, date)
      const riskAmount = equityNow * config.riskPerTrade
      let shares = Math.floor(riskAmount / riskPerShare)
      const maxShares = Math.floor(
        (equityNow * config.maxPositionPct) / bar.open
      )
      shares = Math.min(shares, maxShares)
      shares = Math.floor(shares / config.lotSize) * config.lotSize
      if (shares < config.lotSize) continue

      const fill = buyPrice(bar.open, config.costs)
      if (fill * shares > cash) {
        shares = Math.floor(cash / fill / config.lotSize) * config.lotSize
        if (shares < config.lotSize) continue
      }

      const entryCosts = buyCostAmount(shares, fill, config.costs)
      cash -= fill * shares
      open.set(pe.symbol, {
        symbol: pe.symbol,
        setup: pe.setup,
        score: pe.score,
        entryDate: date,
        entryPrice: fill,
        shares,
        stopLoss: pe.stopLoss,
        tp1: pe.tp1,
        tp2: pe.tp2,
        riskPerShare: fill - pe.stopLoss,
        entryCosts,
        sessionsHeld: 0,
        partialTaken: false,
      })
    }
    pending.length = 0
    pending.push(...nextPending)

    // --- new signals (prefix only) ---
    if (di >= warmup && open.size < config.maxConcurrentPositions) {
      const regime =
        indexPrefix && indexPrefix.length >= 60
          ? classifyRegime(indexPrefix)
          : null

      const candidates: PendingEntry[] = []
      for (const [sym, prefix] of prefixes) {
        if (open.has(sym)) continue
        if (prefix.length < warmup) continue
        if (!barIndex.get(sym)?.has(date)) continue
        try {
          const sig = runTPlusEngine(prefix, {
            regime,
            indexBars: indexPrefix,
          })
          if (!sig) continue
          if (sig.action !== "BUY" && sig.action !== "WATCH") continue
          if (sig.score < config.minScore) continue
          if (sig.stopLoss == null || !sig.entryZone) continue
          if ((sig.riskReward ?? 0) < config.minRiskReward) continue
          const mid = (sig.entryZone.low + sig.entryZone.high) / 2
          if (mid - sig.stopLoss <= 0) continue
          candidates.push({
            symbol: sym,
            setup: String(sig.setup),
            score: sig.score,
            stopLoss: sig.stopLoss,
            tp1: sig.tp1,
            tp2: sig.tp2,
            signalDate: date,
          })
        } catch {
          /* isolate */
        }
      }
      candidates.sort((a, b) => b.score - a.score)
      const slots =
        config.maxConcurrentPositions - open.size - pending.length
      for (let i = 0; i < Math.min(slots, candidates.length); i++) {
        pending.push(candidates[i])
      }
    }

    equityCurve.push({
      date,
      equity: markEquity(cash, open, barIndex, date),
      cash,
      openPositions: open.size,
    })
  }

  // flatten open at end
  for (const [sym, pos] of open) {
    const bars = input.seriesMap.get(sym)
    const lastBar = bars?.[bars.length - 1]
    if (!lastBar) continue
    bookExit({
      pos,
      shares: pos.shares,
      exitRaw: lastBar.close,
      date: lastBar.date,
      reason: "END",
      config,
      trades,
      seq: () => {
        tradeSeq++
        return tradeSeq
      },
    })
    cash += sellPrice(lastBar.close, config.costs) * pos.shares
  }
  open.clear()
  if (equityCurve.length) {
    equityCurve[equityCurve.length - 1] = {
      ...equityCurve[equityCurve.length - 1],
      equity: cash,
      cash,
      openPositions: 0,
    }
  }

  return {
    config,
    trades,
    equityCurve,
    metrics: computeMetrics(trades, equityCurve, config),
    strategyVersion: TPLUS_STRATEGY_VERSION,
    asOf: new Date().toISOString(),
    durationMs: Math.round(performance.now() - t0),
    symbolsScanned: input.seriesMap.size,
    notes,
  }
}

function bookExit(args: {
  pos: OpenPosition
  shares: number
  exitRaw: number
  date: string
  reason: TradeExitReason
  config: BacktestConfig
  trades: BacktestTrade[]
  seq: () => number
}) {
  const { pos, shares, exitRaw, date, reason, config, trades, seq } = args
  const fill = sellPrice(exitRaw, config.costs)
  const exitCosts = sellCostAmount(shares, fill, config.costs)
  const entryCostShare =
    pos.shares > 0 ? pos.entryCosts * (shares / (pos.shares + (pos.partialTaken ? shares : 0) || shares)) : pos.entryCosts
  // simpler cost attribution
  const costs = (pos.entryCosts * shares) / (pos.shares || shares) + exitCosts

  trades.push({
    id: `T${seq()}`,
    symbol: pos.symbol,
    setup: pos.setup,
    score: pos.score,
    entryDate: pos.entryDate,
    exitDate: date,
    entryPrice: pos.entryPrice,
    exitPrice: fill,
    shares,
    stopLoss: pos.stopLoss,
    tp1: pos.tp1,
    tp2: pos.tp2,
    riskPerShare: pos.riskPerShare,
    rMultiple:
      pos.riskPerShare > 0 ? (fill - pos.entryPrice) / pos.riskPerShare : 0,
    grossPnl: (exitRaw - pos.entryPrice) * shares,
    costs,
    netPnl: (fill - pos.entryPrice) * shares,
    holdSessions: pos.sessionsHeld,
    exitReason: reason,
    side: "LONG",
  })
  void entryCostShare
}

function markEquity(
  cash: number,
  open: Map<string, OpenPosition>,
  barIndex: Map<string, Map<string, OHLCV>>,
  date: string
): number {
  let eq = cash
  for (const [sym, pos] of open) {
    const bar = barIndex.get(sym)?.get(date)
    eq += (bar?.close ?? pos.entryPrice) * pos.shares
  }
  return eq
}
