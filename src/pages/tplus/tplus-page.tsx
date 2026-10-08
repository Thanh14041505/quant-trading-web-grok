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
  runTPlusScanner,
  loadCachedScan,
  type ScanProgress,
  type TPlusScanResult,
} from "@/data/scannerService"
import type { TradingSignal } from "@/models/signal"
import { resolveUniverse } from "@/config/universe"

type SortKey =
  | "score"
  | "symbol"
  | "setup"
  | "action"
  | "riskReward"
  | "confidence"

function actionVariant(
  a: string
): "success" | "secondary" | "outline" | "warning" | "destructive" {
  switch (a) {
    case "BUY":
      return "success"
    case "WATCH":
      return "secondary"
    case "WAIT":
      return "outline"
    case "NO_TRADE":
      return "destructive"
    default:
      return "outline"
  }
}

export function TPlusPage() {
  const [result, setResult] = useState<TPlusScanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [minScore, setMinScore] = useState(0)
  const [filterAction, setFilterAction] = useState("")
  const [filterSetup, setFilterSetup] = useState("")
  const [search, setSearch] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("score")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  // Load cache on mount
  useEffect(() => {
    void (async () => {
      const cached = await loadCachedScan("tplus")
      if (cached && cached.kind === "tplus") setResult(cached)
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
      const res = await runTPlusScanner({
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
      if (filterSetup && s.setup !== filterSetup) return false
      return true
    })
    list = [...list].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1
      const av = a[sortKey as keyof TradingSignal]
      const bv = b[sortKey as keyof TradingSignal]
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir
    })
    return list
  }, [signals, search, minScore, filterAction, filterSetup, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir(key === "symbol" ? "asc" : "desc")
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
          <h2 className="text-2xl font-bold tracking-tight">T+ Scanner</h2>
          <p className="text-muted-foreground">
            Short-term setups (3–15 sessions) · TPLUS_MULTI_v1
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
                    ? "Loading symbols…"
                    : progress.phase === "computing"
                      ? "Computing signals…"
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
              <span>{progress.cached} cached</span>
              <span>{progress.fresh} fresh</span>
              <span className="text-warning">{progress.failed} failed</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Results</CardTitle>
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
              {(result?.errors.length ?? 0) > 0 && (
                <>
                  <span>·</span>
                  <span className="text-warning">
                    {result!.errors.length} errors
                  </span>
                </>
              )}
            </div>
          </div>
          <CardDescription>
            Opens cached scan instantly · Force Refresh recomputes · Client filter/sort
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Search symbol"
              className="w-32"
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
              <option value="WAIT">WAIT</option>
              <option value="NO_TRADE">NO_TRADE</option>
            </select>
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={filterSetup}
              onChange={(e) => setFilterSetup(e.target.value)}
            >
              <option value="">All setups</option>
              <option value="BREAKOUT">BREAKOUT</option>
              <option value="PULLBACK">PULLBACK</option>
              <option value="MOMENTUM_CONTINUATION">MOMENTUM</option>
              <option value="RSI_DIVERGENCE_REVERSAL">RSI DIV</option>
              <option value="VSA_REVERSAL">VSA</option>
              <option value="MEAN_REVERSION">MEAN REV</option>
              <option value="NONE">NONE</option>
            </select>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-2 py-2 font-medium">#</th>
                  <Th label="Symbol" k="symbol" sortKey={sortKey} onSort={toggleSort} />
                  <Th label="Setup" k="setup" sortKey={sortKey} onSort={toggleSort} />
                  <Th label="Action" k="action" sortKey={sortKey} onSort={toggleSort} />
                  <Th label="Score" k="score" sortKey={sortKey} onSort={toggleSort} />
                  <th className="px-2 py-2 font-medium">Quality</th>
                  <Th label="Conf" k="confidence" sortKey={sortKey} onSort={toggleSort} />
                  <th className="px-2 py-2 font-medium">Entry</th>
                  <th className="px-2 py-2 font-medium">SL</th>
                  <th className="px-2 py-2 font-medium">TP1</th>
                  <Th label="R:R" k="riskReward" sortKey={sortKey} onSort={toggleSort} />
                  <th className="px-2 py-2 font-medium">Regime</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={12}
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
                    <td className="px-2 py-1.5 text-xs">{s.setup}</td>
                    <td className="px-2 py-1.5">
                      <Badge variant={actionVariant(s.action)} className="text-[10px]">
                        {s.action}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5 font-medium">{s.score}</td>
                    <td className="px-2 py-1.5 text-xs">{s.tradeQuality}</td>
                    <td className="px-2 py-1.5 text-xs">{s.confidence}</td>
                    <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                      {s.entryZone
                        ? `${s.entryZone.low}–${s.entryZone.high}`
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-xs">{s.stopLoss ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{s.tp1 ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">
                      {s.riskReward != null ? s.riskReward.toFixed(1) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-xs">{s.marketRegime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered[0] && (
            <div className="text-xs text-muted-foreground space-y-1">
              <div>
                Top: <strong>{filtered[0].symbol}</strong> · {filtered[0].setup} ·{" "}
                {filtered[0].action}
              </div>
              <div>✓ {filtered[0].reasons.slice(0, 6).join(" · ") || "—"}</div>
              <div>⚠ {filtered[0].risks.slice(0, 4).join(" · ") || "—"}</div>
              {filtered[0].trigger && <div>Trigger: {filtered[0].trigger}</div>}
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
