import { useMemo } from "react"
import type { EquityPoint } from "@/models/backtest"
import { cn } from "@/lib/utils"

interface EquityChartProps {
  data: EquityPoint[]
  initialCapital: number
  height?: number
  className?: string
}

export function EquityChart({
  data,
  initialCapital,
  height = 220,
  className,
}: EquityChartProps) {
  const path = useMemo(() => {
    if (data.length < 2) return null
    const w = 800
    const pad = { t: 12, r: 12, b: 28, l: 56 }
    const innerW = w - pad.l - pad.r
    const innerH = height - pad.t - pad.b
    let min = Infinity
    let max = -Infinity
    for (const p of data) {
      min = Math.min(min, p.equity)
      max = Math.max(max, p.equity)
    }
    min = Math.min(min, initialCapital)
    max = Math.max(max, initialCapital)
    const span = max - min || 1
    min -= span * 0.02
    max += span * 0.02

    const xAt = (i: number) => pad.l + (i / (data.length - 1)) * innerW
    const yAt = (v: number) => pad.t + ((max - v) / (max - min)) * innerH

    let d = ""
    data.forEach((p, i) => {
      const x = xAt(i)
      const y = yAt(p.equity)
      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`
    })

    // baseline capital
    const baseY = yAt(initialCapital)
    const ticks = 4
    const yTicks: number[] = []
    for (let i = 0; i <= ticks; i++) {
      yTicks.push(min + ((max - min) * i) / ticks)
    }

    return { d, baseY, yTicks, yAt, xAt, w, pad, min, max }
  }, [data, initialCapital, height])

  if (!path || data.length < 2) {
    return (
      <div
        className={cn(
          "flex items-center justify-center text-sm text-muted-foreground border border-dashed rounded-md",
          className
        )}
        style={{ height }}
      >
        No equity data
      </div>
    )
  }

  const last = data[data.length - 1]
  const up = last.equity >= initialCapital

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <svg viewBox={`0 0 ${path.w} ${height}`} className="w-full h-auto">
        {path.yTicks.map((t) => (
          <g key={t}>
            <line
              x1={path.pad.l}
              x2={path.w - path.pad.r}
              y1={path.yAt(t)}
              y2={path.yAt(t)}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
            <text
              x={path.pad.l - 6}
              y={path.yAt(t) + 3}
              textAnchor="end"
              fontSize={9}
              className="fill-muted-foreground"
            >
              {(t / 1e9).toFixed(2)}B
            </text>
          </g>
        ))}
        <line
          x1={path.pad.l}
          x2={path.w - path.pad.r}
          y1={path.baseY}
          y2={path.baseY}
          stroke="currentColor"
          strokeOpacity={0.25}
          strokeDasharray="4 3"
        />
        <path
          d={path.d}
          fill="none"
          stroke={up ? "#22c55e" : "#ef4444"}
          strokeWidth={1.5}
        />
        <text
          x={path.pad.l}
          y={height - 8}
          fontSize={10}
          className="fill-muted-foreground"
        >
          {data[0].date}
        </text>
        <text
          x={path.w - path.pad.r}
          y={height - 8}
          textAnchor="end"
          fontSize={10}
          className="fill-muted-foreground"
        >
          {last.date}
        </text>
      </svg>
    </div>
  )
}
