import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWalkForwardFolds, bootstrapTradeOutcomes } from '../src/lib/backtestValidation';

test('creates five expanding chronological folds with embargoed boundaries', () => {
  const folds = createWalkForwardFolds(1000);
  assert.equal(folds.length, 5);
  for (const fold of folds) {
    assert.equal(fold.train.start, 0);
    assert.ok(fold.train.endExclusive < fold.validation.start);
    assert.ok(fold.validation.endExclusive < fold.test.start);
    assert.ok(fold.test.endExclusive <= 1000);
  }
  assert.ok(folds[4].train.endExclusive > folds[0].train.endExclusive);
  assert.deepEqual(createWalkForwardFolds(100), []);
});

test('trade bootstrap is reproducible and returns loss/drawdown diagnostics', () => {
  const trades = [{ pnlPercent: 8 }, { pnlPercent: -5 }, { pnlPercent: 3 }, { pnlPercent: -2 }];
  const first = bootstrapTradeOutcomes(trades, 1000, 1234);
  const second = bootstrapTradeOutcomes(trades, 1000, 1234);
  assert.deepEqual(first, second);
  assert.ok(first);
  assert.ok(first.probabilityOfLossPercent > 0 && first.probabilityOfLossPercent < 100);
  assert.ok(first.fifthPercentileReturnPercent <= first.medianReturnPercent);
  assert.ok(first.ninetyFifthPercentileMaxDrawdownPercent >= first.medianMaxDrawdownPercent);
  assert.equal(bootstrapTradeOutcomes([], 1000), null);
});
