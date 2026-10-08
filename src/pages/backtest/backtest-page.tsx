import { useCallback, useState } from "react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/common/card"
import { Badge } from "@/components/common/badge"
import { Button } from "@/components/common/button"
import { Input } from "@/components/common/input"
import { RefreshCw } from "lucide-react"
import {
  fetchHistoricalPrices,
  fetchMarketIndex,
} from "@/data/marketDataService"
import { resolveUniverse } from "@/config/universe"
import { runBacktest } from "@/quant/backtest"
import type { BacktestResult, BacktestConfig } from "@/models/backtest"
import { DEFAULT_BACKTEST_CONFIG } from "@/models/backtest"
import type { OHLCV } from "@/models/market"
import { EquityChart } from "@/components/charts/equity-chart"

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(2)}%`
}

function fmtVnd(n: number) {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  return n.toFixed(0)
}

export function BacktestPage() {
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [capital, setCapital] = useState(DEFAULT_BACKTEST_CONFIG.initialCapital)
  const [riskPct, setRiskPct] = useState(DEFAULT_BACKTEST_CONFIG.riskPerTrade * 100)
  const [minScore, setMinScore] = useState(DEFAULT_BACKTEST_CONFIG.minScore)
  const [maxPos, setMaxPos] = useState(DEFAULT_BACKTEST_CONFIG.maxConcurrentPositions)
  const [lookback, setLookback] = useState(400)

  const run = useCallback(async () => {
    setLoading(true)
    setResult(null)
    const symbols = resolveUniverse().slice(0, 25) // cap for browser
    const end = daysAgo(0)
    const start = daysAgo(lookback)
    setProgress({ done: 0, total: symbols.length })

    try {
      const idx = await fetchMarketIndex("VNINDEX", start, end)
      const seriesMap = new Map<string, OHLCV[]>()
      for (let i = 0; i < symbols.length; i++) {
        try {
          const res = await fetchHistoricalPrices(symbols[i], start, end)
          if (res.data.length >= 80) seriesMap.set(symbols[i], res.data)
        } catch {
          /* skip */
        }
        setProgress({ done: i + 1, total: symbols.length })
      }

      const config: Partial<BacktestConfig> = {
        initialCapital: capital,
        riskPerTrade: riskPct / 100,
        minScore,
        maxConcurrentPositions: maxPos,
      }

      // Yield to UI then run compute
      await new Promise((r) => setTimeout(r, 30))
      const bt = runBacktest({
        seriesMap,
        indexBars: idx.data,
        config,
        warmupBars: 80,
      })
      setResult(bt)
    } finally {
      setLoading(false)
    }
  }, [capital, riskPct, minScore, maxPos, lookback])

  const m = result?.metrics
  const pct =
    progress.total > 0 ? Math.round((100 * progress.done) / progress.total) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Backtest</h2>
          <p className="text-muted-foreground">
            Event-driven · next-open entry · costs · no look-ahead
          </p>
        </div>
        <Button onClick={() => void run()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Running…" : "Run Backtest"}
        </Button>
      </div>

      {/* Config */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Configuration</CardTitle>
          <CardDescription>
            Client-side only · universe capped for browser performance
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <Field label="Capital (VND)">
              <Input
                type="number"
                className="w-36"
                value={capital}
                onChange={(e) => setCapital(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="Risk % / trade">
              <Input
                type="number"
                className="w-24"
                value={riskPct}
                onChange={(e) => setRiskPct(Number(e.target.value) || 1)}
              />
            </Field>
            <Field label="Min score">
              <Input
                type="number"
                className="w-24"
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="Max positions">
              <Input
                type="number"
                className="w-24"
                value={maxPos}
                onChange={(e) => setMaxPos(Number(e.target.value) || 1)}
              />
            </Field>
            <Field label="Lookback days">
              <Input
                type="number"
                className="w-24"
                value={lookback}
                onChange={(e) => setLookback(Number(e.target.value) || 200)}
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Costs: commission 0.15% · slippage 0.1% · sell tax 0.1% (each side as
            applicable)
          </p>
        </CardContent>
      </Card>

      {loading && (
        <Card>
          <CardContent className="py-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>Loading symbols…</span>
              <span className="text-muted-foreground">
                {progress.done}/{progress.total} · {pct}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {result && m && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Total return"
              value={fmtPct(m.totalReturn)}
              good={m.totalReturn >= 0}
            />
            <Metric
              label="CAGR"
              value={m.cagr != null ? fmtPct(m.cagr) : "—"}
              good={(m.cagr ?? 0) >= 0}
            />
            <Metric
              label="Max drawdown"
              value={fmtPct(m.maxDrawdown)}
              good={m.maxDrawdown < 0.15}
            />
            <Metric
              label="Sharpe-like"
              value={m.sharpeLike != null ? m.sharpeLike.toFixed(2) : "—"}
            />
            <Metric label="Win rate" value={fmtPct(m.winRate)} />
            <Metric label="Profit factor" value={m.profitFactor.toFixed(2)} />
            <Metric label="Expectancy" value={fmtVnd(m.expectancy)} />
            <Metric label="Avg R" value={m.avgR.toFixed(2)} />
            <Metric label="Trades" value={String(m.tradeCount)} />
            <Metric label="Avg hold" value={`${m.avgHoldSessions.toFixed(1)}d`} />
            <Metric label="Total costs" value={fmtVnd(m.totalCosts)} />
            <Metric label="Final equity" value={fmtVnd(m.finalEquity)} />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base">Equity curve</CardTitle>
                <div className="flex gap-2 text-xs">
                  <Badge variant="outline">{result.strategyVersion}</Badge>
                  <Badge variant="secondary">{result.durationMs}ms</Badge>
                  <Badge variant="outline">
                    {result.symbolsScanned} symbols
                  </Badge>
                </div>
              </div>
              <CardDescription>
                {result.notes.join(" · ")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EquityChart
                data={result.equityCurve}
                initialCapital={result.config.initialCapital}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Trades ({result.trades.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80">
                    <tr className="border-b text-left">
                      <th className="px-2 py-2">Symbol</th>
                      <th className="px-2 py-2">Setup</th>
                      <th className="px-2 py-2">Entry</th>
                      <th className="px-2 py-2">Exit</th>
                      <th className="px-2 py-2">Reason</th>
                      <th className="px-2 py-2">R</th>
                      <th className="px-2 py-2">Net PnL</th>
                      <th className="px-2 py-2">Hold</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.length === 0 && (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-3 py-6 text-center text-muted-foreground"
                        >
                          No trades — try lowering min score or longer lookback
                        </td>
                      </tr>
                    )}
                    {result.trades.map((t) => (
                      <tr key={t.id} className="border-b hover:bg-muted/30">
                        <td className="px-2 py-1.5 font-medium">{t.symbol}</td>
                        <td className="px-2 py-1.5 text-xs">{t.setup}</td>
                        <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                          {t.entryDate}
                          <br />
                          {t.entryPrice.toFixed(2)}
                        </td>
                        <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                          {t.exitDate}
                          <br />
                          {t.exitPrice.toFixed(2)}
                        </td>
                        <td className="px-2 py-1.5 text-xs">{t.exitReason}</td>
                        <td
                          className={`px-2 py-1.5 text-xs ${
                            t.rMultiple >= 0 ? "text-success" : "text-destructive"
                          }`}
                        >
                          {t.rMultiple.toFixed(2)}
                        </td>
                        <td
                          className={`px-2 py-1.5 text-xs ${
                            t.netPnl >= 0 ? "text-success" : "text-destructive"
                          }`}
                        >
                          {fmtVnd(t.netPnl)}
                        </td>
                        <td className="px-2 py-1.5 text-xs">{t.holdSessions}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="text-xs space-y-1 block">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function Metric({
  label,
  value,
  good,
}: {
  label: string
  value: string
  good?: boolean
}) {
  return (
    <Card>
      <CardContent className="py-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={`text-lg font-semibold ${
            good === true
              ? "text-success"
              : good === false
                ? "text-destructive"
                : ""
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  )
}
