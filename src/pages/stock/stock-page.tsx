import { useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/common/card"
import { Badge } from "@/components/common/badge"
import { Button } from "@/components/common/button"
import { PriceChart, type ChartMarker } from "@/components/charts/price-chart"
import {
  useHistoricalPrices,
  useMarketIndex,
  useCompanyInfo,
  useFundamentals,
} from "@/hooks/use-market-data"
import { useMarketRegime } from "@/hooks/use-market-regime"
import { computeFeatures } from "@/quant/features"
import { runTPlusEngine } from "@/quant/strategies"
import { runHoldEngine, toHoldFundamentals } from "@/quant/strategies"
import type { HoldFundamentals } from "@/models/hold"

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function fmt(n: number | null | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return "—"
  return n.toFixed(digits)
}

function pct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—"
  return `${(n * 100).toFixed(1)}%`
}

function actionVariant(
  a: string
): "success" | "secondary" | "outline" | "warning" | "destructive" {
  switch (a) {
    case "BUY":
      return "success"
    case "WATCH":
    case "HOLD":
      return "secondary"
    case "WAIT":
      return "outline"
    default:
      return "destructive"
  }
}

export function StockPage() {
  const { symbol } = useParams<{ symbol: string }>()
  const sym = (symbol ?? "").toUpperCase()
  const end = daysAgo(0)
  const start = daysAgo(400)

  const [showEma20, setShowEma20] = useState(true)
  const [showEma50, setShowEma50] = useState(true)
  const [showEma200, setShowEma200] = useState(true)

  const priceQ = useHistoricalPrices(sym, start, end)
  const indexQ = useMarketIndex("VNINDEX", start, end)
  const companyQ = useCompanyInfo(sym)
  const fundQ = useFundamentals(sym)
  const { regime } = useMarketRegime()

  const features = useMemo(() => {
    if (!priceQ.data || priceQ.data.length < 30) return null
    return computeFeatures(priceQ.data, { indexBars: indexQ.data })
  }, [priceQ.data, indexQ.data])

  const tplus = useMemo(() => {
    if (!priceQ.data || priceQ.data.length < 30) return null
    return runTPlusEngine(priceQ.data, {
      regime,
      indexBars: indexQ.data,
    })
  }, [priceQ.data, indexQ.data, regime])

  const hold = useMemo(() => {
    if (!priceQ.data || priceQ.data.length < 30) return null
    const fundamentals: HoldFundamentals = fundQ.data
      ? toHoldFundamentals(
          sym,
          fundQ.data as unknown as Record<string, unknown>,
          companyQ.data?.sector ?? companyQ.data?.industry
        )
      : { symbol: sym, sector: "OTHER" }
    return runHoldEngine(priceQ.data, {
      fundamentals,
      regime,
      indexBars: indexQ.data,
    })
  }, [priceQ.data, fundQ.data, companyQ.data, indexQ.data, regime, sym])

  const markers: ChartMarker[] = useMemo(() => {
    if (!tplus || !priceQ.data?.length) return []
    const lastDate = priceQ.data[priceQ.data.length - 1].date
    const m: ChartMarker[] = []
    if (tplus.entryZone) {
      m.push({
        date: lastDate,
        price: (tplus.entryZone.low + tplus.entryZone.high) / 2,
        label: "Entry",
        color: "#3b82f6",
      })
    }
    if (tplus.stopLoss != null) {
      m.push({
        date: lastDate,
        price: tplus.stopLoss,
        label: "SL",
        color: "#ef4444",
      })
    }
    if (tplus.tp1 != null) {
      m.push({
        date: lastDate,
        price: tplus.tp1,
        label: "TP1",
        color: "#22c55e",
      })
    }
    if (tplus.tp2 != null) {
      m.push({
        date: lastDate,
        price: tplus.tp2,
        label: "TP2",
        color: "#16a34a",
      })
    }
    return m
  }, [tplus, priceQ.data])

  const last = priceQ.data?.[priceQ.data.length - 1]
  const prev = priceQ.data?.[priceQ.data.length - 2]
  const chg =
    last && prev && prev.close
      ? ((last.close - prev.close) / prev.close) * 100
      : null

  const loading = priceQ.isLoading

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-bold tracking-tight">{sym}</h2>
            {companyQ.data?.exchange && (
              <Badge variant="outline">{companyQ.data.exchange}</Badge>
            )}
            {companyQ.data?.sector && (
              <Badge variant="secondary">{companyQ.data.sector}</Badge>
            )}
            {features && (
              <Badge variant="outline">{features.structure.state}</Badge>
            )}
            {regime && (
              <Badge variant="outline">Regime {regime.regime}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {companyQ.data?.name ?? "—"}
            {last && (
              <>
                {" · "}
                <span className="text-foreground font-medium">
                  {fmt(last.close)}
                </span>
                {chg != null && (
                  <span
                    className={
                      chg >= 0 ? "text-success ml-1" : "text-destructive ml-1"
                    }
                  >
                    {chg >= 0 ? "+" : ""}
                    {chg.toFixed(2)}%
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {priceQ.fromCache && (
            <Badge variant="secondary">cache: {priceQ.cacheSource}</Badge>
          )}
          <Link
            to="/tplus"
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent"
          >
            T+ Scanner
          </Link>
          <Link
            to="/hold"
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent"
          >
            Hold Scanner
          </Link>
        </div>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Price & Volume</CardTitle>
            <div className="flex gap-3 text-xs">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showEma20}
                  onChange={(e) => setShowEma20(e.target.checked)}
                />
                EMA20
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showEma50}
                  onChange={(e) => setShowEma50(e.target.checked)}
                />
                EMA50
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showEma200}
                  onChange={(e) => setShowEma200(e.target.checked)}
                />
                EMA200
              </label>
            </div>
          </div>
          <CardDescription>
            {loading
              ? "Loading…"
              : priceQ.data
                ? `${priceQ.data.length} sessions`
                : "No data"}
            {markers.length > 0 && " · T+ entry/SL/TP overlays"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {priceQ.data && priceQ.data.length >= 2 ? (
            <PriceChart
              bars={priceQ.data}
              height={380}
              showEma20={showEma20}
              showEma50={showEma50}
              showEma200={showEma200}
              markers={markers}
            />
          ) : (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground border border-dashed rounded-md">
              {loading ? "Loading OHLCV…" : "No chart data"}
            </div>
          )}
        </CardContent>
      </Card>

      {/* T+ and Hold signals */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">T+ Signal</CardTitle>
              {tplus && (
                <Badge variant={actionVariant(tplus.action)}>{tplus.action}</Badge>
              )}
            </div>
            <CardDescription>
              {tplus
                ? `${tplus.setup} · score ${tplus.score} · ${tplus.strategyVersion}`
                : "Insufficient data"}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {tplus ? (
              <>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <Row label="Quality" value={tplus.tradeQuality} />
                  <Row label="Confidence" value={tplus.confidence} />
                  <Row
                    label="Entry"
                    value={
                      tplus.entryZone
                        ? `${tplus.entryZone.low}–${tplus.entryZone.high}`
                        : "—"
                    }
                  />
                  <Row label="Trigger" value={tplus.trigger ?? "—"} />
                  <Row label="SL" value={fmt(tplus.stopLoss)} />
                  <Row label="TP1 / TP2" value={`${fmt(tplus.tp1)} / ${fmt(tplus.tp2)}`} />
                  <Row label="R:R" value={fmt(tplus.riskReward, 2)} />
                  <Row label="Regime" value={String(tplus.marketRegime)} />
                </div>
                <div className="pt-2 space-y-1 text-xs">
                  <div className="text-success">
                    ✓ {tplus.reasons.slice(0, 6).join(" · ") || "—"}
                  </div>
                  <div className="text-warning">
                    ⚠ {tplus.risks.slice(0, 4).join(" · ") || "—"}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">No T+ signal</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Hold Signal</CardTitle>
              {hold && (
                <Badge variant={actionVariant(hold.action)}>{hold.action}</Badge>
              )}
            </div>
            <CardDescription>
              {hold
                ? `${hold.setup} · score ${hold.score} · ${hold.sector}`
                : "Insufficient data"}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {hold ? (
              <>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <Row label="Quality" value={hold.tradeQuality} />
                  <Row label="Confidence" value={hold.confidence} />
                  <Row label="ROE" value={fmt(hold.metrics.roe)} />
                  <Row label="EPS growth" value={fmt(hold.metrics.epsGrowth)} />
                  <Row label="PE / PB" value={`${fmt(hold.metrics.pe)} / ${fmt(hold.metrics.pb, 2)}`} />
                  <Row label="D/E" value={fmt(hold.metrics.debtToEquity, 2)} />
                  <Row
                    label="EMA200"
                    value={
                      hold.metrics.aboveEma200 == null
                        ? "—"
                        : hold.metrics.aboveEma200
                          ? "Above"
                          : "Below"
                    }
                  />
                  <Row
                    label="RS120"
                    value={
                      hold.metrics.rs120 != null
                        ? pct(hold.metrics.rs120)
                        : "—"
                    }
                  />
                </div>
                <div className="pt-2 space-y-1 text-xs">
                  <div className="text-success">
                    ✓ {hold.reasons.slice(0, 6).join(" · ") || "—"}
                  </div>
                  <div className="text-warning">
                    ⚠ {hold.risks.slice(0, 4).join(" · ") || "—"}
                  </div>
                  {hold.upsideHint && <div>Upside: {hold.upsideHint}</div>}
                  {hold.catalyst && <div>Catalyst: {hold.catalyst}</div>}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">No Hold signal</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Feature panels */}
      {features && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <FeatureCard title="Trend">
            <Row label="EMA20" value={fmt(features.trend.ema20)} />
            <Row label="EMA50" value={fmt(features.trend.ema50)} />
            <Row label="EMA200" value={fmt(features.trend.ema200)} />
            <Row label="ADX" value={fmt(features.trend.adx)} />
            <Row label="DI+ / DI−" value={`${fmt(features.trend.diPlus)} / ${fmt(features.trend.diMinus)}`} />
            <Row label="Above EMA50" value={features.trend.aboveEma50 ? "Yes" : "No"} />
            <Row label="Above EMA200" value={features.trend.aboveEma200 ? "Yes" : "No"} />
            <Row
              label="Structure swings"
              value={[
                features.trend.recentHH && "HH",
                features.trend.recentHL && "HL",
                features.trend.recentLH && "LH",
                features.trend.recentLL && "LL",
              ]
                .filter(Boolean)
                .join(" ") || "—"}
            />
          </FeatureCard>

          <FeatureCard title="Momentum">
            <Row label="RSI14" value={fmt(features.momentum.rsi14)} />
            <Row label="RSI7" value={fmt(features.momentum.rsi7)} />
            <Row label="MACD" value={fmt(features.momentum.macd)} />
            <Row label="MACD Hist" value={fmt(features.momentum.macdHist)} />
            <Row label="MFI14" value={fmt(features.momentum.mfi14)} />
            <Row label="ROC20" value={fmt(features.momentum.roc20)} />
            <Row label="Stoch %K/%D" value={`${fmt(features.momentum.stochK)} / ${fmt(features.momentum.stochD)}`} />
          </FeatureCard>

          <FeatureCard title="Volume / VSA">
            <Row label="RVOL20" value={fmt(features.volume.rvol20)} />
            <Row label="RVOL60" value={fmt(features.volume.rvol60)} />
            <Row label="CMF20" value={fmt(features.volume.cmf20, 3)} />
            <Row label="OBV slope" value={fmt(features.volume.obvSlope, 4)} />
            <Row label="CLV20" value={fmt(features.volume.clv20, 3)} />
            <Row label="VSA" value={features.volume.vsaPattern} />
            <Row label="Up vol ratio" value={fmt(features.volume.upVolumeRatio, 2)} />
          </FeatureCard>

          <FeatureCard title="Structure">
            <Row label="State" value={features.structure.state} />
            <Row label="Range pos 20" value={pct(features.structure.rangePosition20)} />
            <Row label="Range pos 50" value={pct(features.structure.rangePosition50)} />
            <Row label="Range pos 120" value={pct(features.structure.rangePosition120)} />
            <Row label="20D H / L" value={`${fmt(features.structure.high20)} / ${fmt(features.structure.low20)}`} />
            <Row label="50D H / L" value={`${fmt(features.structure.high50)} / ${fmt(features.structure.low50)}`} />
            <Row label="200D H / L" value={`${fmt(features.structure.high200)} / ${fmt(features.structure.low200)}`} />
            <Row label="Dist 50H" value={pct(features.structure.distanceFromHigh50)} />
          </FeatureCard>

          <FeatureCard title="Relative Strength">
            <Row label="RS20 vs index" value={pct(features.relativeStrength.rs20)} />
            <Row label="RS60" value={pct(features.relativeStrength.rs60)} />
            <Row label="RS120" value={pct(features.relativeStrength.rs120)} />
            <Row label="Corr20" value={fmt(features.relativeStrength.corr20, 3)} />
            <Row label="Beta20" value={fmt(features.relativeStrength.beta20, 3)} />
            <Row label="Beta up/down 20" value={`${fmt(features.relativeStrength.betaUp20, 2)} / ${fmt(features.relativeStrength.betaDown20, 2)}`} />
          </FeatureCard>

          <FeatureCard title="Ichimoku">
            <Row label="Cloud" value={features.ichimoku.cloudPosition} />
            <Row label="Tenkan" value={fmt(features.ichimoku.tenkan)} />
            <Row label="Kijun" value={fmt(features.ichimoku.kijun)} />
            <Row label="Senkou A/B" value={`${fmt(features.ichimoku.senkouA)} / ${fmt(features.ichimoku.senkouB)}`} />
            <Row label="TK spread" value={pct(features.ichimoku.tkSpread)} />
            <Row
              label="Future cloud"
              value={
                features.ichimoku.futureCloudBullish == null
                  ? "—"
                  : features.ichimoku.futureCloudBullish
                    ? "Bullish"
                    : "Bearish"
              }
            />
            <Row label="Cloud thickness" value={pct(features.ichimoku.cloudThickness)} />
          </FeatureCard>

          <FeatureCard title="Divergence">
            <Row label="RSI" value={features.divergence.rsiDivergence} />
            <Row label="MACD" value={features.divergence.macdDivergence} />
          </FeatureCard>

          <FeatureCard
            title="Volume Profile"
            description="Approximate (daily OHLCV)"
          >
            <Row label="POC" value={fmt(features.volumeProfile.poc)} />
            <Row label="VAH" value={fmt(features.volumeProfile.vah)} />
            <Row label="VAL" value={fmt(features.volumeProfile.val)} />
            <Row
              label="HVN"
              value={
                features.volumeProfile.hvn.length
                  ? features.volumeProfile.hvn.map((v) => v.toFixed(1)).join(", ")
                  : "—"
              }
            />
            <Row
              label="LVN"
              value={
                features.volumeProfile.lvn.length
                  ? features.volumeProfile.lvn.map((v) => v.toFixed(1)).join(", ")
                  : "—"
              }
            />
          </FeatureCard>

          <FeatureCard title="Fundamentals">
            <Row label="ROE" value={fmt(fundQ.data?.roe as number)} />
            <Row label="ROA" value={fmt(fundQ.data?.roa as number)} />
            <Row label="PE" value={fmt(fundQ.data?.pe as number)} />
            <Row label="PB" value={fmt(fundQ.data?.pb as number, 2)} />
            <Row label="EPS growth" value={fmt(fundQ.data?.epsGrowth as number)} />
            <Row label="Rev growth" value={fmt(fundQ.data?.revenueGrowth as number)} />
            <Row label="D/E" value={fmt(fundQ.data?.debtToEquity as number, 2)} />
          </FeatureCard>
        </div>
      )}

      {!features && !loading && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Insufficient history to compute features (need ≥ 30 bars). Check data
            provider in Settings.
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right truncate max-w-[65%]">{value}</span>
    </div>
  )
}

function FeatureCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        {description && (
          <CardDescription className="text-xs">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="text-sm space-y-1">{children}</CardContent>
    </Card>
  )
}
