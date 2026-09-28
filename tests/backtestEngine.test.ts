import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KlineData } from '../src/types';
import { getHistoricalBoardLotSize, runBacktestSimulation } from '../src/lib/backtestEngine';

function candlesForNextOpenFill(): KlineData[] {
  const bars: KlineData[] = Array.from({ length: 33 }, (_, index) => ({
    time: Date.UTC(2025, 0, 1 + index),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 100_000,
  }));
  bars[30] = { ...bars[30], open: 100, high: 111, low: 99, close: 110 };
  bars[31] = { ...bars[31], open: 120, high: 121, low: 119, close: 120 };
  // Both 5% stop and 10% target are crossed. The simulator must choose SL.
  bars[32] = { ...bars[32], open: 120, high: 140, low: 100, close: 130 };
  return bars;
}

test('enters at the next bar open and resolves same-bar stop/target collision conservatively', () => {
  const result = runBacktestSimulation(candlesForNextOpenFill(), {
    symbol: 'PTT',
    timeframe: '1d',
    initialCapital: 100_000,
    stopLossPct: 5,
    takeProfitPct: 10,
    directionMode: 'LONG_ONLY',
    buyZone: 'BLUE',
    feePercent: 0,
    slippagePercent: 0,
  });

  assert.ok(result);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].entryTime, candlesForNextOpenFill()[31].time);
  assert.equal(result.trades[0].entryPrice, 120);
  assert.equal(result.trades[0].exitPrice, 114);
  assert.match(result.trades[0].exitReason, /Stop Loss/);
  assert.ok(result.trades[0].pnlUsdt < 0);
});

test('charges the configured fee and adverse slippage on both sides', () => {
  const result = runBacktestSimulation(candlesForNextOpenFill(), {
    symbol: 'PTT',
    timeframe: '1d',
    initialCapital: 100_000,
    stopLossPct: 5,
    takeProfitPct: 10,
    directionMode: 'LONG_ONLY',
    buyZone: 'BLUE',
    feePercent: 0.15,
    slippagePercent: 0.1,
  });

  assert.ok(result);
  assert.ok(result.totalFeesThb > 0);
  assert.ok(result.trades[0].feesThb > 0);
  assert.ok(result.finalCapital < 100_000);
  assert.ok(Math.abs(result.totalVatThb - result.totalCommissionThb * 0.07) < 0.01);
  assert.equal(result.profitFactor, 0);
  assert.equal(result.benchmarkReturnPercent, null);
  assert.equal(result.informationRatio, null);
  assert.ok(result.averageDailyTurnoverThb > 0);
  assert.ok(result.maxOrderToAdvPercent !== null);
  assert.ok(result.monteCarlo);
});

test('normalizes benchmark equity to initial capital and records its label', () => {
  const candles = candlesForNextOpenFill();
  const benchmarkCandles = candles.map((candle, index) => ({
    ...candle,
    open: 1_500 + index,
    high: 1_502 + index,
    low: 1_498 + index,
    close: 1_500 + index,
  }));
  const result = runBacktestSimulation(candles, {
    symbol: 'PTT',
    timeframe: '1d',
    initialCapital: 100_000,
    stopLossPct: 5,
    takeProfitPct: 10,
    directionMode: 'LONG_ONLY',
    buyZone: 'BLUE',
    feePercent: 0,
    slippagePercent: 0,
    benchmarkName: '^SET.BK',
    benchmarkCandles,
  });

  assert.ok(result);
  assert.equal(result.benchmarkName, '^SET.BK');
  assert.equal(result.equityCurve[0].benchmarkEquity, 100_000);
  assert.ok(result.equityCurve.at(-1)?.benchmarkEquity);
  assert.notEqual(result.benchmarkReturnPercent, null);
});

test('uses 50-share SET board lots only when six months of known daily closes qualify', () => {
  const history: KlineData[] = Array.from({ length: 230 }, (_, index) => ({
    time: Date.UTC(2025, 0, 1 + index),
    open: 600,
    high: 602,
    low: 598,
    close: index === 200 ? 660 : 600,
    volume: 100_000,
  }));
  assert.equal(getHistoricalBoardLotSize(history, 200, '1d'), 50);
  assert.equal(getHistoricalBoardLotSize(history, 100, '1d'), 100);
  assert.equal(getHistoricalBoardLotSize(history, 200, '1w'), 100);
  history[150] = { ...history[150], close: 499 };
  assert.equal(getHistoricalBoardLotSize(history, 200, '1d'), 100);
});

test('rounds a historically qualifying entry to the smaller 50-share lot', () => {
  const candles: KlineData[] = Array.from({ length: 203 }, (_, index) => ({
    time: Date.UTC(2025, 0, 1 + index),
    open: 600,
    high: 602,
    low: 598,
    close: 600,
    volume: 100_000,
  }));
  candles[200] = { ...candles[200], high: 662, close: 660 };
  candles[201] = { ...candles[201], open: 720, high: 721, low: 719, close: 720 };
  candles[202] = { ...candles[202], open: 720, high: 721, low: 719, close: 720 };
  const result = runBacktestSimulation(candles, {
    symbol: 'TEST',
    timeframe: '1d',
    initialCapital: 100_000,
    stopLossPct: 5,
    takeProfitPct: 10,
    directionMode: 'LONG_ONLY',
    buyZone: 'BLUE',
    feePercent: 0,
    slippagePercent: 0,
  });
  assert.ok(result);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].boardLotSize, 50);
  assert.equal(result.trades[0].quantityShares % 50, 0);
});

test('enforces configured minimum order notional after lot rounding', () => {
  const result = runBacktestSimulation(candlesForNextOpenFill(), {
    symbol: 'PTT',
    timeframe: '1d',
    initialCapital: 100_000,
    stopLossPct: 5,
    takeProfitPct: 10,
    directionMode: 'LONG_ONLY',
    buyZone: 'BLUE',
    feePercent: 0,
    slippagePercent: 0,
    minNotionalThb: 200_000,
  });
  assert.ok(result);
  assert.equal(result.trades.length, 0);
});

test('returns null for insufficient/invalid capital inputs', () => {
  const params = {
    symbol: 'PTT',
    timeframe: '1d',
    initialCapital: Number.NaN,
    stopLossPct: 5,
    takeProfitPct: 10,
    directionMode: 'LONG_ONLY',
    buyZone: 'BLUE',
  } as const;
  assert.equal(runBacktestSimulation(candlesForNextOpenFill(), params), null);
  assert.equal(runBacktestSimulation(candlesForNextOpenFill(), { ...params, initialCapital: 0 }), null);
  assert.equal(runBacktestSimulation(candlesForNextOpenFill(), { ...params, initialCapital: 100_000, feePercent: Number.NaN }), null);
});
