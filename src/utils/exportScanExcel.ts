/**
 * Detailed scan export for Excel / AI analysis.
 * Generates SpreadsheetML (.xls) — opens natively in Excel, no npm xlsx needed.
 * Also can download CSV fallback.
 */
import type { TradingSignal } from "@/models/signal"
import type { HoldSignal } from "@/models/hold"
import type { FeatureSnapshot } from "@/quant/features"
import { computeFeatures } from "@/quant/features"
import { fetchHistoricalPrices, fetchMarketIndex } from "@/data/marketDataService"
import { runTPlusEngine, runHoldEngine, toHoldFundamentals } from "@/quant/strategies"
import type { RegimeResult } from "@/quant/regime"
import { fetchCompanyInfo, fetchFundamentals } from "@/data/marketDataService"

type Primitive = string | number | boolean | null | undefined

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

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
  const s = String(v)
  // Avoid breaking Excel with control chars
  const clean = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
  return `<Cell><Data ss:Type="String">${xmlEscape(clean)}</Data></Cell>`
}

function sheetXml(name: string, rows: Record<string, Primitive>[]): string {
  if (!rows.length) {
    return `<Worksheet ss:Name="${xmlEscape(name)}"><Table></Table></Worksheet>`
  }
  // Union of all keys, stable order: first row keys then extras
  const keySet = new Set<string>()
  for (const r of rows) {
    for (const k of Object.keys(r)) keySet.add(k)
  }
  const headers = [...keySet]
  const headerRow = `<Row>${headers.map((h) => cellXml(h)).join("")}</Row>`
  const body = rows
    .map(
      (r) =>
        `<Row>${headers.map((h) => cellXml(r[h])).join("")}</Row>`
    )
    .join("")
  return `<Worksheet ss:Name="${xmlEscape(name.substring(0, 31))}"><Table>${headerRow}${body}</Table></Worksheet>`
}

function buildWorkbookXml(sheets: { name: string; rows: Record<string, Primitive>[] }[]): string {
  const parts = sheets.map((s) => sheetXml(s.name, s.rows)).join("")
  return `<?xml version="1.0" encoding="UTF-8"?>
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

/** Flatten nested object with prefix (depth-limited). */
function flatten(
  obj: unknown,
  prefix = "",
  out: Record<string, Primitive> = {},
  depth = 0
): Record<string, Primitive> {
  if (obj == null) {
    if (prefix) out[prefix] = ""
    return out
  }
  if (typeof obj !== "object" || Array.isArray(obj)) {
    if (Array.isArray(obj)) {
      out[prefix || "value"] = obj
        .map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x)))
        .join(" | ")
    } else if (typeof obj === "number" || typeof obj === "boolean") {
      out[prefix || "value"] = obj as number | boolean
    } else {
      out[prefix || "value"] = String(obj)
    }
    return out
  }
  if (depth > 4) {
    out[prefix] = JSON.stringify(obj)
    return out
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v != null && typeof v === "object" && !Array.isArray(v)) {
      flatten(v, key, out, depth + 1)
    } else if (Array.isArray(v)) {
      out[key] = v
        .map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x)))
        .join(" | ")
    } else if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") {
      out[key] = v as Primitive
    } else if (v == null) {
      out[key] = ""
    } else {
      out[key] = String(v)
    }
  }
  return out
}

function featureRow(f: FeatureSnapshot | null): Record<string, Primitive> {
  if (!f) return { features_ok: false }
  const flat = flatten(f, "feat")
  return { features_ok: true, ...flat }
}

function aiNarrativeTplus(
  s: TradingSignal,
  f: FeatureSnapshot | null
): string {
  const parts = [
    `SYMBOL ${s.symbol}`,
    `ENGINE T+ | SETUP ${s.setup} | ACTION ${s.action}`,
    `SCORE ${s.score} | QUALITY ${s.tradeQuality} | CONF ${s.confidence}`,
    `REGIME ${s.marketRegime}`,
    s.entryZone
      ? `ENTRY ${s.entryZone.low}–${s.entryZone.high}`
      : "ENTRY n/a",
    s.trigger ? `TRIGGER ${s.trigger}` : "",
    s.stopLoss != null ? `SL ${s.stopLoss}` : "",
    s.tp1 != null ? `TP1 ${s.tp1}` : "",
    s.tp2 != null ? `TP2 ${s.tp2}` : "",
    s.riskReward != null ? `R:R ${s.riskReward}` : "",
    `REASONS: ${(s.reasons ?? []).join("; ")}`,
    `RISKS: ${(s.risks ?? []).join("; ")}`,
  ]
  if (f) {
    parts.push(
      `PRICE close=${f.close} bars=${f.barCount}`,
      `TREND ema20=${f.trend.ema20 ?? "n/a"} ema50=${f.trend.ema50 ?? "n/a"} ema200=${f.trend.ema200 ?? "n/a"}`,
      `MOM rsi=${f.momentum.rsi14 ?? "n/a"} macdHist=${f.momentum.macdHist ?? "n/a"}`,
      `VOL rvol=${f.volume.rvol20 ?? "n/a"}`,
      `STRUCT high20=${f.structure.high20 ?? "n/a"} low20=${f.structure.low20 ?? "n/a"}`,
      `RS rs20=${f.relativeStrength.rs20 ?? "n/a"} rs60=${f.relativeStrength.rs60 ?? "n/a"}`,
      `ICHI ${JSON.stringify(f.ichimoku)}`,
      `DIV ${JSON.stringify(f.divergence)}`,
      `VP ${JSON.stringify(f.volumeProfile)}`
    )
  }
  if (s.componentScores) {
    parts.push(`COMPONENTS ${JSON.stringify(s.componentScores)}`)
  }
  return parts.filter(Boolean).join(" || ")
}

function aiNarrativeHold(s: HoldSignal, f: FeatureSnapshot | null): string {
  const parts = [
    `SYMBOL ${s.symbol}`,
    `ENGINE HOLD | SETUP ${s.setup} | ACTION ${s.action}`,
    `SCORE ${s.score} | QUALITY ${s.tradeQuality} | CONF ${s.confidence}`,
    `SECTOR ${s.sector} | REGIME ${s.marketRegime}`,
    s.upsideHint ? `UPSIDE ${s.upsideHint}` : "",
    s.catalyst ? `CATALYST ${s.catalyst}` : "",
    `METRICS ${JSON.stringify(s.metrics)}`,
    `REASONS: ${(s.reasons ?? []).join("; ")}`,
    `RISKS: ${(s.risks ?? []).join("; ")}`,
  ]
  if (f) {
    parts.push(
      `PRICE close=${f.close}`,
      `TREND ${JSON.stringify(f.trend)}`,
      `RS ${JSON.stringify(f.relativeStrength)}`
    )
  }
  if (s.componentScores) {
    parts.push(`COMPONENTS ${JSON.stringify(s.componentScores)}`)
  }
  return parts.filter(Boolean).join(" || ")
}

export interface ExportProgress {
  done: number
  total: number
  message?: string
}

/**
 * Build rich T+ rows: signal fields + recomputed features (stock-page parity) + AI blob.
 */
export async function buildTPlusExportRows(
  signals: TradingSignal[],
  options?: {
    regime?: RegimeResult | null
    onProgress?: (p: ExportProgress) => void
    lookbackDays?: number
  }
): Promise<Record<string, Primitive>[]> {
  const end = daysAgo(0)
  const start = daysAgo(options?.lookbackDays ?? 300)
  let indexBars: Awaited<ReturnType<typeof fetchMarketIndex>>["data"] = []
  try {
    const idx = await fetchMarketIndex("VNINDEX", start, end)
    indexBars = idx.data
  } catch {
    /* optional */
  }

  const rows: Record<string, Primitive>[] = []
  const total = signals.length

  for (let i = 0; i < signals.length; i++) {
    const s = signals[i]!
    options?.onProgress?.({
      done: i,
      total,
      message: `Enrich ${s.symbol}`,
    })

    let feat: FeatureSnapshot | null = null
    let live: TradingSignal | null = null
    try {
      const res = await fetchHistoricalPrices(s.symbol, start, end)
      if (res.data.length >= 30) {
        feat = computeFeatures(res.data, { indexBars })
        live = runTPlusEngine(res.data, {
          regime: options?.regime ?? null,
          indexBars,
        })
      }
    } catch {
      /* keep signal-only row */
    }

    const base: Record<string, Primitive> = {
      symbol: s.symbol,
      date: s.date,
      engine: s.engine,
      setup: s.setup,
      action: s.action,
      score: s.score,
      tradeQuality: s.tradeQuality,
      confidence: s.confidence,
      marketRegime: String(s.marketRegime),
      strategyVersion: s.strategyVersion,
      entryLow: s.entryZone?.low,
      entryHigh: s.entryZone?.high,
      trigger: s.trigger ?? "",
      stopLoss: s.stopLoss,
      tp1: s.tp1,
      tp2: s.tp2,
      riskReward: s.riskReward,
      reasons: (s.reasons ?? []).join(" | "),
      risks: (s.risks ?? []).join(" | "),
      componentScores: s.componentScores
        ? JSON.stringify(s.componentScores)
        : "",
    }

    // Prefer live recompute for stock-page parity when available
    if (live) {
      base.live_action = live.action
      base.live_score = live.score
      base.live_setup = live.setup
      base.live_stopLoss = live.stopLoss
      base.live_tp1 = live.tp1
      base.live_tp2 = live.tp2
      base.live_riskReward = live.riskReward
      base.live_tradeQuality = live.tradeQuality
      base.live_confidence = live.confidence
      base.live_reasons = (live.reasons ?? []).join(" | ")
      base.live_risks = (live.risks ?? []).join(" | ")
      base.live_trigger = live.trigger ?? ""
      if (live.entryZone) {
        base.live_entryLow = live.entryZone.low
        base.live_entryHigh = live.entryZone.high
      }
      if (live.componentScores) {
        Object.assign(base, flatten(live.componentScores, "live_comp"))
      }
    }

    Object.assign(base, featureRow(feat))
    base.ai_narrative = aiNarrativeTplus(live ?? s, feat)
    rows.push(base)
  }

  options?.onProgress?.({ done: total, total, message: "done" })
  return rows
}

export async function buildHoldExportRows(
  signals: HoldSignal[],
  options?: {
    regime?: RegimeResult | null
    onProgress?: (p: ExportProgress) => void
    lookbackDays?: number
  }
): Promise<Record<string, Primitive>[]> {
  const end = daysAgo(0)
  const start = daysAgo(options?.lookbackDays ?? 400)
  let indexBars: Awaited<ReturnType<typeof fetchMarketIndex>>["data"] = []
  try {
    const idx = await fetchMarketIndex("VNINDEX", start, end)
    indexBars = idx.data
  } catch {
    /* optional */
  }

  const rows: Record<string, Primitive>[] = []
  const total = signals.length

  for (let i = 0; i < signals.length; i++) {
    const s = signals[i]!
    options?.onProgress?.({
      done: i,
      total,
      message: `Enrich ${s.symbol}`,
    })

    let feat: FeatureSnapshot | null = null
    let live: HoldSignal | null = null
    try {
      const [priceRes, fundRes, companyRes] = await Promise.all([
        fetchHistoricalPrices(s.symbol, start, end),
        fetchFundamentals(s.symbol).catch(() => null),
        fetchCompanyInfo(s.symbol).catch(() => null),
      ])
      if (priceRes.data.length >= 30) {
        feat = computeFeatures(priceRes.data, { indexBars })
        const fundamentals = fundRes?.data
          ? toHoldFundamentals(
              s.symbol,
              fundRes.data as unknown as Record<string, unknown>,
              companyRes?.data?.sector ?? companyRes?.data?.industry
            )
          : { symbol: s.symbol, sector: s.sector }
        live = runHoldEngine(priceRes.data, {
          fundamentals,
          regime: options?.regime ?? null,
          indexBars,
        })
      }
    } catch {
      /* signal-only */
    }

    const base: Record<string, Primitive> = {
      symbol: s.symbol,
      date: s.date,
      engine: s.engine,
      setup: s.setup,
      action: s.action,
      score: s.score,
      tradeQuality: s.tradeQuality,
      confidence: s.confidence,
      sector: String(s.sector),
      marketRegime: String(s.marketRegime),
      strategyVersion: s.strategyVersion,
      upsideHint: s.upsideHint ?? "",
      catalyst: s.catalyst ?? "",
      reasons: (s.reasons ?? []).join(" | "),
      risks: (s.risks ?? []).join(" | "),
      metrics_roe: s.metrics.roe,
      metrics_roa: s.metrics.roa,
      metrics_pe: s.metrics.pe,
      metrics_pb: s.metrics.pb,
      metrics_epsGrowth: s.metrics.epsGrowth,
      metrics_revenueGrowth: s.metrics.revenueGrowth,
      metrics_debtToEquity: s.metrics.debtToEquity,
      metrics_fcf: s.metrics.fcf,
      metrics_rs120: s.metrics.rs120,
      metrics_aboveEma200:
        s.metrics.aboveEma200 == null ? "" : s.metrics.aboveEma200,
      componentScores: s.componentScores
        ? JSON.stringify(s.componentScores)
        : "",
    }

    if (live) {
      base.live_action = live.action
      base.live_score = live.score
      base.live_setup = live.setup
      base.live_reasons = (live.reasons ?? []).join(" | ")
      base.live_risks = (live.risks ?? []).join(" | ")
      Object.assign(base, flatten(live.metrics, "live_metrics"))
      if (live.componentScores) {
        Object.assign(base, flatten(live.componentScores, "live_comp"))
      }
    }

    Object.assign(base, featureRow(feat))
    base.ai_narrative = aiNarrativeHold(live ?? s, feat)
    rows.push(base)
  }

  options?.onProgress?.({ done: total, total, message: "done" })
  return rows
}

function metaRows(meta: {
  kind: string
  asOf?: string
  regime?: string
  universeSize?: number
  signalCount: number
  durationMs?: number
  notes?: string
}): Record<string, Primitive>[] {
  return [
    {
      key: "kind",
      value: meta.kind,
    },
    { key: "exported_at", value: new Date().toISOString() },
    { key: "scan_asOf", value: meta.asOf ?? "" },
    { key: "regime", value: meta.regime ?? "" },
    { key: "universeSize", value: meta.universeSize ?? "" },
    { key: "signalCount", value: meta.signalCount },
    { key: "durationMs", value: meta.durationMs ?? "" },
    {
      key: "notes",
      value:
        meta.notes ??
        "Sheet Signals = full scan detail + features (stock-page parity). Column ai_narrative is a single-line dump for LLM summarization.",
    },
    {
      key: "ai_instruction",
      value:
        "You are a Vietnam equities quant assistant. Read every row. Prefer ACTION BUY/WATCH with honest R:R and clear reasons. Flag risks. Do not invent prices. Summarize top ideas with entry/SL/TP1/TP2/R:R and why.",
    },
  ]
}

function readmeRows(): Record<string, Primitive>[] {
  return [
    {
      section: "Signals",
      description:
        "One row per symbol from scan. Includes action, score, setup, entry, SL, TP1, TP2, R:R, reasons, risks.",
    },
    {
      section: "live_*",
      description:
        "Recomputed at export time from cached/latest OHLCV (same engines as /stock/:symbol).",
    },
    {
      section: "feat.*",
      description:
        "Full FeatureSnapshot: trend, momentum, volume, structure, RS, ichimoku, divergence, volume profile.",
    },
    {
      section: "ai_narrative",
      description:
        "Concatenated human-readable blob — paste into LLM for recommendation summary.",
    },
    {
      section: "Meta",
      description: "Export timestamp, regime, counts.",
    },
  ]
}

/** Download multi-sheet .xls (SpreadsheetML) */
export function downloadExcelWorkbook(
  filename: string,
  sheets: { name: string; rows: Record<string, Primitive>[] }[]
) {
  const xml = buildWorkbookXml(sheets)
  const safe = filename.endsWith(".xls") ? filename : `${filename}.xls`
  downloadBlob(
    safe,
    xml,
    "application/vnd.ms-excel;charset=utf-8"
  )
}

/** Also offer CSV of main sheet for tools that prefer CSV */
export function downloadCsv(
  filename: string,
  rows: Record<string, Primitive>[]
) {
  if (!rows.length) return
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const esc = (v: Primitive) => {
    const s = v == null ? "" : String(v)
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [
    keys.join(","),
    ...rows.map((r) => keys.map((k) => esc(r[k])).join(",")),
  ]
  // BOM for Excel UTF-8
  downloadBlob(
    filename.endsWith(".csv") ? filename : `${filename}.csv`,
    "\uFEFF" + lines.join("\n"),
    "text/csv;charset=utf-8"
  )
}

export async function exportTPlusScanToExcel(
  signals: TradingSignal[],
  meta: {
    asOf?: string
    regime?: RegimeResult | null
    universeSize?: number
    durationMs?: number
    errors?: { symbol: string; error: string }[]
  },
  onProgress?: (p: ExportProgress) => void
) {
  const rows = await buildTPlusExportRows(signals, {
    regime: meta.regime,
    onProgress,
  })
  const regimeLabel =
    meta.regime?.regime != null ? String(meta.regime.regime) : ""
  downloadExcelWorkbook(`vnquant_tplus_${stamp()}`, [
    { name: "Signals", rows },
    {
      name: "Meta",
      rows: metaRows({
        kind: "TPLUS",
        asOf: meta.asOf,
        regime: regimeLabel,
        universeSize: meta.universeSize,
        signalCount: signals.length,
        durationMs: meta.durationMs,
      }),
    },
    { name: "README", rows: readmeRows() },
    {
      name: "Errors",
      rows: (meta.errors ?? []).map((e) => ({
        symbol: e.symbol,
        error: e.error,
      })),
    },
  ])
  // CSV twin for AI pipelines
  downloadCsv(`vnquant_tplus_${stamp()}_signals`, rows)
}

export async function exportHoldScanToExcel(
  signals: HoldSignal[],
  meta: {
    asOf?: string
    regime?: RegimeResult | null
    universeSize?: number
    durationMs?: number
    errors?: { symbol: string; error: string }[]
  },
  onProgress?: (p: ExportProgress) => void
) {
  const rows = await buildHoldExportRows(signals, {
    regime: meta.regime,
    onProgress,
  })
  const regimeLabel =
    meta.regime?.regime != null ? String(meta.regime.regime) : ""
  downloadExcelWorkbook(`vnquant_hold_${stamp()}`, [
    { name: "Signals", rows },
    {
      name: "Meta",
      rows: metaRows({
        kind: "HOLD",
        asOf: meta.asOf,
        regime: regimeLabel,
        universeSize: meta.universeSize,
        signalCount: signals.length,
        durationMs: meta.durationMs,
      }),
    },
    { name: "README", rows: readmeRows() },
    {
      name: "Errors",
      rows: (meta.errors ?? []).map((e) => ({
        symbol: e.symbol,
        error: e.error,
      })),
    },
  ])
  downloadCsv(`vnquant_hold_${stamp()}_signals`, rows)
}

function stamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}
