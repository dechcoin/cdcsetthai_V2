/**
 * Centralised localStorage key registry.
 *
 * Every module that reads/writes browser storage must use these constants
 * instead of inline string literals, so a key can never drift between the
 * writer (e.g. `lib/botStore.ts`) and the reader/cleaner (e.g. `App.tsx`,
 * `components/TradingStats.tsx`).
 */

/** Current (v2) storage keys used by the dashboard. */
export const STORAGE_KEYS = {
  BOT_CONFIG: 'cdc_stock_bot_config_v2',
  PAPER_ACCOUNT: 'cdc_stock_paper_account_v2',
  TRADE_HISTORY: 'cdc_stock_trade_history_v2',
  SETTRADE_KEYS: 'cdc_settrade_keys_v2',
  TELEGRAM_CONFIG: 'cdc_telegram_config_v2',
  BOT_LOGS: 'cdc_stock_bot_logs_v2',
  CUSTOM_SYMBOLS: 'cdc_stock_custom_symbols_v2',
  WATCHLIST: 'cdc_stock_watchlist_v2',
  DASHBOARD_TOKEN: 'cdc_dashboard_token',
} as const;

/**
 * Legacy pre-v2 keys.
 *
 * These are intentionally kept forever: `removeItem()` is called on them so
 * users upgrading from an older build do not keep stale data around.
 */
export const LEGACY_STORAGE_KEYS = {
  BOT_LOGS: 'cdc_bot_logs_v2',
  TRADE_HISTORY: 'cdc_trade_history_v2',
} as const;

/** Union of every current storage key value. */
export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** Union of every legacy storage key value. */
export type LegacyStorageKey = (typeof LEGACY_STORAGE_KEYS)[keyof typeof LEGACY_STORAGE_KEYS];
