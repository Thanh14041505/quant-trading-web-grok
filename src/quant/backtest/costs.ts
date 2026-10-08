import type { BacktestCosts } from "@/models/backtest"

/** Buy: pay more (slippage up) + commission */
export function buyPrice(raw: number, costs: BacktestCosts): number {
  return raw * (1 + costs.slippageRate) * (1 + costs.commissionRate)
}

/** Sell: receive less (slippage down) − commission − tax */
export function sellPrice(raw: number, costs: BacktestCosts): number {
  return (
    raw *
    (1 - costs.slippageRate) *
    (1 - costs.commissionRate) *
    (1 - costs.sellTaxRate)
  )
}

export function buyCostAmount(
  shares: number,
  fillPrice: number,
  costs: BacktestCosts
): number {
  // Approximate explicit cost component
  const notional = shares * fillPrice
  return notional * (costs.commissionRate + costs.slippageRate)
}

export function sellCostAmount(
  shares: number,
  fillPrice: number,
  costs: BacktestCosts
): number {
  const notional = shares * fillPrice
  return (
    notional *
    (costs.commissionRate + costs.slippageRate + costs.sellTaxRate)
  )
}
