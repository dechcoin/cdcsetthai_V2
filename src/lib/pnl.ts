/**
 * Pure spot PnL math shared by the server engine, routes and the dashboard.
 *
 * Thai stocks (SET) trade as SPOT only — there is NO leverage, margin or
 * liquidation. A LONG owns `amount` shares bought at `entryPrice`; the PnL is
 * simply `shares × price change`. A SHORT (paper only) is the mirror image.
 */

export interface SpotPnl {
  /** Percentage return on the invested capital (unleveraged). */
  pnlPercent: number;
  /** Absolute profit/loss in THB. */
  pnlThb: number;
}

export function calculateSpotPnl(
  side: 'LONG' | 'SHORT',
  entryPrice: number,
  currentPrice: number,
  amount: number
): SpotPnl {
  if (!entryPrice || !amount || !currentPrice) return { pnlPercent: 0, pnlThb: 0 };
  const priceChange = side === 'SHORT' ? entryPrice - currentPrice : currentPrice - entryPrice;
  return {
    pnlPercent: (priceChange / entryPrice) * 100,
    pnlThb: amount * priceChange,
  };
}
