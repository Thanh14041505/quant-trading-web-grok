export { detectTPlusSetup } from "./tplusSetups"
export type { SetupDetection } from "./tplusSetups"
export {
  runTPlusEngine,
  runTPlusScan,
  TPLUS_STRATEGY_VERSION,
} from "./tplusEngine"
export type { TPlusEngineOptions } from "./tplusEngine"

export {
  runHoldEngine,
  runHoldEngineWithProvider,
  runHoldScan,
  toHoldFundamentals,
  HOLD_STRATEGY_VERSION,
} from "./holdEngine"
export type { HoldEngineOptions } from "./holdEngine"
