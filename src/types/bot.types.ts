import type { CDCZoneColor, CDCSignalType, Timeframe } from './market.types';

/**
 * Trading-bot domain types: strategy configuration, paper-trading account
 * state, executed trades and broker credentials.
 */

export interface StopLossLockInfo {
  symbol: string;
  lockedAt: number;
  triggerPrice: number;
  triggerZone: CDCZoneColor;
  reason: string;
}

export interface BotConfig {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  tradeAmountUsdt: number; // Trade budget in THB (฿)
  usePercentBalance: boolean;
  balancePercent: number;
  positionSizingMode?: 'EQUAL_WEIGHT' | 'PERCENT_EQUITY' | 'FIXED_USDT';
  maxOpenPositions?: number;
  stopLossPercent: number; // 0 = disabled
  takeProfitPercent: number; // 0 = disabled
  usePartialTakeProfit?: boolean;
  partialTakeProfitR?: number;
  partialTakeProfitPercent?: number;
  useTrailingStop: boolean;
  trailingStopPercent: number;
  useStopLossLock?: boolean; // Lock coin if hit SL in current trend cycle
  stopLossLocks?: Record<string, StopLossLockInfo>; // Map of locked symbols
  buyOnSignal: ('BLUE' | 'GREEN')[];
  sellOnSignal: ('YELLOW' | 'RED')[];
  mode: 'PAPER' | 'SETTRADE_LIVE';
  marketType?: 'SPOT' | 'FUTURES';
  scanMode?: 'SINGLE' | 'WATCHLIST' | 'MULTI_SCAN';
  customWatchlist?: string[];
  directionMode?: 'LONG_ONLY' | 'SHORT_ONLY' | 'BOTH';
  quantMinScore?: number;
  useQuantFilter?: boolean;
  strictGoldenCrossOnly?: boolean;
  maxBarsSinceCrossover?: number;
  skipExtendedPrice?: boolean;
  telegramConfig?: {
    botToken: string;
    chatId: string;
    isEnabled: boolean;
  };
  isActive: boolean;
  lastSignal?: CDCSignalType;
  lastExecutionTime?: number;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  isEnabled: boolean;
}

export interface PaperPosition {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  amount: number; // Number of shares (หุ้น)
  usdtInvested: number; // Invested Capital in THB (฿) = ต้นทุน spot เต็มจำนวน
  initialInvestedUsdt?: number;
  entryTime: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  highestPriceSinceEntry?: number; // Highest price reached for Trailing Stop
  trailingStopPrice?: number; // Dynamic trailing stop price
  initialRiskPerShare?: number;
  partialTakeProfitTaken?: boolean;
  realizedPnlUsdt?: number;
  currentPnlUsdt: number; // Current PnL in THB (฿)
  currentPnlPercent: number;
}

export interface PaperAccount {
  usdtBalance: number; // Cash balance in THB (฿)
  initialUsdtBalance: number; // Initial balance in THB (฿)
  activePositions: PaperPosition[];
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalProfitUsdt: number; // Total realized profit in THB (฿)
  peakEquityUsdt?: number;
  currentDrawdownPercent?: number;
  consecutiveLosses?: number;
  cooldownUntil?: number;
  riskHalted?: boolean;
}

export interface ExecutedTrade {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  side: 'BUY' | 'SELL' | 'LONG' | 'SHORT' | 'CLOSE_LONG' | 'CLOSE_SHORT';
  price: number;
  amount: number; // Number of shares
  usdtValue: number; // Order value in THB (฿)
  pnlUsdt?: number; // Realized PnL in THB (฿)
  pnlPercent?: number;
  reason: string;
  timestamp: number;
  mode: 'PAPER' | 'SETTRADE_LIVE';
}

export interface SettradeApiKeys {
  apiKey: string;
  apiSecret: string;
  appCode?: string;
  brokerId?: string;
  accountNo?: string;
  pin?: string;
}
