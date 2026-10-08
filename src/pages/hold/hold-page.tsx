import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
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
  runHoldScanner,
  loadCachedScan,
  type ScanProgress,
  type HoldScanResult,
} from "@/data/scannerService"
import type { HoldSignal } from "@/models/hold"
import { HOLD_STRATEGY_VERSION } from "@/quant/strategies"
import { resolveUniverse } from "@/config/universe"

type SortKey = "score" | "symbol" | "sector" | "setup" | "action"

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
    case "NO_TRADE":
      return "destructive"
    default:
      return "outline"
  }
}

function fmt(n?: number, d = 1) {
  if (n == null || Number.isNaN(n)) return "—"
  return n.toFixed(d)
}

export function HoldPage() {
  const [result, setResult] = useState<HoldScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [minScore, setMinScore] = useState(0)
  const [filterAction, setFilterAction] = useState("")
  const [filterSector, setFilterSector] = useState("")
  const [search, setSearch] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("score")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  useEffect(() => {
    void (async () => {
      const cached = await loadCachedScan("hold")
      if (cached && cached.kind === "hold") setResult(cached)
    })()
  }, [])

  const runScan = useCallback(async (forceRefresh: boolean) => {
    setLoading(true)
    setProgress({
      phase: "regime",
      done: 0,
      total: resolveUniverse().length,
      cached: 0,
      fresh: 0,
      failed: 0,
    })
    try {
      const res = await runHoldScanner({
        forceRefresh,
        onProgress: setProgress,
      })
      setResult(res)
    } finally {
      setLoading(false)
    }
  }, [])

  const signals = result?.signals ?? []

  const filtered = useMemo(() => {
    let list = signals.filter((s) => {
      if (search && !s.symbol.includes(search.toUpperCase())) return false
      if (minScore && s.score < minScore) return false
      if (filterAction && s.action !== filterAction) return false
      if (filterSector && String(s.sector) !== filterSector) return false
      return true
    })
    list = [...list].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1
      const av = a[sortKey as keyof HoldSignal]
      const bv = b[sortKey as keyof HoldSignal]
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir
    })
    return list
  }, [signals, search, minScore, filterAction, filterSector, sortKey, sortDir])

  const sectors = useMemo(
    () => [...new Set(signals.map((s) => String(s.sector)))].sort(),
    [signals]
  )

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir(key === "symbol" || key === "sector" ? "asc" : "desc")
    }
  }

  const regimeLabel = result?.regime?.regime ?? "—"
  const pct =
    progress && progress.total
      ? Math.round((100 * progress.done) / progress.total)
      : 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Hold Scanner</h2>
          <p className="text-muted-foreground">
            Quality · Growth · Valuation · Trend · {HOLD_STRATEGY_VERSION}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">Regime: {regimeLabel}</Badge>
          {result?.fromCache && <Badge variant="secondary">cached result</Badge>}
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void runScan(false)}
          >
            Load / Scan
          </Button>
          <Button onClick={() => void runScan(true)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Scanning…" : "Force Refresh"}
          </Button>
        </div>
      </div>

      {loading && progress && (
        <Card>
          <CardContent className="py-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>
                {progress.message ??
                  (progress.phase === "loading"
                    ? "Loading prices & fundamentals…"
                    : progress.phase)}
              </span>
              <span className="text-muted-foreground">
                {progress.done}/{progress.total} · {pct}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground flex gap-3">
              <span>{progress.cached} price-cached</span>
              <span>{progress.fresh} fresh</span>
              <span className="text-warning">{progress.failed} failed</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Hold Candidates</CardTitle>
            <div className="flex gap-2 text-xs text-muted-foreground">
              <span>{filtered.length} shown</span>
              <span>·</span>
              <span>{signals.length} signals</span>
              {result && (
                <>
                  <span>·</span>
                  <span>universe {result.universeSize}</span>
                  <span>·</span>
                  <span>{result.durationMs}ms</span>
                </>
              )}
            </div>
          </div>
          <CardDescription>
            Cache-first · sector-aware ranking · client-side filter/sort
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Search"
              className="w-28"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Min score"
              className="w-28"
              value={minScore || ""}
              onChange={(e) => setMinScore(Number(e.target.value) || 0)}
            />
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
            >
              <option value="">All actions</option>
              <option value="BUY">BUY</option>
              <option value="WATCH">WATCH</option>
              <option value="HOLD">HOLD</option>
              <option value="WAIT">WAIT</option>
              <option value="NO_TRADE">NO_TRADE</option>
            </select>
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={filterSector}
              onChange={(e) => setFilterSector(e.target.value)}
            >
              <option value="">All sectors</option>
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-2 py-2 font-medium">#</th>
                  <Th label="Symbol" k="symbol" sortKey={sortKey} onSort={toggleSort} />
                  <Th label="Sector" k="sector" sortKey={sortKey} onSort={toggleSort} />
                  <Th label="Setup" k="setup" sortKey={sortKey} onSort={toggleSort} />
                  <Th label="Action" k="action" sortKey={sortKey} onSort={toggleSort} />
                  <Th label="Score" k="score" sortKey={sortKey} onSort={toggleSort} />
                  <th className="px-2 py-2 font-medium">ROE</th>
                  <th className="px-2 py-2 font-medium">EPS G</th>
                  <th className="px-2 py-2 font-medium">PE</th>
                  <th className="px-2 py-2 font-medium">PB</th>
                  <th className="px-2 py-2 font-medium">D/E</th>
                  <th className="px-2 py-2 font-medium">EMA200</th>
                  <th className="px-2 py-2 font-medium">RS120</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={13}
                      className="px-3 py-8 text-center text-muted-foreground"
                    >
                      {loading
                        ? "Scanning…"
                        : "No results — click Load / Scan or Force Refresh"}
                    </td>
                  </tr>
                )}
                {filtered.map((s, i) => (
                  <tr key={s.symbol} className="border-b hover:bg-muted/30">
                    <td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-1.5 font-medium">
                      <Link
                        to={`/stock/${s.symbol}`}
                        className="text-primary hover:underline"
                      >
                        {s.symbol}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 text-xs">{s.sector}</td>
                    <td className="px-2 py-1.5 text-xs">{s.setup}</td>
                    <td className="px-2 py-1.5">
                      <Badge variant={actionVariant(s.action)} className="text-[10px]">
                        {s.action}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 font-medium">{s.score}</td>
                    <td className="px-2 py-1.5 text-xs">{fmt(s.metrics.roe)}</td>
                    <td className="px-2 py-1.5 text-xs">{fmt(s.metrics.epsGrowth)}</td>
                    <td className="px-2 py-1.5 text-xs">{fmt(s.metrics.pe)}</td>
                    <td className="px-2 py-1.5 text-xs">{fmt(s.metrics.pb, 2)}</td>
                    <td className="px-2 py-1.5 text-xs">
                      {fmt(s.metrics.debtToEquity, 2)}
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {s.metrics.aboveEma200 == null
                        ? "—"
                        : s.metrics.aboveEma200
                          ? "Above"
                          : "Below"}
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {s.metrics.rs120 != null
                        ? `${(s.metrics.rs120 * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered[0] && (
            <div className="text-xs text-muted-foreground space-y-1">
              <div>
                Top: <strong>{filtered[0].symbol}</strong> · {filtered[0].setup} ·{" "}
                {filtered[0].action} · Q={filtered[0].tradeQuality} · C=
                {filtered[0].confidence}
              </div>
              <div>✓ {filtered[0].reasons.slice(0, 6).join(" · ") || "—"}</div>
              <div>⚠ {filtered[0].risks.slice(0, 4).join(" · ") || "—"}</div>
              {filtered[0].upsideHint && <div>Upside: {filtered[0].upsideHint}</div>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Th({
  label,
  k,
  sortKey,
  onSort,
}: {
  label: string
  k: SortKey
  sortKey: SortKey
  onSort: (k: SortKey) => void
}) {
  return (
    <th
      className="px-2 py-2 font-medium cursor-pointer select-none hover:text-primary"
      onClick={() => onSort(k)}
    >
      {label}
      {sortKey === k ? " *" : ""}
    </th>
  )
}
