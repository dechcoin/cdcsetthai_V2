import type { KlineData, Timeframe } from '../types';

export interface EquityPoint {
  time: number;
  equity: number;
}

export interface BacktestReturnMetrics {
  annualizedReturnPercent: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
  benchmarkReturnPercent: number | null;
  excessReturnPercent: number | null;
  informationRatio: number | null;
  maxDrawdownPercent: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const THAILAND_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function dailyKey(timestamp: number): string {
  if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) return '';
  return new Date(timestamp + THAILAND_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

function annualPeriods(timeframe: Timeframe): number | null {
  if (timeframe === '1d') return 252;
  if (timeframe === '1w') return 52;
  return null;
}

function safePercent(value: number): number | null {
  return Number.isFinite(value) ? Number((value * 100).toFixed(2)) : null;
}

/**
 * Calculates risk statistics from close-to-close portfolio equity. An optional
 * benchmark is matched by UTC calendar day; callers should pass a total-return
 * index (e.g. SET TRI) if dividends/corporate actions are intended to count.
 */
export function calculateBacktestReturnMetrics(
  equityCurve: EquityPoint[],
  initialCapital: number,
  timeframe: Timeframe,
  benchmarkCandles: KlineData[] = [],
  riskFreeRateAnnualPercent = 0
): BacktestReturnMetrics {
  let peak = initialCapital;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    if (!Number.isFinite(point.equity) || point.equity < 0) continue;
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak);
  }

  const orderedEquity = equityCurve
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.equity) && point.equity > 0)
    .slice()
    .sort((a, b) => a.time - b.time);
  const returns = orderedEquity.slice(1).flatMap((point, index) => {
    const previous = orderedEquity[index];
    const value = point.equity / previous.equity - 1;
    return Number.isFinite(value) ? [{ time: point.time, previousTime: previous.time, value }] : [];
  });

  const periods = annualPeriods(timeframe);
  const riskFreePerPeriod = periods && Number.isFinite(riskFreeRateAnnualPercent)
    ? (riskFreeRateAnnualPercent / 100) / periods
    : 0;
  const excessReturns = returns.map((item) => item.value - riskFreePerPeriod);
  const averageExcessReturn = mean(excessReturns);
  const returnStdDev = sampleStdDev(excessReturns);
  const sharpeRatio = periods && averageExcessReturn !== null && returnStdDev && returnStdDev > 0
    ? Number((averageExcessReturn / returnStdDev * Math.sqrt(periods)).toFixed(3))
    : null;

  const downsideDeviation = periods && excessReturns.length
    ? Math.sqrt(excessReturns.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / excessReturns.length)
    : null;
  const sortinoRatio = periods && averageExcessReturn !== null && downsideDeviation && downsideDeviation > 0
    ? Number((averageExcessReturn / downsideDeviation * Math.sqrt(periods)).toFixed(3))
    : null;

  let annualizedReturnPercent: number | null = null;
  const first = orderedEquity[0];
  const last = orderedEquity[orderedEquity.length - 1];
  if (first && last && last.time > first.time && first.equity > 0 && last.equity > 0) {
    const years = (last.time - first.time) / (365.25 * DAY_MS);
    annualizedReturnPercent = safePercent((last.equity / first.equity) ** (1 / years) - 1);
  }
  const calmarRatio = annualizedReturnPercent !== null && maxDrawdown > 0
    ? Number(((annualizedReturnPercent / 100) / maxDrawdown).toFixed(3))
    : null;

  let benchmarkReturnPercent: number | null = null;
  let excessReturnPercent: number | null = null;
  let informationRatio: number | null = null;
  if (benchmarkCandles.length) {
    const closesByDay = new Map<string, number>();
    for (const candle of benchmarkCandles) {
      if (Number.isFinite(candle.time) && Number.isFinite(candle.close) && candle.close > 0) {
        closesByDay.set(dailyKey(candle.time), candle.close);
      }
    }
    const activeReturns: number[] = [];
    const benchmarkReturns: number[] = [];
    for (const item of returns) {
      const benchmarkPrevious = closesByDay.get(dailyKey(item.previousTime));
      const benchmarkCurrent = closesByDay.get(dailyKey(item.time));
      if (!benchmarkPrevious || !benchmarkCurrent) continue;
      const benchmarkReturn = benchmarkCurrent / benchmarkPrevious - 1;
      if (!Number.isFinite(benchmarkReturn)) continue;
      activeReturns.push(item.value - benchmarkReturn);
      benchmarkReturns.push(benchmarkReturn);
    }
    if (benchmarkReturns.length === returns.length && benchmarkReturns.length > 0) {
      const compoundedBenchmark = benchmarkReturns.reduce((value, change) => value * (1 + change), 1) - 1;
      benchmarkReturnPercent = safePercent(compoundedBenchmark);
      const strategyMatchedReturn = activeReturns.reduce((value, change, index) =>
        value * (1 + change + benchmarkReturns[index]), 1) - 1;
      const matchedExcessPercent = safePercent(strategyMatchedReturn - compoundedBenchmark);
      excessReturnPercent = matchedExcessPercent;
      const activeMean = mean(activeReturns);
      const activeStdDev = sampleStdDev(activeReturns);
      informationRatio = periods && activeMean !== null && activeStdDev && activeStdDev > 0
        ? Number((activeMean / activeStdDev * Math.sqrt(periods)).toFixed(3))
        : null;
    }
  }

  return {
    annualizedReturnPercent,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    benchmarkReturnPercent,
    excessReturnPercent,
    informationRatio,
    maxDrawdownPercent: Number((maxDrawdown * 100).toFixed(2)),
  };
}
