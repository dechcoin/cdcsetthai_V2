import type { Timeframe } from './market.types';

/**
 * Backtesting domain types: the trade log and performance summary produced by
 * the strategy backtest engine.
 */

export interface BacktestTrade {
  id: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  side: 'BUY' | 'SELL';
  pnlUsdt: number; // PnL in THB (฿)
  pnlPercent: number;
  entryReason: string;
  exitReason: string;
  holdingCandles: number;
}

export interface BacktestResult {
  symbol: string;
  timeframe: Timeframe;
  initialCapital: number;
  finalCapital: number;
  totalReturnPercent: number;
  buyAndHoldReturnPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: number;
  maxDrawdownPercent: number;
  profitFactor: number;
  trades: BacktestTrade[];
  equityCurve: { time: number; equity: number; price: number }[];
}
