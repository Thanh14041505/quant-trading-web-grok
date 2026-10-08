import type { TrendFeatures } from "@/indicators/trend"
import type { MomentumFeatures } from "@/indicators/momentum"
import type { VolumeFeatures } from "@/indicators/volume"
import type { StructureFeatures } from "@/indicators/structure"
import type { RelativeStrengthFeatures } from "@/indicators/relativeStrength"
import type { IchimokuFeatures } from "@/indicators/ichimoku"
import type { DivergenceFeatures } from "@/indicators/divergence"
import type { VolumeProfileFeatures } from "@/indicators/volumeProfile"

export interface FeatureSnapshot {
  symbol: string
  date: string
  close: number
  trend: TrendFeatures
  momentum: MomentumFeatures
  volume: VolumeFeatures
  structure: StructureFeatures
  relativeStrength: RelativeStrengthFeatures
  ichimoku: IchimokuFeatures
  divergence: DivergenceFeatures
  volumeProfile: VolumeProfileFeatures
  /** Bars used for computation */
  barCount: number
}

export interface FeatureEngineOptions {
  /** Benchmark bars for RS / correlation (e.g. VNINDEX) */
  indexBars?: import("@/models/market").OHLCV[]
  /** Minimum bars required; returns null features if insufficient */
  minBars?: number
}
