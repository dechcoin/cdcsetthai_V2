import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PaperAccount } from '../src/types';
import {
  calculatePartialTakeProfitPrice,
  calculatePartialTakeProfitShares,
  getDrawdownSizeMultiplier,
  registerCompletedPaperTrade,
  updatePaperAccountRisk,
} from '../src/lib/riskManagement';

function account(): PaperAccount {
  return {
    usdtBalance: 100_000,
    initialUsdtBalance: 100_000,
    activePositions: [],
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalProfitUsdt: 0,
    peakEquityUsdt: 100_000,
    currentDrawdownPercent: 0,
    consecutiveLosses: 0,
    riskHalted: false,
  };
}

test('throttles new position size at the configured drawdown levels', () => {
  assert.equal(getDrawdownSizeMultiplier(4.99), 1);
  assert.equal(getDrawdownSizeMultiplier(5), 0.75);
  assert.equal(getDrawdownSizeMultiplier(10), 0.5);
});

test('halts new positions at 15% drawdown and keeps the halt latched', () => {
  const paper = account();
  paper.usdtBalance = 85_000;
  assert.equal(updatePaperAccountRisk(paper, 1000).canOpenPosition, false);
  assert.equal(paper.riskHalted, true);
  paper.usdtBalance = 100_000;
  assert.equal(updatePaperAccountRisk(paper, 2000).canOpenPosition, false);
});

test('starts a 24-hour cooldown after three completed losing trades', () => {
  const paper = account();
  const now = 10_000;
  registerCompletedPaperTrade(paper, -10, now);
  registerCompletedPaperTrade(paper, -10, now);
  registerCompletedPaperTrade(paper, -10, now);
  assert.equal(paper.cooldownUntil, now + 24 * 60 * 60 * 1000);
  assert.equal(updatePaperAccountRisk(paper, now + 1000).canOpenPosition, false);
  assert.equal(updatePaperAccountRisk(paper, paper.cooldownUntil).canOpenPosition, true);
});

test('partial exits round down to 100-share board lots and use the configured R target', () => {
  assert.equal(calculatePartialTakeProfitShares(100, 50), 0);
  assert.equal(calculatePartialTakeProfitShares(200, 50), 100);
  assert.equal(calculatePartialTakeProfitShares(350, 50), 100);
  assert.equal(calculatePartialTakeProfitPrice(100, 5, 1.5), 107.5);
});
