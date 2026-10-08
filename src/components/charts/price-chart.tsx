import { useMemo } from "react"
import type { OHLCV } from "@/models/market"
import { emaSeries } from "@/indicators/trend"
import { cn } from "@/lib/utils"

export interface ChartMarker {
  date: string
  price: number
  label: string
  color: string
}

interface PriceChartProps {
  bars: OHLCV[]
  height?: number
  showEma20?: boolean
  showEma50?: boolean
  showEma200?: boolean
  markers?: ChartMarker[]
  className?: string
}

/**
 * Lightweight SVG candlestick chart with EMA overlays.
 * Works without external chart deps (npm install optional for LWC later).
 */
export function PriceChart({
  bars,
  height = 360,
  showEma20 = true,
  showEma50 = true,
  showEma200 = true,
  markers = [],
  className,
}: PriceChartProps) {
  const sorted = useMemo(
    () => [...bars].sort((a, b) => a.date.localeCompare(b.date)),
    [bars]
  )

  if (sorted.length < 2) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground",
          className
        )}
        style={{ height }}
      >
        Not enough bars to chart
      </div>
    )
  }

  const closes = sorted.map((b) => b.close)
  const e20 = showEma20 ? emaSeries(closes, 20) : []
  const e50 = showEma50 ? emaSeries(closes, 50) : []
  const e200 = showEma200 ? emaSeries(closes, 200) : []

  const pad = { top: 16, right: 56, bottom: 48, left: 8 }
  const width = 800
  const volH = 64
  const priceH = height - volH - 8
  const innerW = width - pad.left - pad.right
  const innerH = priceH - pad.top - pad.bottom

  let minP = Infinity
  let maxP = -Infinity
  for (const b of sorted) {
    minP = Math.min(minP, b.low)
    maxP = Math.max(maxP, b.high)
  }
  for (const series of [e20, e50, e200]) {
    for (const v of series) {
      if (v != null) {
        minP = Math.min(minP, v)
        maxP = Math.max(maxP, v)
      }
    }
  }
  for (const m of markers) {
    minP = Math.min(minP, m.price)
    maxP = Math.max(maxP, m.price)
  }
  const span = maxP - minP || 1
  minP -= span * 0.03
  maxP += span * 0.03

  const maxVol = Math.max(...sorted.map((b) => b.volume), 1)
  const n = sorted.length
  const slot = innerW / n
  const bodyW = Math.max(1, slot * 0.65)

  const xAt = (i: number) => pad.left + i * slot + slot / 2
  const yAt = (p: number) =>
    pad.top + ((maxP - p) / (maxP - minP)) * innerH

  const linePath = (series: (number | null)[]) => {
    let d = ""
    let started = false
    for (let i = 0; i < series.length; i++) {
      const v = series[i]
      if (v == null) continue
      const x = xAt(i)
      const y = yAt(v)
      if (!started) {
        d += `M ${x} ${y}`
        started = true
      } else d += ` L ${x} ${y}`
    }
    return d
  }

  // Y-axis ticks
  const ticks = 5
  const yTicks: number[] = []
  for (let i = 0; i <= ticks; i++) {
    yTicks.push(minP + ((maxP - minP) * i) / ticks)
  }

  // X labels — ~6 dates
  const xLabels: { i: number; date: string }[] = []
  const step = Math.max(1, Math.floor(n / 6))
  for (let i = 0; i < n; i += step) {
    xLabels.push({ i, date: sorted[i].date.slice(5) })
  }
  if (xLabels[xLabels.length - 1]?.i !== n - 1) {
    xLabels.push({ i: n - 1, date: sorted[n - 1].date.slice(5) })
  }

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        style={{ minHeight: height }}
      >
        {/* grid */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={yAt(t)}
              y2={yAt(t)}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
            <text
              x={width - pad.right + 4}
              y={yAt(t) + 3}
              className="fill-muted-foreground"
              fontSize={10}
            >
              {t.toFixed(1)}
            </text>
          </g>
        ))}

        {/* EMA lines */}
        {showEma200 && (
          <path d={linePath(e200)} fill="none" stroke="#a78bfa" strokeWidth={1.2} />
        )}
        {showEma50 && (
          <path d={linePath(e50)} fill="none" stroke="#38bdf8" strokeWidth={1.2} />
        )}
        {showEma20 && (
          <path d={linePath(e20)} fill="none" stroke="#fbbf24" strokeWidth={1.2} />
        )}

        {/* Candles */}
        {sorted.map((b, i) => {
          const x = xAt(i)
          const up = b.close >= b.open
          const color = up ? "#22c55e" : "#ef4444"
          const yO = yAt(b.open)
          const yC = yAt(b.close)
          const yH = yAt(b.high)
          const yL = yAt(b.low)
          const top = Math.min(yO, yC)
          const bot = Math.max(yO, yC)
          return (
            <g key={b.date}>
              <line x1={x} x2={x} y1={yH} y2={yL} stroke={color} strokeWidth={1} />
              <rect
                x={x - bodyW / 2}
                y={top}
                width={bodyW}
                height={Math.max(1, bot - top)}
                fill={color}
              />
            </g>
          )
        })}

        {/* Markers (entry / SL / TP) */}
        {markers.map((m) => {
          const y = yAt(m.price)
          return (
            <g key={`${m.label}-${m.price}`}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
                stroke={m.color}
                strokeDasharray="4 3"
                strokeWidth={1}
                opacity={0.85}
              />
              <text
                x={width - pad.right + 4}
                y={y - 2}
                fontSize={9}
                fill={m.color}
              >
                {m.label} {m.price.toFixed(1)}
              </text>
            </g>
          )
        })}

        {/* Volume */}
        {sorted.map((b, i) => {
          const x = xAt(i)
          const up = b.close >= b.open
          const vh = (b.volume / maxVol) * (volH - 8)
          return (
            <rect
              key={`v-${b.date}`}
              x={x - bodyW / 2}
              y={priceH + volH - vh}
              width={bodyW}
              height={vh}
              fill={up ? "#22c55e" : "#ef4444"}
              opacity={0.35}
            />
          )
        })}

        {/* X labels */}
        {xLabels.map(({ i, date }) => (
          <text
            key={date + i}
            x={xAt(i)}
            y={priceH - 8}
            textAnchor="middle"
            fontSize={10}
            className="fill-muted-foreground"
          >
            {date}
          </text>
        ))}

        {/* Legend */}
        <g transform={`translate(${pad.left}, 12)`}>
          {showEma20 && (
            <>
              <line x1={0} x2={12} y1={0} y2={0} stroke="#fbbf24" strokeWidth={2} />
              <text x={16} y={3} fontSize={10} className="fill-muted-foreground">
                EMA20
              </text>
            </>
          )}
          {showEma50 && (
            <>
              <line x1={60} x2={72} y1={0} y2={0} stroke="#38bdf8" strokeWidth={2} />
              <text x={76} y={3} fontSize={10} className="fill-muted-foreground">
                EMA50
              </text>
            </>
          )}
          {showEma200 && (
            <>
              <line x1={120} x2={132} y1={0} y2={0} stroke="#a78bfa" strokeWidth={2} />
              <text x={136} y={3} fontSize={10} className="fill-muted-foreground">
                EMA200
              </text>
            </>
          )}
        </g>
      </svg>
    </div>
  )
}
