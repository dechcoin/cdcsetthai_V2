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
  quantityShares: number;
  boardLotSize: number;
  initialRiskThb: number | null;
  pnlR: number | null;
  entryOrderToAdvPercent: number | null;
  feesThb: number;
  entryReason: string;
  exitReason: string;
  holdingCandles: number;
}

export interface BacktestResult {
  symbol: string;
  benchmarkName: string;
  timeframe: Timeframe;
  initialCapital: number;
  finalCapital: number;
  totalReturnPercent: number;
  buyAndHoldReturnPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRatePercent: number;
  maxDrawdownPercent: number;
  profitFactor: number | null;
  annualizedReturnPercent: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  benchmarkReturnPercent: number | null;
  excessReturnPercent: number | null;
  informationRatio: number | null;
  expectancyThb: number;
  expectancyR: number | null;
  maxSingleWinContributionPercent: number | null;
  turnoverPercent: number;
  averageDailyTurnoverThb: number;
  maxOrderToAdvPercent: number | null;
  totalCommissionThb: number;
  totalVatThb: number;
  totalOtherFeesThb: number;
  totalFeesThb: number;
  feePercent: number;
  vatOnCommissionPercent: number;
  otherFeePercent: number;
  slippagePercent: number;
  minNotionalThb: number;
  riskFreeRateAnnualPercent: number;
  monteCarlo: {
    iterations: number;
    probabilityOfLossPercent: number;
    medianReturnPercent: number;
    fifthPercentileReturnPercent: number;
    medianMaxDrawdownPercent: number;
    ninetyFifthPercentileMaxDrawdownPercent: number;
  } | null;
  trades: BacktestTrade[];
  equityCurve: {
    time: number;
    equity: number;
    price: number;
    dateStr: string;
    benchmarkEquity?: number;
    stockBuyAndHoldEquity?: number;
  }[];
}
