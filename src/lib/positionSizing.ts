import type { BotConfig, PaperAccount } from '../types';

/**
 * Shared position-sizing utility.
 *
 * Used by BOTH the browser dashboard (`src/App.tsx`, for manual orders so the
 * trade ticket preview matches the bot) and the Express trading engine
 * (`server/services/tradingEngine.ts`, for automated cycles). Keeping a single
 * implementation avoids the client and the server drifting apart when sizing
 * rules change.
 *
 * NOTE: this module must stay dependency-free (types + pure math only) because
 * it is bundled for the Node server build where Vite path aliases do not apply
 * — always import it with a relative path.
 */

/**
 * Calculates the order size in THB (฿) for one new position.
 *
 * Returns `0` when the account is already at `config.maxOpenPositions`, which
 * callers must treat as "no capital available for a new entry".
 *
 * Modes:
 * - `EQUAL_WEIGHT`    — split total portfolio equity into N equal slots
 * - `PERCENT_EQUITY`  — `balancePercent`% of total portfolio equity
 * - `FIXED_USDT`      — a flat `tradeAmountUsdt` budget per order
 */
export function calculateOrderSize(config: BotConfig, account: PaperAccount): number {
  const maxPositions = Math.max(1, Math.min(20, config.maxOpenPositions || 5));
  if (account.activePositions.length >= maxPositions) return 0;

  const totalPositionsValue = account.activePositions.reduce(
    (sum, p) => sum + (p.usdtInvested || 0),
    0
  );
  const totalEquity = account.usdtBalance + totalPositionsValue;

  const mode = config.positionSizingMode || 'EQUAL_WEIGHT';
  let targetUsdt = 0;

  if (mode === 'EQUAL_WEIGHT') {
    // Equal Weight allocation: strictly divided into N equal slots
    targetUsdt = totalEquity / maxPositions;
  } else if (mode === 'PERCENT_EQUITY') {
    targetUsdt = (totalEquity * (config.balancePercent || 20)) / 100;
  } else {
    targetUsdt = config.tradeAmountUsdt || 10000;
  }

  return Math.min(targetUsdt, account.usdtBalance);
}
