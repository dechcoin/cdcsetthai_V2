import fs from 'fs';
import path from 'path';
import type { BotConfig, PaperAccount, ExecutedTrade } from '../../src/types';

/**
 * Repository for the persisted bot state (`data/bot_state.json`).
 *
 * ## Contract
 * `getServerState()` returns the **live, mutable** object — not a copy. Callers
 * mutate nested properties in place (`state.paperAccount.usdtBalance -= x`) and
 * then call `saveServerState()`. This mirrors the previous module-level
 * `let serverState` behaviour exactly, so no call site had to change semantics.
 *
 * Only `loadServerState()` replaces the whole object, and it does so through
 * `setServerState()` so the module keeps a single ownership point.
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'bot_state.json');

export interface LiveApiKeys {
  apiKey: string;
  apiSecret: string;
  appCode?: string;
  brokerId?: string;
  accountNo?: string;
  pin?: string;
  isTestnet?: boolean;
}

export interface ServerState {
  botConfig: BotConfig;
  paperAccount: PaperAccount;
  tradeHistory: ExecutedTrade[];
  botLogs: string[];
  liveApiKeys?: LiveApiKeys;
}

export const DEFAULT_SERVER_STATE: ServerState = {
  botConfig: {
    id: 'default_bot',
    symbol: 'PTT',
    timeframe: '1d',
    fastEmaPeriod: 12,
    slowEmaPeriod: 26,
    tradeAmountUsdt: 10000,
    usePercentBalance: true,
    balancePercent: 20,
    positionSizingMode: 'EQUAL_WEIGHT',
    maxOpenPositions: 5,
    stopLossPercent: 5,
    takeProfitPercent: 15,
    useTrailingStop: false,
    trailingStopPercent: 3,
    buyOnSignal: ['BLUE', 'GREEN'],
    sellOnSignal: ['RED'],
    mode: 'PAPER',
    scanMode: 'WATCHLIST', // 🎯 ค่าเริ่มต้น: เล่นเฉพาะหุ้นใน Watchlist
    customWatchlist: ['PTT', 'CPALL', 'DELTA', 'KBANK', 'ADVANC', 'AOT'],
    directionMode: 'LONG_ONLY',
    isActive: false,
  },
  paperAccount: {
    usdtBalance: 100000,
    initialUsdtBalance: 100000,
    activePositions: [],
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalProfitUsdt: 0,
  },
  tradeHistory: [],
  botLogs: [
    `[${new Date().toLocaleTimeString('th-TH')}] 🚀 CDC Action Zone V3 Cloud Stock Bot Server initialized and ready.`,
  ],
};

let serverState: ServerState = { ...DEFAULT_SERVER_STATE };

/** Returns the live state object (mutate properties directly, then save). */
export function getServerState(): ServerState {
  return serverState;
}

/** Replaces the whole state object (used by the loader only). */
export function setServerState(next: ServerState): void {
  serverState = next;
}

/**
 * Reads `data/bot_state.json` from disk and merges it over the defaults.
 * Also migrates legacy/corrupt values (symbol leftover from a crypto build and
 * placeholder balances) so an old state file can never break the dashboard.
 */
export function loadServerState(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);

      let cleanSymbol = parsed.botConfig?.symbol || 'PTT';
      if (
        cleanSymbol.includes('_') ||
        cleanSymbol.includes('/') ||
        ['BTC', 'ETH', 'USDT', 'KUB', 'ADA', 'XRP', 'DOGE', 'SOL', 'BNB'].includes(cleanSymbol.toUpperCase())
      ) {
        cleanSymbol = 'PTT';
      }
      if (parsed.botConfig) {
        parsed.botConfig.symbol = cleanSymbol;
        parsed.botConfig.mode = parsed.botConfig.mode === 'SETTRADE_LIVE' ? 'SETTRADE_LIVE' : 'PAPER';
      }

      if (parsed.paperAccount && (parsed.paperAccount.usdtBalance === 1000 || parsed.paperAccount.usdtBalance === 30000 || !parsed.paperAccount.usdtBalance)) {
        parsed.paperAccount.usdtBalance = 100000;
        parsed.paperAccount.initialUsdtBalance = 100000;
      }

      setServerState({
        ...DEFAULT_SERVER_STATE,
        ...parsed,
        botConfig: { ...DEFAULT_SERVER_STATE.botConfig, ...(parsed.botConfig || {}) },
        paperAccount: { ...DEFAULT_SERVER_STATE.paperAccount, ...(parsed.paperAccount || {}) },
        tradeHistory: Array.isArray(parsed.tradeHistory) ? parsed.tradeHistory : [],
        botLogs: Array.isArray(parsed.botLogs) ? parsed.botLogs : [],
      });
      console.log('✅ Loaded persistent bot state from disk.');
    }
  } catch (err) {
    console.error('Error reading bot_state.json:', err);
    setServerState({ ...DEFAULT_SERVER_STATE });
  }
}

/** Writes the current state to disk (best-effort, never throws). */
export function saveServerState(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(serverState, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing bot_state.json:', err);
  }
}

/** Prepends a timestamped entry to the bot log ring buffer (max 200) and persists. */
export function addServerLog(msg: string): void {
  const timestamp = new Date().toLocaleTimeString('th-TH', { hour12: false });
  const entry = `[${timestamp}] ${msg}`;
  serverState.botLogs.unshift(entry);
  if (serverState.botLogs.length > 200) {
    serverState.botLogs = serverState.botLogs.slice(0, 200);
  }
  saveServerState();
}

/**
 * Returns a copy of botConfig safe to send to clients:
 * the Telegram bot token is masked out so it can never leak through the API.
 */
export function sanitizeBotConfig(): BotConfig {
  const cfg = serverState.botConfig;
  if (!cfg.telegramConfig) return cfg;
  return { ...cfg, telegramConfig: { ...cfg.telegramConfig, botToken: '' } };
}
