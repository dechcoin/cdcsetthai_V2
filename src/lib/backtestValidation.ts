import type { BacktestTrade } from '../types';

export interface WalkForwardFold {
  index: number;
  train: { start: number; endExclusive: number };
  validation: { start: number; endExclusive: number };
  test: { start: number; endExclusive: number };
}

export interface WalkForwardOptions {
  foldCount?: number;
  initialTrainFraction?: number;
  validationFraction?: number;
  embargoBars?: number;
}

/**
 * Creates expanding-window chronological folds using half-open index ranges.
 * The embargo keeps adjacent train/validation/test ranges apart; this utility
 * plans splits only and does not claim to run or tune a strategy.
 */
export function createWalkForwardFolds(totalBars: number, options: WalkForwardOptions = {}): WalkForwardFold[] {
  const foldCount = options.foldCount ?? 5;
  const trainFraction = options.initialTrainFraction ?? 0.5;
  const validationFraction = options.validationFraction ?? 0.1;
  const embargoBars = options.embargoBars ?? 26;
  if (!Number.isInteger(totalBars) || totalBars <= 0 || !Number.isInteger(foldCount) || foldCount < 1
    || !Number.isFinite(trainFraction) || trainFraction <= 0 || trainFraction >= 1
    || !Number.isFinite(validationFraction) || validationFraction <= 0 || validationFraction >= 1
    || !Number.isInteger(embargoBars) || embargoBars < 0
    || trainFraction + validationFraction >= 1) return [];

  const initialTrainBars = Math.floor(totalBars * trainFraction);
  const validationBars = Math.floor(totalBars * validationFraction);
  const testBars = Math.floor((totalBars - initialTrainBars - validationBars - 2 * embargoBars) / foldCount);
  if (initialTrainBars < 2 || validationBars < 2 || testBars < 2) return [];

  const folds: WalkForwardFold[] = [];
  for (let index = 0; index < foldCount; index++) {
    const trainEnd = initialTrainBars + index * testBars;
    const validationStart = trainEnd + embargoBars;
    const validationEnd = validationStart + validationBars;
    const testStart = validationEnd + embargoBars;
    const testEnd = testStart + testBars;
    if (testEnd > totalBars) return [];
    folds.push({
      index,
      train: { start: 0, endExclusive: trainEnd },
      validation: { start: validationStart, endExclusive: validationEnd },
      test: { start: testStart, endExclusive: testEnd },
    });
  }
  return folds;
}

export interface MonteCarloSummary {
  iterations: number;
  probabilityOfLossPercent: number;
  medianReturnPercent: number;
  fifthPercentileReturnPercent: number;
  medianMaxDrawdownPercent: number;
  ninetyFifthPercentileMaxDrawdownPercent: number;
}

function quantile(sorted: number[], probability: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(probability * sorted.length) - 1));
  return sorted[index];
}

/**
 * Trade-level bootstrap with replacement. It compounds each sampled trade's
 * net return; it intentionally does not model trade timing, clustering,
 * changing exposure, slippage impact, or regime changes.
 */
export function bootstrapTradeOutcomes(
  trades: Pick<BacktestTrade, 'pnlPercent'>[],
  iterations = 2000,
  seed = 0x51E7A11
): MonteCarloSummary | null {
  if (!trades.length || !Number.isInteger(iterations) || iterations < 100
    || trades.some((trade) => !Number.isFinite(trade.pnlPercent))) return null;

  let state = seed >>> 0 || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };

  const outcomes: number[] = [];
  const drawdowns: number[] = [];
  for (let simulation = 0; simulation < iterations; simulation++) {
    let equity = 1;
    let peak = 1;
    let maxDrawdown = 0;
    for (let step = 0; step < trades.length; step++) {
      const sampled = trades[Math.floor(random() * trades.length)];
      equity *= Math.max(0, 1 + sampled.pnlPercent / 100);
      peak = Math.max(peak, equity);
      if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    }
    outcomes.push((equity - 1) * 100);
    drawdowns.push(maxDrawdown * 100);
  }
  outcomes.sort((a, b) => a - b);
  drawdowns.sort((a, b) => a - b);
  return {
    iterations,
    probabilityOfLossPercent: Number((outcomes.filter((value) => value < 0).length / iterations * 100).toFixed(2)),
    medianReturnPercent: Number(quantile(outcomes, 0.5).toFixed(2)),
    fifthPercentileReturnPercent: Number(quantile(outcomes, 0.05).toFixed(2)),
    medianMaxDrawdownPercent: Number(quantile(drawdowns, 0.5).toFixed(2)),
    ninetyFifthPercentileMaxDrawdownPercent: Number(quantile(drawdowns, 0.95).toFixed(2)),
  };
}
