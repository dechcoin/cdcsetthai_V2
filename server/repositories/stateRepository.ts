import fs from 'fs';
import path from 'path';
import type { BotConfig, PaperAccount, ExecutedTrade } from '../../src/types';
import { decryptSecret, encryptSecret, hasSecretEncryptionKey, isEncryptedSecret } from '../utils/secretVault';

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
    usePartialTakeProfit: true,
    partialTakeProfitR: 1.5,
    partialTakeProfitPercent: 50,
    useTrailingStop: false,
    trailingStopPercent: 3,
    buyOnSignal: ['GREEN'],
    sellOnSignal: ['RED'],
    mode: 'PAPER',
    scanMode: 'WATCHLIST', // 🎯 ค่าเริ่มต้น: เล่นเฉพาะหุ้นใน Watchlist
    customWatchlist: ['PTT', 'CPALL', 'DELTA', 'KBANK', 'ADVANC', 'AOT'],
    directionMode: 'LONG_ONLY',
    quantMinScore: 80,
    useQuantFilter: true,
    strictGoldenCrossOnly: true,
    maxBarsSinceCrossover: 2,
    skipExtendedPrice: true,
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
    peakEquityUsdt: 100000,
    currentDrawdownPercent: 0,
    consecutiveLosses: 0,
    riskHalted: false,
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
      let needsSecureRewrite = false;
      let liveApiKeys: LiveApiKeys | undefined;
      let telegramBotToken = String(parsed.botConfig?.telegramConfig?.botToken || '');

      if (parsed.encryptedLiveApiKeys) {
        if (hasSecretEncryptionKey() && isEncryptedSecret(parsed.encryptedLiveApiKeys)) {
          try {
            liveApiKeys = JSON.parse(decryptSecret(parsed.encryptedLiveApiKeys)) as LiveApiKeys;
          } catch {
            needsSecureRewrite = true;
            console.error('Stored broker credentials could not be decrypted; live credentials were disabled.');
          }
        } else {
          needsSecureRewrite = true;
          console.error('Stored broker credentials were disabled because LIVE_KEYS_ENCRYPTION_KEY is unavailable.');
        }
      } else if (parsed.liveApiKeys) {
        // Migrate the former plaintext JSON field only when a vault key exists.
        if (hasSecretEncryptionKey()) liveApiKeys = parsed.liveApiKeys as LiveApiKeys;
        else console.error('Legacy plaintext broker credentials were removed; configure LIVE_KEYS_ENCRYPTION_KEY and enter them again.');
        needsSecureRewrite = true;
      }

      if (parsed.encryptedTelegramBotToken) {
        if (hasSecretEncryptionKey() && isEncryptedSecret(parsed.encryptedTelegramBotToken)) {
          try {
            telegramBotToken = decryptSecret(parsed.encryptedTelegramBotToken);
          } catch {
            telegramBotToken = '';
            needsSecureRewrite = true;
            console.error('Stored Telegram token could not be decrypted and was disabled.');
          }
        } else {
          telegramBotToken = '';
          needsSecureRewrite = true;
        }
      } else if (telegramBotToken) {
        if (!hasSecretEncryptionKey()) {
          telegramBotToken = '';
          console.error('Legacy plaintext Telegram token was removed; configure LIVE_KEYS_ENCRYPTION_KEY and enter it again.');
        }
        needsSecureRewrite = true;
      }

      delete parsed.liveApiKeys;
      delete parsed.encryptedLiveApiKeys;
      delete parsed.encryptedTelegramBotToken;

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
        // The former default bought both the BLUE alert and the GREEN confirmation.
        // Preserve bespoke selections, but migrate that exact default to GREEN-only.
        if (Array.isArray(parsed.botConfig.buyOnSignal)
          && parsed.botConfig.buyOnSignal.length === 2
          && parsed.botConfig.buyOnSignal.includes('BLUE')
          && parsed.botConfig.buyOnSignal.includes('GREEN')) {
          parsed.botConfig.buyOnSignal = ['GREEN'];
          needsSecureRewrite = true;
        }
        // There is no broker execution adapter, so never resume a persisted Live mode.
        if (parsed.botConfig.mode === 'SETTRADE_LIVE') {
          parsed.botConfig.mode = 'PAPER';
          parsed.botConfig.isActive = false;
          needsSecureRewrite = true;
        } else {
          parsed.botConfig.mode = 'PAPER';
        }
        if (parsed.botConfig.directionMode !== 'LONG_ONLY') {
          parsed.botConfig.directionMode = 'LONG_ONLY';
          needsSecureRewrite = true;
        }
        if (parsed.botConfig.telegramConfig) parsed.botConfig.telegramConfig.botToken = telegramBotToken;
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
        liveApiKeys,
      });
      console.log('✅ Loaded persistent bot state from disk.');
      if (needsSecureRewrite) saveServerState();
    }
  } catch (err) {
    console.error('Error reading bot_state.json:', err);
    setServerState({ ...DEFAULT_SERVER_STATE });
  }
}

/** Writes the current state to disk (best-effort, never throws). */
export function saveServerState(): boolean {
  try {
    const persisted: Record<string, any> = {
      ...serverState,
      botConfig: {
        ...serverState.botConfig,
        telegramConfig: serverState.botConfig.telegramConfig
          ? { ...serverState.botConfig.telegramConfig, botToken: '' }
          : undefined,
      },
    };
    delete persisted.liveApiKeys;
    delete persisted.encryptedLiveApiKeys;
    delete persisted.encryptedTelegramBotToken;

    if (serverState.liveApiKeys) {
      if (!hasSecretEncryptionKey()) {
        console.error('Refusing to persist broker credentials without LIVE_KEYS_ENCRYPTION_KEY.');
        return false;
      }
      persisted.encryptedLiveApiKeys = encryptSecret(JSON.stringify(serverState.liveApiKeys));
    }

    const telegramToken = serverState.botConfig.telegramConfig?.botToken;
    if (telegramToken) {
      if (!hasSecretEncryptionKey()) {
        console.error('Refusing to persist Telegram credentials without LIVE_KEYS_ENCRYPTION_KEY.');
        return false;
      }
      persisted.encryptedTelegramBotToken = encryptSecret(telegramToken);
    }

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(persisted, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing bot_state.json:', err);
    return false;
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
