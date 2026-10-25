/**
 * Scan export — prefers pre-built rows from scan (instant, zero network).
 * Falls back to signal-only sheet if exportRows missing (old cache).
 * SpreadsheetML (.xls) — opens in Excel, no xlsx dependency (saves bundle + CPU).
 */
import type { TradingSignal } from "@/models/signal"
import type { HoldSignal } from "@/models/hold"
import type { RegimeResult } from "@/quant/regime"

type Primitive = string | number | boolean | null | undefined
type Row = Record<string, Primitive>

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function cellXml(v: Primitive): string {
  if (v == null || v === "") {
    return `<Cell><Data ss:Type="String"></Data></Cell>`
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`
  }
  if (typeof v === "boolean") {
    return `<Cell><Data ss:Type="String">${v ? "TRUE" : "FALSE"}</Data></Cell>`
  }
  const clean = String(v).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
  return `<Cell><Data ss:Type="String">${xmlEscape(clean)}</Data></Cell>`
}

function sheetXml(name: string, rows: Row[]): string {
  if (!rows.length) {
    return `<Worksheet ss:Name="${xmlEscape(name)}"><Table></Table></Worksheet>`
  }
  const keySet = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r)) keySet.add(k)
  // Prefer decision columns first
  const preferred = [
    "symbol",
    "action",
    "tradabilityScore",
    "score",
    "tradeQuality",
    "confidence",
    "setup",
    "marketRegime",
    "referenceClose",
    "entryLow",
    "entryHigh",
    "triggerPrice",
    "trigger",
    "stopLoss",
    "tp1",
    "tp2",
    "riskReward_mid",
    "riskReward_atHigh",
    "riskReward_atLow",
    "riskPct",
    "rewardPct",
    "reasons",
    "risks",
    "featureDate",
    "computedAt",
  ]
  const rest = [...keySet].filter((k) => !preferred.includes(k)).sort()
  const headers = [...preferred.filter((k) => keySet.has(k)), ...rest]
  const headerRow = `<Row>${headers.map((h) => cellXml(h)).join("")}</Row>`
  const body = rows
    .map((r) => `<Row>${headers.map((h) => cellXml(r[h])).join("")}</Row>`)
    .join("")
  return `<Worksheet ss:Name="${xmlEscape(name.substring(0, 31))}"><Table>${headerRow}${body}</Table></Worksheet>`
}

function buildWorkbookXml(sheets: { name: string; rows: Row[] }[]): string {
  const parts = sheets.map((s) => sheetXml(s.name, s.rows)).join("")
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${parts}
</Workbook>`
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function signalsToRows(signals: TradingSignal[]): Row[] {
  return signals.map((s) => ({
    symbol: s.symbol,
    action: s.action,
    tradabilityScore: s.tradabilityScore ?? s.score,
    score: s.score,
    tradeQuality: s.tradeQuality,
    confidence: s.confidence,
    setup: s.setup,
    marketRegime: String(s.marketRegime),
    referenceClose: s.referenceClose ?? null,
    entryLow: s.entryZone?.low ?? null,
    entryHigh: s.entryZone?.high ?? null,
    triggerPrice: s.triggerPrice ?? null,
    trigger: s.trigger ?? "",
    stopLoss: s.stopLoss ?? null,
    tp1: s.tp1 ?? null,
    tp2: s.tp2 ?? null,
    riskReward_mid: s.riskReward ?? null,
    riskReward_atHigh: s.riskRewardAtHigh ?? null,
    riskReward_atLow: s.riskRewardAtLow ?? null,
    riskPct: s.riskPct ?? null,
    rewardPct: s.rewardPct ?? null,
    reasons: s.reasons.join(" | "),
    risks: s.risks.join(" | "),
    featureDate: s.featureDate ?? s.date,
    computedAt: s.computedAt ?? "",
    strategyVersion: s.strategyVersion,
    live_equals_snapshot: true,
  }))
}

export interface TPlusExportMeta {
  asOf?: string
  regime?: RegimeResult | null
  universeSize?: number
  durationMs?: number
  errors?: { symbol: string; error: string }[]
  /** Precomputed at scan — preferred path */
  exportRows?: Row[]
}

/**
 * Instant export: uses exportRows from scan when available.
 * No network, no feature recompute → minimal CPU.
 */
export function exportTPlusScanToExcel(
  signals: TradingSignal[],
  meta: TPlusExportMeta = {},
  onProgress?: (p: { done: number; total: number; message?: string }) => void
): void {
  onProgress?.({ done: 0, total: 1, message: "Building workbook…" })

  const decisionRows =
    meta.exportRows && meta.exportRows.length
      ? meta.exportRows
      : signalsToRows(signals)

  // Top actionable only (BUY/WATCH) — small sheet for daily use
  const actionable = decisionRows.filter((r) => {
    const a = String(r.action ?? "")
    return a === "BUY" || a === "WATCH"
  })

  const summary: Row[] = [
    {
      asOf: meta.asOf ?? "",
      regime: meta.regime?.regime ?? "",
      universeSize: meta.universeSize ?? signals.length,
      scanDurationMs: meta.durationMs ?? null,
      totalSignals: signals.length,
      actionableCount: actionable.length,
      exportMode: meta.exportRows?.length ? "PREBUILT_AT_SCAN" : "SIGNAL_ONLY",
      note: "R:R_atHigh is conservative (fill at entry high). Rank by tradabilityScore.",
    },
  ]

  const errorRows = (meta.errors ?? []).map((e) => ({
    symbol: e.symbol,
    error: e.error,
  }))

  const xml = buildWorkbookXml([
    { name: "Summary", rows: summary },
    { name: "Top_Actionable", rows: actionable.length ? actionable : [{ note: "No BUY/WATCH in this scan" }] },
    { name: "All_Tplus", rows: decisionRows },
    ...(errorRows.length ? [{ name: "Errors", rows: errorRows }] : []),
  ])

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
  downloadBlob(
    `tplus_scan_${stamp}.xls`,
    xml,
    "application/vnd.ms-excel"
  )
  onProgress?.({ done: 1, total: 1, message: "Downloaded" })
}

/** @deprecated kept name for page imports */
export async function exportTPlusScanToExcelAsync(
  signals: TradingSignal[],
  meta: TPlusExportMeta = {},
  onProgress?: (p: { done: number; total: number; message?: string }) => void
): Promise<void> {
  exportTPlusScanToExcel(signals, meta, onProgress)
}


export interface HoldExportMeta {
  asOf?: string
  regime?: RegimeResult | null
  universeSize?: number
  durationMs?: number
  errors?: { symbol: string; error: string }[]
}

function holdSignalsToRows(signals: HoldSignal[]): Row[] {
  return signals.map((s) => ({
    symbol: s.symbol,
    date: s.date,
    engine: s.engine,
    setup: s.setup,
    action: s.action,
    score: s.score,
    tradeQuality: s.tradeQuality,
    confidence: s.confidence,
    sector: s.sector,
    marketRegime: String(s.marketRegime ?? ""),
    strategyVersion: s.strategyVersion ?? "",
    reasons: (s.reasons ?? []).join(" | "),
    risks: (s.risks ?? []).join(" | "),
    roe: s.metrics?.roe ?? null,
    roa: s.metrics?.roa ?? null,
    pe: s.metrics?.pe ?? null,
    pb: s.metrics?.pb ?? null,
    epsGrowth: s.metrics?.epsGrowth ?? null,
    revenueGrowth: s.metrics?.revenueGrowth ?? null,
    debtToEquity: s.metrics?.debtToEquity ?? null,
    ...(s.componentScores
      ? Object.fromEntries(
          Object.entries(s.componentScores).map(([k, v]) => [`comp.${k}`, v])
        )
      : {}),
  }))
}

/**
 * Hold scan Excel export (signal-level, no second network hop).
 */
export function exportHoldScanToExcel(
  signals: HoldSignal[],
  meta: HoldExportMeta = {},
  onProgress?: (p: { done: number; total: number; message?: string }) => void
): void {
  onProgress?.({ done: 0, total: 1, message: "Building Hold workbook…" })
  const rows = holdSignalsToRows(signals)
  const actionable = rows.filter((r) => {
    const a = String(r.action ?? "")
    return a === "BUY" || a === "WATCH" || a === "HOLD"
  })
  const summary: Row[] = [
    {
      asOf: meta.asOf ?? "",
      regime: meta.regime?.regime ?? "",
      universeSize: meta.universeSize ?? signals.length,
      scanDurationMs: meta.durationMs ?? null,
      totalSignals: signals.length,
      actionableCount: actionable.length,
      exportMode: "HOLD_SIGNAL",
    },
  ]
  const errorRows = (meta.errors ?? []).map((e) => ({
    symbol: e.symbol,
    error: e.error,
  }))
  const xml = buildWorkbookXml([
    { name: "Summary", rows: summary },
    {
      name: "Top_Actionable",
      rows: actionable.length ? actionable : [{ note: "No BUY/WATCH/HOLD" }],
    },
    { name: "All_Hold", rows: rows },
    ...(errorRows.length ? [{ name: "Errors", rows: errorRows }] : []),
  ])
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
  downloadBlob(`hold_scan_${stamp}.xls`, xml, "application/vnd.ms-excel")
  onProgress?.({ done: 1, total: 1, message: "Downloaded" })
}

export async function exportHoldScanToExcelAsync(
  signals: HoldSignal[],
  meta: HoldExportMeta = {},
  onProgress?: (p: { done: number; total: number; message?: string }) => void
): Promise<void> {
  exportHoldScanToExcel(signals, meta, onProgress)
}
