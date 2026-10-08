import { useMemo } from "react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/common/card"
import { Badge } from "@/components/common/badge"
import { Button } from "@/components/common/button"
import {
  Activity,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  RefreshCw,
} from "lucide-react"
import { useMarketIndex } from "@/hooks/use-market-data"
import { useMarketRegime } from "@/hooks/use-market-regime"
import { getDataProvider } from "@/data/providers"
import type { MarketRegime } from "@/models/market"

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function regimeColor(r: MarketRegime): string {
  switch (r) {
    case "BULL":
      return "text-success"
    case "BULL_PULLBACK":
      return "text-success/80"
    case "SIDEWAYS":
      return "text-muted-foreground"
    case "DISTRIBUTION":
      return "text-warning"
    case "BEAR":
      return "text-destructive"
    case "PANIC":
      return "text-destructive"
    default:
      return "text-foreground"
  }
}

function regimeBadgeVariant(
  r: MarketRegime
): "success" | "warning" | "destructive" | "secondary" | "outline" {
  switch (r) {
    case "BULL":
    case "BULL_PULLBACK":
      return "success"
    case "DISTRIBUTION":
      return "warning"
    case "BEAR":
    case "PANIC":
      return "destructive"
    default:
      return "secondary"
  }
}

export function DashboardPage() {
  const end = daysAgo(0)
  const start = daysAgo(60)

  const vnindexQ = useMarketIndex("VNINDEX", start, end)
  const vn30Q = useMarketIndex("VN30", start, end)
  const { regime, isLoading: regimeLoading, fromCache, cacheSource, refetch } =
    useMarketRegime()

  const vnindexBars = vnindexQ.data ?? []
  const vn30Bars = vn30Q.data ?? []

  const stats = useMemo(() => {
    const last = vnindexBars[vnindexBars.length - 1]
    const prev = vnindexBars[vnindexBars.length - 2]
    const last30 = vn30Bars[vn30Bars.length - 1]
    const prev30 = vn30Bars[vn30Bars.length - 2]
    const changePct = (a?: number, b?: number) =>
      a != null && b != null && b !== 0 ? ((a - b) / b) * 100 : null
    return {
      vnindex: last?.close,
      vnindexChg: changePct(last?.close, prev?.close),
      vn30: last30?.close,
      vn30Chg: changePct(last30?.close, prev30?.close),
      bars: vnindexBars.length,
    }
  }, [vnindexBars, vn30Bars])

  const loading = vnindexQ.isLoading || vn30Q.isLoading || regimeLoading
  const providerName = getDataProvider().name

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Market Dashboard</h2>
          <p className="text-muted-foreground">
            Regime-aware overview of Vietnam market
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Badge variant="outline">{providerName}</Badge>
          {fromCache && (
            <Badge variant="secondary">cache: {cacheSource}</Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              vnindexQ.refetch()
              vn30Q.refetch()
              refetch()
            }}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Regime banner */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Market Regime</CardTitle>
            <div className="flex items-center gap-2">
              {regime && (
                <>
                  <Badge variant={regimeBadgeVariant(regime.regime)}>
                    {regime.regime}
                  </Badge>
                  <Badge variant="outline">
                    confidence {regime.confidence}
                  </Badge>
                  <Badge variant="secondary">score {regime.score}</Badge>
                </>
              )}
              {!regime && !loading && (
                <Badge variant="outline">Insufficient data</Badge>
              )}
              {loading && <Badge variant="secondary">Loading…</Badge>}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4">
            <div
              className={`text-3xl font-bold ${
                regime ? regimeColor(regime.regime) : "text-muted-foreground"
              }`}
            >
              {regime?.regime ?? "—"}
            </div>
            <div className="text-sm text-muted-foreground">
              {regime
                ? `As of ${regime.asOf} · Multi-factor (trend, ADX, vol, volume${
                    regime.inputs.breadth ? ", breadth" : ""
                  })`
                : "Need ≥ 60 VNINDEX sessions"}
            </div>
          </div>

          {regime && (
            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Positive</div>
                <ul className="space-y-0.5">
                  {regime.reasons.length === 0 && (
                    <li className="text-muted-foreground">—</li>
                  )}
                  {regime.reasons.map((r) => (
                    <li key={r} className="text-success">
                      ✓ {r}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Risks</div>
                <ul className="space-y-0.5">
                  {regime.risks.length === 0 && (
                    <li className="text-muted-foreground">—</li>
                  )}
                  {regime.risks.map((r) => (
                    <li key={r} className="text-warning">
                      ⚠ {r}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">VNINDEX</CardTitle>
            {(stats.vnindexChg ?? 0) >= 0 ? (
              <TrendingUp className="h-4 w-4 text-success" />
            ) : (
              <TrendingDown className="h-4 w-4 text-destructive" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.vnindex != null ? stats.vnindex.toFixed(2) : "—"}
            </div>
            <p
              className={`text-xs ${
                (stats.vnindexChg ?? 0) >= 0 ? "text-success" : "text-destructive"
              }`}
            >
              {stats.vnindexChg != null
                ? `${stats.vnindexChg >= 0 ? "+" : ""}${stats.vnindexChg.toFixed(2)}%`
                : "—"}{" "}
              (last session)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">VN30</CardTitle>
            {(stats.vn30Chg ?? 0) >= 0 ? (
              <TrendingUp className="h-4 w-4 text-success" />
            ) : (
              <TrendingDown className="h-4 w-4 text-destructive" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.vn30 != null ? stats.vn30.toFixed(2) : "—"}
            </div>
            <p
              className={`text-xs ${
                (stats.vn30Chg ?? 0) >= 0 ? "text-success" : "text-destructive"
              }`}
            >
              {stats.vn30Chg != null
                ? `${stats.vn30Chg >= 0 ? "+" : ""}${stats.vn30Chg.toFixed(2)}%`
                : "—"}{" "}
              (last session)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">% Above EMA20</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {regime?.inputs.breadth?.pctAboveEma20 != null
                ? `${regime.inputs.breadth.pctAboveEma20.toFixed(0)}%`
                : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              {regime?.inputs.breadth
                ? `n=${regime.inputs.breadth.sampleSize}`
                : "Breadth needs universe scan"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ADX / Vol</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {regime?.inputs.adx != null ? regime.inputs.adx.toFixed(1) : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              vol20{" "}
              {regime?.inputs.volatility20 != null
                ? `${(regime.inputs.volatility20 * 100).toFixed(2)}%`
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Regime Inputs</CardTitle>
            <CardDescription>Key factors used in classification</CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {regime ? (
              <>
                <Row
                  label="Close vs EMA50"
                  value={
                    regime.inputs.ema50 != null
                      ? regime.inputs.close > regime.inputs.ema50
                        ? "Above"
                        : "Below"
                      : "—"
                  }
                />
                <Row
                  label="Close vs EMA200"
                  value={
                    regime.inputs.ema200 != null
                      ? regime.inputs.close > regime.inputs.ema200
                        ? "Above"
                        : "Below"
                      : "—"
                  }
                />
                <Row
                  label="EMA50 slope"
                  value={
                    regime.inputs.ema50Slope != null
                      ? `${(regime.inputs.ema50Slope * 100).toFixed(2)}%`
                      : "—"
                  }
                />
                <Row
                  label="Ret 5d / 20d"
                  value={`${
                    regime.inputs.ret5 != null
                      ? (regime.inputs.ret5 * 100).toFixed(1)
                      : "—"
                  }% / ${
                    regime.inputs.ret20 != null
                      ? (regime.inputs.ret20 * 100).toFixed(1)
                      : "—"
                  }%`}
                />
                <Row
                  label="RVOL20"
                  value={
                    regime.inputs.rvol20 != null
                      ? regime.inputs.rvol20.toFixed(2)
                      : "—"
                  }
                />
              </>
            ) : (
              <p className="text-muted-foreground">No regime data yet</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Warnings</CardTitle>
            <CardDescription>Market risk signals</CardDescription>
          </CardHeader>
          <CardContent>
            {regime && regime.risks.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {regime.risks.map((r) => (
                  <li key={r} className="flex items-start gap-2 text-warning">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    {r}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <span>
                  {regime
                    ? "No major regime risks flagged."
                    : "Load market data to evaluate risks."}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
