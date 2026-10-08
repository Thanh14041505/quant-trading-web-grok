/**
 * Default liquid-ish Vietnam equity sample for client-side scans.
 * Full market (~1500) is too heavy without workers + real API;
 * user can switch to custom list in Settings later.
 */
export const DEFAULT_LIQUID_UNIVERSE = [
  // Banks
  "VCB", "TCB", "MBB", "BID", "CTG", "VPB", "ACB", "HDB", "STB", "TPB", "LPB", "SSB",
  // Real estate
  "VIC", "VHM", "VRE", "NVL", "PDR", "DXG", "KDH", "BCM",
  // Industrials / materials
  "HPG", "HSG", "NKG", "GVR", "DGC", "DCM",
  // Tech / telecom
  "FPT", "CMG", "VGI",
  // Consumer
  "VNM", "MSN", "MWG", "PNJ", "SAB", "VHC", "ANV",
  // Securities
  "SSI", "VCI", "HCM", "VND", "SHS", "MBS",
  // Energy / infra
  "GAS", "PLX", "POW", "PVD", "GMD", "REE", "PC1",
  // Other large
  "VJC", "HVN", "BVH", "BMI", "MWG",
] as const

export type UniverseMode = "liquid" | "custom"

export interface UniverseConfig {
  mode: UniverseMode
  /** Min average value (VND) — documented for future real data */
  minAvgValue20d?: number
  customSymbols?: string[]
  exchanges?: ("HOSE" | "HNX" | "UPCOM")[]
}

const CUSTOM_KEY = "vnquant_universe_custom"
const MODE_KEY = "vnquant_universe_mode"

export function getUniverseConfig(): UniverseConfig {
  const mode = (localStorage.getItem(MODE_KEY) as UniverseMode) || "liquid"
  const raw = localStorage.getItem(CUSTOM_KEY)
  let customSymbols: string[] | undefined
  if (raw) {
    try {
      customSymbols = JSON.parse(raw) as string[]
    } catch {
      customSymbols = raw
        .split(/[\s,;]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    }
  }
  return {
    mode,
    minAvgValue20d: 5_000_000_000,
    customSymbols,
  }
}

export function setUniverseMode(mode: UniverseMode) {
  localStorage.setItem(MODE_KEY, mode)
}

export function setCustomSymbols(symbols: string[]) {
  const cleaned = [
    ...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)),
  ]
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(cleaned))
}

export function resolveUniverse(config?: UniverseConfig): string[] {
  const cfg = config ?? getUniverseConfig()
  if (cfg.mode === "custom" && cfg.customSymbols?.length) {
    return [...new Set(cfg.customSymbols.map((s) => s.toUpperCase()))]
  }
  // Dedupe default list
  return [...new Set(DEFAULT_LIQUID_UNIVERSE.map(String))]
}
