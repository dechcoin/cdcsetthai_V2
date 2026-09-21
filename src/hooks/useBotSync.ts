import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { BotConfig, ExecutedTrade, PaperAccount } from '../types';
import { fetchBotServerState } from '../lib/botApi';
import {
  getStoredBotConfig,
  getStoredLogs,
  getStoredPaperAccount,
  getStoredTradeHistory,
} from '../lib/botStore';

/**
 * Owns the cloud-synchronised bot state (config, paper account, trade history,
 * logs) and keeps it fresh against the server.
 *
 * The server is the single source of truth for the 24/7 bot, so the dashboard
 * polls it and mirrors the result — this is what makes state consistent across
 * devices. `localStorage` only seeds the first render so the UI paints instantly
 * (and still works offline).
 *
 * Business mutations (saving config, placing orders) stay in `App`: the hook
 * only exposes the state + `refreshFromServer()` so callers can pull the
 * authoritative values right after a mutation.
 */

export interface UseBotSyncOptions {
  /** Server poll interval in ms (default 3.5s). */
  intervalMs?: number;
}

export interface UseBotSyncResult {
  botConfig: BotConfig;
  setBotConfig: Dispatch<SetStateAction<BotConfig>>;
  paperAccount: PaperAccount;
  setPaperAccount: Dispatch<SetStateAction<PaperAccount>>;
  tradeHistory: ExecutedTrade[];
  setTradeHistory: Dispatch<SetStateAction<ExecutedTrade[]>>;
  botLogs: string[];
  setBotLogs: Dispatch<SetStateAction<string[]>>;
  /** Fetches the authoritative state once (call after a server mutation). */
  refreshFromServer: () => Promise<void>;
}

const DEFAULT_SYNC_INTERVAL_MS = 3500;

export function useBotSync({
  intervalMs = DEFAULT_SYNC_INTERVAL_MS,
}: UseBotSyncOptions = {}): UseBotSyncResult {
  // Seed from local storage so the first paint never has to wait for the network.
  const [botConfig, setBotConfig] = useState<BotConfig>(getStoredBotConfig);
  const [paperAccount, setPaperAccount] = useState<PaperAccount>(getStoredPaperAccount);
  const [tradeHistory, setTradeHistory] = useState<ExecutedTrade[]>(getStoredTradeHistory);
  const [botLogs, setBotLogs] = useState<string[]>(getStoredLogs);

  const isMountedRef = useRef<boolean>(true);

  /**
   * Pulls the authoritative state from the server.
   *
   * The server masks the Telegram botToken out of every response, so the token
   * the user typed locally must be preserved when the server sends an empty one.
   */
  const syncOnce = useCallback(async () => {
    try {
      const serverData = await fetchBotServerState();
      if (serverData && isMountedRef.current) {
        setBotConfig((prev) => {
          const merged = { ...prev, ...serverData.botConfig };
          // เซิร์ฟเวอร์ mask botToken ออก (ไม่ส่งกลับมา) — เก็บ token ที่ผู้ใช้กรอกไว้ในเครื่องไว้
          const serverTg = serverData.botConfig.telegramConfig;
          const prevTg = prev.telegramConfig;
          if (serverTg) {
            merged.telegramConfig = {
              ...serverTg,
              botToken: serverTg.botToken || prevTg?.botToken || '',
            };
          }
          return merged;
        });
        setPaperAccount(serverData.paperAccount);
        setTradeHistory(serverData.tradeHistory);
        setBotLogs(serverData.botLogs);
      }
    } catch {
      // Fallback to local storage if offline
    }
  }, []);

  // Poll the server for 24/7 cross-device consistency.
  useEffect(() => {
    isMountedRef.current = true;
    syncOnce();
    const syncInterval = setInterval(syncOnce, intervalMs);
    return () => {
      isMountedRef.current = false;
      clearInterval(syncInterval);
    };
  }, [syncOnce, intervalMs]);

  return {
    botConfig,
    setBotConfig,
    paperAccount,
    setPaperAccount,
    tradeHistory,
    setTradeHistory,
    botLogs,
    setBotLogs,
    refreshFromServer: syncOnce,
  };
}
