import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KlineData } from '../src/types';
import { calculateBacktestReturnMetrics } from '../src/lib/backtestMetrics';

test('computes drawdown and matched benchmark excess from aligned daily data', () => {
  const base = Date.UTC(2025, 0, 1);
  const equityCurve = [100_000, 102_000, 105_000, 104_000].map((equity, index) => ({
    time: base + index * 86_400_000,
    equity,
  }));
  const benchmark: KlineData[] = [100, 101, 102, 103].map((close, index) => ({
    time: base + index * 86_400_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));

  const metrics = calculateBacktestReturnMetrics(equityCurve, 100_000, '1d', benchmark);
  assert.equal(metrics.maxDrawdownPercent, 0.95);
  assert.equal(metrics.benchmarkReturnPercent, 3);
  assert.equal(metrics.excessReturnPercent, 1);
  assert.notEqual(metrics.sharpeRatio, null);
  assert.notEqual(metrics.informationRatio, null);
});

test('leaves benchmark metrics unknown when benchmark coverage is absent', () => {
  const base = Date.UTC(2025, 0, 1);
  const metrics = calculateBacktestReturnMetrics([
    { time: base, equity: 100 },
    { time: base + 86_400_000, equity: 101 },
  ], 100, '1d');
  assert.equal(metrics.benchmarkReturnPercent, null);
  assert.equal(metrics.excessReturnPercent, null);
  assert.equal(metrics.informationRatio, null);
});
