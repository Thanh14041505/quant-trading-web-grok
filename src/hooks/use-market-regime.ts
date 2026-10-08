import { useMemo } from "react"
import { useMarketIndex } from "./use-market-data"
import { classifyRegime, type RegimeResult } from "@/quant/regime"

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export function useMarketRegime(): {
  regime: RegimeResult | null
  isLoading: boolean
  fromCache: boolean
  cacheSource?: string
  refetch: () => void
} {
  const end = daysAgo(0)
  const start = daysAgo(400)
  const indexQ = useMarketIndex("VNINDEX", start, end)

  const regime = useMemo(() => {
    if (!indexQ.data || indexQ.data.length < 60) return null
    return classifyRegime(indexQ.data)
  }, [indexQ.data])

  return {
    regime,
    isLoading: indexQ.isLoading,
    fromCache: indexQ.fromCache,
    cacheSource: indexQ.cacheSource,
    refetch: () => indexQ.refetch(),
  }
}
