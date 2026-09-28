import type { BacktestResult, BacktestTrade, KlineData, Timeframe } from '../types';
import { calculateCDCActionZone, isLongEntrySignal } from './cdcIndicator';
import { getSetStockTickSize } from './stockApi';
import { calculateBacktestReturnMetrics } from './backtestMetrics';
import { bootstrapTradeOutcomes } from './backtestValidation';

/** Parameters for a long-only SET cash-market backtest. Costs are per side. */
export interface BacktestParams {
  symbol: string;
  timeframe: Timeframe;
  initialCapital: number;
  stopLossPct: number;
  takeProfitPct: number;
  directionMode: 'LONG_ONLY';
  buyZone: 'BLUE' | 'GREEN';
  /** Commission charged per side; VAT is applied separately to commission. */
  feePercent?: number;
  vatOnCommissionPercent?: number;
  /** Optional exchange/clearing/other fee assumption, charged per side. */
  otherFeePercent?: number;
  slippagePercent?: number;
  minNotionalThb?: number;
  /** Optional benchmark candles. Prefer a total-return index for SET studies. */
  benchmarkCandles?: KlineData[];
  riskFreeRateAnnualPercent?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface TradingCosts {
  commission: number;
  vat: number;
  otherFees: number;
  total: number;
}

function tradingCosts(turnoverThb: number, feePercent: number, vatPercent: number, otherFeePercent: number): TradingCosts {
  const commission = turnoverThb * feePercent / 100;
  const otherFees = turnoverThb * otherFeePercent / 100;
  const vat = (commission + otherFees) * vatPercent / 100;
  return { commission, vat, otherFees, total: commission + vat + otherFees };
}

/**
 * Conservative historical proxy for the SET 50-share board-lot rule. It
 * returns 50 only when the preceding six months of supplied daily closes are
 * complete enough and every observed close is at least ฿500; unknown history
 * and non-daily timeframes fall back to 100. This is not an exchange master.
 */
export function getHistoricalBoardLotSize(candles: KlineData[], endIndex: number, timeframe: Timeframe): 50 | 100 {
  if (timeframe !== '1d' || endIndex < 0 || endIndex >= candles.length) return 100;
  const endTime = candles[endIndex].time;
  const windowStart = endTime - 183 * DAY_MS;
  const history = candles.slice(0, endIndex + 1).filter((candle) => candle.time >= windowStart && candle.time <= endTime);
  if (history.length < 100 || history[0].time > windowStart + 7 * DAY_MS
    || endTime - history[history.length - 1].time > 4 * DAY_MS
    || endTime - history[0].time < 176 * DAY_MS
    || history.some((candle, index) => candle.close < 500
      || (index > 0 && candle.time - history[index - 1].time > 10 * DAY_MS))) return 100;
  return 50;
}

function executionPrice(rawPrice: number, side: 'BUY' | 'SELL', slippagePercent: number): number {
  const slipped = rawPrice * (1 + (side === 'BUY' ? 1 : -1) * slippagePercent / 100);
  if (!Number.isFinite(slipped) || slipped <= 0) return 0;
  const tickSize = getSetStockTickSize(slipped);
  const ticks = slipped / tickSize;
  const roundedTicks = side === 'BUY' ? Math.ceil(ticks - 1e-10) : Math.floor(ticks + 1e-10);
  return Number((roundedTicks * tickSize).toFixed(2));
}

/**
 * CDC signal decisions use a completed candle and orders fill no earlier than
 * the next candle's open. Intrabar stop/target collisions resolve to the stop
 * first, a deliberately conservative assumption when OHLC cannot reveal path.
 */
export function runBacktestSimulation(
  rawCandles: KlineData[],
  params: BacktestParams
): BacktestResult | null {
  const candles = rawCandles
    .filter((c) => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)
      && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0
      && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close))
    .slice()
    .sort((a, b) => a.time - b.time);
  if (candles.length < 30 || params.directionMode !== 'LONG_ONLY'
    || !Number.isFinite(params.initialCapital) || params.initialCapital <= 0
    || !Number.isFinite(params.stopLossPct) || params.stopLossPct < 0
    || !Number.isFinite(params.takeProfitPct) || params.takeProfitPct < 0) return null;

  const feePercent = params.feePercent ?? 0.15;
  const vatOnCommissionPercent = params.vatOnCommissionPercent ?? 7;
  const otherFeePercent = params.otherFeePercent ?? 0;
  const slippagePercent = params.slippagePercent ?? 0.1;
  if (!Number.isFinite(feePercent) || feePercent < 0
    || !Number.isFinite(vatOnCommissionPercent) || vatOnCommissionPercent < 0
    || !Number.isFinite(otherFeePercent) || otherFeePercent < 0
    || !Number.isFinite(params.minNotionalThb ?? 0) || (params.minNotionalThb ?? 0) < 0
    || !Number.isFinite(params.riskFreeRateAnnualPercent ?? 0)
    || !Number.isFinite(slippagePercent) || slippagePercent < 0) return null;
  const cdcCandles = calculateCDCActionZone(candles, 12, 26);
  if (cdcCandles.length < 30) return null;

  let cash = params.initialCapital;
  let shares = 0;
  let entryPrice = 0;
  let entryCost = 0;
  let entryTime = 0;
  let entryIndex = 0;
  let entryBoardLotSize: 50 | 100 = 100;
  let entryOrderToAdvPercent: number | null = null;
  let entryReason = '';
  let totalFees = 0;
  let totalCommission = 0;
  let totalVat = 0;
  let totalOtherFees = 0;
  let totalTurnover = 0;
  let maxOrderToAdvPercent: number | null = null;
  let tradeId = 1;
  const trades: BacktestTrade[] = [];
  const equityCurve: {
    time: number;
    equity: number;
    price: number;
    dateStr: string;
    benchmarkEquity?: number;
    stockBuyAndHoldEquity?: number;
  }[] = [];

  const firstPrice = cdcCandles[0].close;

  // Build benchmark lookup by daily date key
  const benchmarkByDay = new Map<string, number>();
  if (params.benchmarkCandles && params.benchmarkCandles.length > 0) {
    for (const c of params.benchmarkCandles) {
      if (Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0) {
        const key = new Date(c.time).toISOString().slice(0, 10);
        benchmarkByDay.set(key, c.close);
      }
    }
  }

  let benchmarkStartPrice: number | null = null;
  if (params.benchmarkCandles && params.benchmarkCandles.length > 0) {
    const firstDateKey = new Date(cdcCandles[0].time).toISOString().slice(0, 10);
    benchmarkStartPrice = benchmarkByDay.get(firstDateKey) ?? null;
    if (benchmarkStartPrice === null) {
      const firstTime = cdcCandles[0].time;
      for (const c of params.benchmarkCandles) {
        if (c.time <= firstTime && c.close > 0) {
          benchmarkStartPrice = c.close;
        }
      }
      if (benchmarkStartPrice === null) {
        benchmarkStartPrice = params.benchmarkCandles[0].close;
      }
    }
  }

  let lastBenchmarkClose: number | null = benchmarkStartPrice;

  const recordEquity = (time: number, close: number) => {
    const liquidationPrice = shares > 0 ? executionPrice(close, 'SELL', slippagePercent) : close;
    const liquidationCost = shares > 0
      ? tradingCosts(shares * liquidationPrice, feePercent, vatOnCommissionPercent, otherFeePercent).total
      : 0;
    const equity = cash + shares * liquidationPrice - liquidationCost;

    const dayKey = new Date(time).toISOString().slice(0, 10);
    const benchmarkClose = benchmarkByDay.get(dayKey);
    if (benchmarkClose) {
      lastBenchmarkClose = benchmarkClose;
    }

    let benchmarkEquity: number | undefined = undefined;
    if (benchmarkStartPrice && benchmarkStartPrice > 0 && lastBenchmarkClose && lastBenchmarkClose > 0) {
      benchmarkEquity = Number((params.initialCapital * (lastBenchmarkClose / benchmarkStartPrice)).toFixed(2));
    }
    const stockBuyAndHoldEquity = Number((params.initialCapital * (close / firstPrice)).toFixed(2));

    equityCurve.push({
      time,
      equity: Number(equity.toFixed(2)),
      price: close,
      dateStr: new Date(time).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }),
      benchmarkEquity,
      stockBuyAndHoldEquity,
    });
  };

  const closePosition = (rawPrice: number, time: number, index: number, reason: string) => {
    const fillPrice = executionPrice(rawPrice, 'SELL', slippagePercent);
    if (fillPrice <= 0 || shares <= 0) return;
    const grossProceeds = shares * fillPrice;
    const costs = tradingCosts(grossProceeds, feePercent, vatOnCommissionPercent, otherFeePercent);
    const netProceeds = grossProceeds - costs.total;
    const pnl = netProceeds - entryCost;
    totalFees += costs.total;
    totalCommission += costs.commission;
    totalVat += costs.vat;
    totalOtherFees += costs.otherFees;
    totalTurnover += grossProceeds;
    const initialRiskThb = params.stopLossPct > 0
      ? shares * entryPrice * params.stopLossPct / 100
      : null;
    cash += netProceeds;
    trades.push({
      id: tradeId++,
      entryTime,
      exitTime: time,
      entryPrice,
      exitPrice: fillPrice,
      side: 'BUY',
      pnlUsdt: Number(pnl.toFixed(2)),
      pnlPercent: entryCost > 0 ? Number((pnl / entryCost * 100).toFixed(2)) : 0,
      quantityShares: shares,
      boardLotSize: entryBoardLotSize,
      initialRiskThb: initialRiskThb === null ? null : Number(initialRiskThb.toFixed(2)),
      pnlR: initialRiskThb && initialRiskThb > 0 ? Number((pnl / initialRiskThb).toFixed(3)) : null,
      entryOrderToAdvPercent,
      entryReason,
      exitReason: reason,
      holdingCandles: Math.max(0, index - entryIndex),
      feesThb: Number((entryCost - shares * entryPrice + costs.total).toFixed(2)),
    });
    shares = 0;
    entryPrice = 0;
    entryCost = 0;
    entryTime = 0;
    entryIndex = 0;
    entryBoardLotSize = 100;
    entryOrderToAdvPercent = null;
    entryReason = '';
  };

  for (let i = 0; i < cdcCandles.length; i++) {
    const candle = cdcCandles[i];

    if (i > 0) {
      const signal = cdcCandles[i - 1];

      // A CDC exit is known only after the prior candle closes; fill at this open.
      if (shares > 0 && signal.zone === 'RED') {
        closePosition(candle.open, candle.time, i, `CDC ${signal.colorNameTh} (next open)`);
      }

      // A fresh CDC entry likewise fills at the next bar open, never its signal close.
      if (shares === 0 && cash > 0 && i > 1) {
        const entrySignal = isLongEntrySignal(
          cdcCandles.slice(0, i),
          [params.buyZone],
          { strictGoldenCross: true, maxBarsSinceCrossover: 2 }
        );

        if (entrySignal) {
          const fillPrice = executionPrice(candle.open, 'BUY', slippagePercent);
          if (fillPrice > 0) {
            const lotSize = getHistoricalBoardLotSize(cdcCandles, i - 1, params.timeframe);
            const estimatedCostRate = feePercent / 100 * (1 + vatOnCommissionPercent / 100) + otherFeePercent / 100;
            const lotBudget = cash / (1 + estimatedCostRate);
            const sharesToBuy = Math.floor((lotBudget / fillPrice) / lotSize) * lotSize;
            const grossCost = sharesToBuy * fillPrice;
            const costs = tradingCosts(grossCost, feePercent, vatOnCommissionPercent, otherFeePercent);
            const totalCost = grossCost + costs.total;
            if (sharesToBuy >= lotSize && grossCost >= (params.minNotionalThb ?? 0) && totalCost <= cash) {
              const priorTurnover = cdcCandles.slice(Math.max(0, i - 20), i)
                .filter((bar) => Number.isFinite(bar.volume) && bar.volume > 0)
                .map((bar) => bar.close * bar.volume);
              const adv20 = priorTurnover.length === 20
                ? priorTurnover.reduce((sum, value) => sum + value, 0) / priorTurnover.length
                : null;
              const orderToAdv = adv20 && adv20 > 0 ? grossCost / adv20 * 100 : null;
              shares = sharesToBuy;
              entryPrice = fillPrice;
              entryCost = totalCost;
              entryTime = candle.time;
              entryIndex = i;
              entryBoardLotSize = lotSize;
              entryOrderToAdvPercent = orderToAdv === null ? null : Number(orderToAdv.toFixed(2));
              if (orderToAdv !== null) maxOrderToAdvPercent = Math.max(maxOrderToAdvPercent ?? 0, orderToAdv);
              entryReason = `CDC ${signal.colorNameTh} (next open)`;
              cash -= totalCost;
              totalFees += costs.total;
              totalCommission += costs.commission;
              totalVat += costs.vat;
              totalOtherFees += costs.otherFees;
              totalTurnover += grossCost;
            }
          }
        }
      }
    }

    // Resolve stop/target using the whole OHLC range; a collision chooses SL.
    if (shares > 0) {
      const stopPrice = params.stopLossPct > 0 ? entryPrice * (1 - params.stopLossPct / 100) : 0;
      const targetPrice = params.takeProfitPct > 0 ? entryPrice * (1 + params.takeProfitPct / 100) : 0;
      const stopHit = stopPrice > 0 && candle.low <= stopPrice;
      const targetHit = targetPrice > 0 && candle.high >= targetPrice;

      if (stopHit) {
        const rawFill = candle.open <= stopPrice ? candle.open : stopPrice;
        closePosition(rawFill, candle.time, i, `Stop Loss (-${params.stopLossPct}%)`);
      } else if (targetHit) {
        const rawFill = candle.open >= targetPrice ? candle.open : targetPrice;
        closePosition(rawFill, candle.time, i, `Take Profit (+${params.takeProfitPct}%)`);
      }
    }

    recordEquity(candle.time, candle.close);
  }

  // Liquidate at the final close for a net, fee-adjusted ending balance.
  if (shares > 0) {
    const last = cdcCandles[cdcCandles.length - 1];
    closePosition(last.close, last.time, cdcCandles.length - 1, 'End of Backtest Period');
    const lastPoint = equityCurve[equityCurve.length - 1];
    lastPoint.equity = Number(cash.toFixed(2));
  }

  const finalCapital = cash;
  const lastPrice = cdcCandles[cdcCandles.length - 1].close;
  const winningTrades = trades.filter((trade) => trade.pnlUsdt > 0).length;
  const losingTrades = trades.filter((trade) => trade.pnlUsdt < 0).length;
  const breakevenTrades = trades.filter((trade) => trade.pnlUsdt === 0).length;
  const totalWins = trades.filter((trade) => trade.pnlUsdt > 0).reduce((sum, trade) => sum + trade.pnlUsdt, 0);
  const totalLosses = Math.abs(trades.filter((trade) => trade.pnlUsdt < 0).reduce((sum, trade) => sum + trade.pnlUsdt, 0));
  const avgEquity = equityCurve.length
    ? equityCurve.reduce((sum, point) => sum + point.equity, 0) / equityCurve.length
    : params.initialCapital;
  const returnMetrics = calculateBacktestReturnMetrics(
    equityCurve,
    params.initialCapital,
    params.timeframe,
    params.benchmarkCandles,
    params.riskFreeRateAnnualPercent ?? 0
  );
  const riskTrades = trades.filter((trade) => trade.initialRiskThb !== null && trade.initialRiskThb > 0);
  const netTradePnl = trades.reduce((sum, trade) => sum + trade.pnlUsdt, 0);
  const topWinningTrade = trades.reduce((max, trade) => Math.max(max, trade.pnlUsdt), 0);
  const avgDailyTurnover = cdcCandles.reduce((sum, candle) =>
    sum + (Number.isFinite(candle.volume) && candle.volume > 0 ? candle.close * candle.volume : 0), 0)
    / cdcCandles.filter((candle) => Number.isFinite(candle.volume) && candle.volume > 0).length;

  return {
    symbol: params.symbol,
    timeframe: params.timeframe,
    initialCapital: params.initialCapital,
    finalCapital: Number(finalCapital.toFixed(2)),
    totalReturnPercent: Number(((finalCapital - params.initialCapital) / params.initialCapital * 100).toFixed(2)),
    buyAndHoldReturnPercent: Number(((lastPrice - firstPrice) / firstPrice * 100).toFixed(2)),
    totalTrades: trades.length,
    winningTrades,
    losingTrades,
    breakevenTrades,
    winRatePercent: trades.length > 0 ? Number((winningTrades / trades.length * 100).toFixed(2)) : 0,
    maxDrawdownPercent: returnMetrics.maxDrawdownPercent,
    profitFactor: totalLosses > 0 ? Number((totalWins / totalLosses).toFixed(2)) : null,
    annualizedReturnPercent: returnMetrics.annualizedReturnPercent,
    sharpeRatio: returnMetrics.sharpeRatio,
    sortinoRatio: returnMetrics.sortinoRatio,
    calmarRatio: returnMetrics.calmarRatio,
    benchmarkReturnPercent: returnMetrics.benchmarkReturnPercent,
    excessReturnPercent: returnMetrics.excessReturnPercent,
    informationRatio: returnMetrics.informationRatio,
    expectancyThb: trades.length ? Number((trades.reduce((sum, trade) => sum + trade.pnlUsdt, 0) / trades.length).toFixed(2)) : 0,
    expectancyR: riskTrades.length
      ? Number((riskTrades.reduce((sum, trade) => sum + (trade.pnlUsdt / (trade.initialRiskThb ?? 1)), 0) / riskTrades.length).toFixed(3))
      : null,
    maxSingleWinContributionPercent: netTradePnl > 0
      ? Number((topWinningTrade / netTradePnl * 100).toFixed(2))
      : null,
    turnoverPercent: avgEquity > 0 ? Number((totalTurnover / avgEquity * 100).toFixed(2)) : 0,
    averageDailyTurnoverThb: Number.isFinite(avgDailyTurnover) ? Number(avgDailyTurnover.toFixed(2)) : 0,
    maxOrderToAdvPercent: maxOrderToAdvPercent === null ? null : Number(maxOrderToAdvPercent.toFixed(2)),
    totalCommissionThb: Number(totalCommission.toFixed(2)),
    totalVatThb: Number(totalVat.toFixed(2)),
    totalOtherFeesThb: Number(totalOtherFees.toFixed(2)),
    totalFeesThb: Number(totalFees.toFixed(2)),
    feePercent,
    vatOnCommissionPercent,
    otherFeePercent,
    slippagePercent,
    minNotionalThb: params.minNotionalThb ?? 0,
    riskFreeRateAnnualPercent: params.riskFreeRateAnnualPercent ?? 0,
    monteCarlo: bootstrapTradeOutcomes(trades),
    trades,
    equityCurve,
  };
}
