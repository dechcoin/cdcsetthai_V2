import type { PaperAccount } from '../types';

export const MAX_DRAWDOWN_HALT_PERCENT = 15;
export const DRAWDOWN_THROTTLE_LEVELS = [
  { thresholdPercent: 10, multiplier: 0.5 },
  { thresholdPercent: 5, multiplier: 0.75 },
] as const;
export const LOSS_STREAK_LIMIT = 3;
export const LOSS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface PaperRiskStatus {
  equity: number;
  drawdownPercent: number;
  halted: boolean;
  cooldownUntil?: number;
  canOpenPosition: boolean;
  sizeMultiplier: number;
}

export function getPaperAccountEquity(account: PaperAccount): number {
  const investedValue = account.activePositions.reduce((total, position) => {
    const cost = Number.isFinite(position.usdtInvested) ? position.usdtInvested : 0;
    const unrealizedPnl = Number.isFinite(position.currentPnlUsdt) ? position.currentPnlUsdt : 0;
    return total + Math.max(0, cost + unrealizedPnl);
  }, 0);
  return Math.max(0, account.usdtBalance + investedValue);
}

export function getDrawdownSizeMultiplier(drawdownPercent: number): number {
  if (drawdownPercent >= DRAWDOWN_THROTTLE_LEVELS[0].thresholdPercent) return DRAWDOWN_THROTTLE_LEVELS[0].multiplier;
  if (drawdownPercent >= DRAWDOWN_THROTTLE_LEVELS[1].thresholdPercent) return DRAWDOWN_THROTTLE_LEVELS[1].multiplier;
  return 1;
}

export function calculatePartialTakeProfitShares(amount: number, percent = 50): number {
  const safePercent = Math.max(1, Math.min(99, Number.isFinite(percent) ? percent : 50));
  return Math.floor((Math.max(0, amount) * safePercent / 100) / 100) * 100;
}

export function calculatePartialTakeProfitPrice(entryPrice: number, riskPerShare: number, rMultiple = 1.5): number {
  if (![entryPrice, riskPerShare, rMultiple].every(Number.isFinite) || entryPrice <= 0 || riskPerShare <= 0 || rMultiple <= 0) return 0;
  return entryPrice + riskPerShare * rMultiple;
}

export function updatePaperAccountRisk(account: PaperAccount, now = Date.now()): PaperRiskStatus {
  const equity = getPaperAccountEquity(account);
  const baselinePeak = account.initialUsdtBalance > 0 ? account.initialUsdtBalance : equity;
  const peak = Math.max(account.peakEquityUsdt || baselinePeak, equity, baselinePeak);
  const drawdownPercent = peak > 0 ? Math.max(0, (peak - equity) / peak * 100) : 0;

  account.peakEquityUsdt = peak;
  account.currentDrawdownPercent = drawdownPercent;
  if (drawdownPercent >= MAX_DRAWDOWN_HALT_PERCENT) account.riskHalted = true;

  if (account.cooldownUntil && account.cooldownUntil <= now) {
    account.cooldownUntil = undefined;
    account.consecutiveLosses = 0;
  }

  const cooldownActive = (account.cooldownUntil || 0) > now;
  return {
    equity,
    drawdownPercent,
    halted: account.riskHalted === true,
    cooldownUntil: account.cooldownUntil,
    canOpenPosition: account.riskHalted !== true && !cooldownActive,
    sizeMultiplier: getDrawdownSizeMultiplier(drawdownPercent),
  };
}

/** Record outcome once, after the remaining shares of a paper position close. */
export function registerCompletedPaperTrade(account: PaperAccount, totalTradePnl: number, now = Date.now()): void {
  account.totalTrades += 1;
  account.totalProfitUsdt += totalTradePnl;

  if (totalTradePnl > 0) {
    account.winningTrades += 1;
    account.consecutiveLosses = 0;
  } else {
    account.losingTrades += 1;
    account.consecutiveLosses = (account.consecutiveLosses || 0) + 1;
    if (account.consecutiveLosses >= LOSS_STREAK_LIMIT) {
      account.cooldownUntil = now + LOSS_COOLDOWN_MS;
      account.consecutiveLosses = 0;
    }
  }

  updatePaperAccountRisk(account, now);
}
