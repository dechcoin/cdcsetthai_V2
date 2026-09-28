import React, { useState, useEffect } from 'react';
import { Timeframe, BotConfig, SettradeApiKeys } from './types';
import {
  getStoredBotConfig,
  saveBotConfig,
  savePaperAccount,
  getStoredBrokerKeys,
  saveBrokerKeys,
  getStoredTelegramConfig,
  saveTelegramConfig,
  getStoredWatchlist,
  saveStoredWatchlist,
  DEFAULT_PAPER_ACCOUNT,
} from './lib/botStore';
import {
  saveBotServerConfig,
  sendManualOrderToServer,
  closePositionOnServer,
  resetBotServerPaperAccount,
  saveBrokerKeysToServer,
  unlockSymbolOnServer,
  clearBotServerLogs,
} from './lib/botApi';
import { fetchStockTicker24h } from './lib/stockApi';
import { calculateOrderSize } from './lib/positionSizing';
import { calculateSpotPnl } from './lib/pnl';
import { STORAGE_KEYS, LEGACY_STORAGE_KEYS } from './constants/storageKeys';
import { useBotSync } from './hooks/useBotSync';
import { useMarketData } from './hooks/useMarketData';
import { Header } from './components/Header';
import { CDCChart } from './components/CDCChart';
import { BotControlPanel } from './components/BotControlPanel';
import { BacktestingView } from './components/BacktestingView';
import { MarketScanner } from './components/MarketScanner';
import { AiAnalystPanel } from './components/AiAnalystPanel';
import { SettradeSettingsModal } from './components/SettradeSettingsModal';
import { TradeHistoryTable } from './components/TradeHistoryTable';
import { TradingStats } from './components/TradingStats';
import { CoffeeDonation } from './components/CoffeeDonation';
import { WalletPortfolio } from './components/WalletPortfolio';

export default function App() {
  const [activeTab, setActiveTab] = useState<'chart' | 'wallet' | 'backtest' | 'scanner' | 'ai' | 'history' | 'stats' | 'coffee'>('chart');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Core Central State (Synchronized with Server) — owned by the useBotSync hook
  const {
    botConfig,
    setBotConfig,
    paperAccount,
    setPaperAccount,
    tradeHistory,
    setTradeHistory,
    botLogs,
    setBotLogs,
    refreshFromServer,
  } = useBotSync();

  const [chartTimeframe, setChartTimeframe] = useState<Timeframe>(() => getStoredBotConfig().timeframe || '1d');
  const [brokerKeys, setBrokerKeys] = useState<SettradeApiKeys>(getStoredBrokerKeys);
  const [telegramConfig, setTelegramConfig] = useState<{ botToken: string; chatId: string; isEnabled: boolean }>(getStoredTelegramConfig);

  // Unified Watchlist state (single source of truth shared between MarketScanner, BotControlPanel, and Cloud Server)
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    const fromConfig = getStoredBotConfig().customWatchlist;
    if (fromConfig && fromConfig.length > 0) return fromConfig;
    return getStoredWatchlist();
  });

  // Market data (candles + ticker tape + live price) — owned by the useMarketData hook,
  // which also runs the polling loop and the initial load.
  const {
    candles,
    allTickers,
    pttPrice,
    cpallPrice,
    currentPriceInfo,
    isLoadingCandles,
    tickerStatus,
    loadCandles,
    loadTickers,
  } = useMarketData({
    symbol: botConfig.symbol,
    chartTimeframe,
    botTimeframe: botConfig.timeframe,
    fastEmaPeriod: botConfig.fastEmaPeriod,
    slowEmaPeriod: botConfig.slowEmaPeriod,
  });

  // Notification Toast State
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'buy' | 'sell' | 'info' } | null>(null);

  const showToast = (text: string, type: 'buy' | 'sell' | 'info' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 5000);
  };

  // NOTE: the market-data fetch logic, the 3.5s server-sync loop and both polling
  // intervals were extracted into `useMarketData` / `useBotSync` above, so this
  // component no longer owns them.

  // Real-time PnL update effect for ALL open positions when ticker prices update
  useEffect(() => {
    if (!allTickers || allTickers.length === 0) return;
    const tickerPriceMap = new Map<string, number>();
    for (const t of allTickers) {
      tickerPriceMap.set(t.symbol, t.lastPrice);
    }

    setPaperAccount((prev) => {
      let hasChanges = false;
      const updatedPositions = prev.activePositions.map((pos) => {
        const livePrice = tickerPriceMap.get(pos.symbol) || (pos.symbol === currentPriceInfo.symbol ? currentPriceInfo.price : 0);
        if (livePrice > 0) {
          const { pnlPercent, pnlThb: pnlUsdt } = calculateSpotPnl(
            pos.side,
            pos.entryPrice,
            livePrice,
            pos.amount
          );

          if (Math.abs((pos.currentPnlUsdt || 0) - pnlUsdt) > 0.001) {
            hasChanges = true;
            return {
              ...pos,
              currentPnlUsdt: Number(pnlUsdt.toFixed(2)),
              currentPnlPercent: Number(pnlPercent.toFixed(2)),
            };
          }
        }
        return pos;
      });

      if (hasChanges) {
        const newAcc = { ...prev, activePositions: updatedPositions };
        savePaperAccount(newAcc);
        return newAcc;
      }
      return prev;
    });
  }, [allTickers, currentPriceInfo]);

  // Save config state updates to storage and cloud server
  const handleSaveBotConfig = async (updated: BotConfig) => {
    const configWithWatchlist: BotConfig = {
      ...updated,
      scanMode: updated.scanMode || 'WATCHLIST',
      customWatchlist:
        updated.customWatchlist && updated.customWatchlist.length > 0
          ? updated.customWatchlist
          : getStoredWatchlist(),
    };
    const saved = await saveBotServerConfig(configWithWatchlist);
    if (!saved) {
      showToast('เซิร์ฟเวอร์ปฏิเสธการตั้งค่า หรือยังไม่ผ่านการยืนยันตัวตน', 'sell');
      return false;
    }
    setBotConfig(configWithWatchlist);
    saveBotConfig(configWithWatchlist);
    return true;
  };

  const handleSaveBrokerKeys = async (updatedKeys: SettradeApiKeys) => {
    if (!updatedKeys.apiKey || !updatedKeys.apiSecret) return;
    const saved = await saveBrokerKeysToServer(updatedKeys);
    if (!saved) {
      showToast('ยังบันทึก API Key ไม่ได้: ตรวจสอบ LIVE_KEYS_ENCRYPTION_KEY และการยืนยันตัวตน', 'sell');
      return;
    }
    setBrokerKeys({ apiKey: '', apiSecret: '' });
    saveBrokerKeys({ apiKey: '', apiSecret: '' });
    showToast('บันทึก API Key แบบเข้ารหัสบนเซิร์ฟเวอร์แล้ว (Live trading ยังไม่รองรับ)', 'info');
  };

  // Update unified watchlist (from MarketScanner / BotControlPanel) and sync to bot config + cloud server
  const handleUpdateWatchlist = async (updated: string[]) => {
    const cleaned = Array.from(
      new Set(updated.map((s) => s.toUpperCase().trim().replace(/[^A-Z0-9]/g, '')).filter(Boolean))
    );
    setWatchlist(cleaned);
    saveStoredWatchlist(cleaned);
    const next: BotConfig = { ...botConfig, customWatchlist: cleaned };
    setBotConfig(next);
    saveBotConfig(next);
    await saveBotServerConfig(next);
  };

  const handleResetPaperAccount = async () => {
    if (confirm('คุณต้องการรีเซ็ตยอดเงินบัญชีทดลอง (Paper Trading) เป็น ฿100,000 THB หรือไม่?')) {
      await resetBotServerPaperAccount();
      setPaperAccount(DEFAULT_PAPER_ACCOUNT);
      savePaperAccount(DEFAULT_PAPER_ACCOUNT);
      showToast('รีเซ็ตยอดเงินพอร์ตจำลองเป็น ฿100,000 THB แล้ว', 'info');
    }
  };

  const currentPrice = currentPriceInfo.price;
  const currentCandle = candles.length > 0 ? candles[candles.length - 1] : null;

  // Manual Buy Handler (Manual LONG)
  const handleManualBuy = async (customAmountUsdt?: number) => {
    const price = currentPriceInfo.price;
    if (!price || price === 0) return;
    const existingPos = paperAccount.activePositions.find((p) => p.symbol === botConfig.symbol);
    if (existingPos) {
      showToast(`คุณมีสถานะถือครองหุ้น ${botConfig.symbol} อยู่แล้ว`, 'info');
      return;
    }

    const tradeUsdt = customAmountUsdt !== undefined && customAmountUsdt > 0
      ? customAmountUsdt
      : calculateOrderSize(botConfig, paperAccount);

    if (tradeUsdt < 10) {
      showToast('ยอดเงินคงเหลือไม่พอสำหรับซื้อหุ้น (ขั้นต่ำ ฿10 บาท)', 'info');
      return;
    }

    const res = await sendManualOrderToServer({
      symbol: botConfig.symbol,
      side: 'LONG',
      amountUsdt: tradeUsdt,
      currentPrice: price,
    });

    if (res.success) {
      showToast(`ซื้อหุ้น ${botConfig.symbol} สำเร็จ`, 'buy');
      // Pull the authoritative account / history / logs from the server right away
      await refreshFromServer();
    } else {
      showToast(res.error || 'เกิดข้อผิดพลาดในการซื้อหุ้น', 'sell');
    }
  };

  // Manual Close Handler
  const handleManualSell = async (symbolToSell?: string) => {
    const sym = symbolToSell || botConfig.symbol;

    let price = 0;
    if (sym === currentPriceInfo.symbol && currentPriceInfo.price > 0) {
      price = currentPriceInfo.price;
    } else {
      const ticker = allTickers.find((t) => t.symbol === sym);
      if (ticker && ticker.lastPrice > 0) {
        price = ticker.lastPrice;
      } else {
        try {
          const tData = await fetchStockTicker24h(sym);
          if (tData.length > 0 && tData[0].lastPrice > 0) {
            price = tData[0].lastPrice;
          }
        } catch (e) {
          console.error(`Failed to fetch price for ${sym}:`, e);
        }
      }
    }

    if (!price || price === 0) {
      showToast(`ไม่สามารถดึงราคาปัจจุบันของ ${sym} ได้`, 'sell');
      return;
    }

    const res = await closePositionOnServer({
      symbol: sym,
      currentPrice: price,
      reason: 'Manual Close Button',
    });

    if (res.success) {
      showToast(`ขายปิดสถานะหุ้น ${sym} เรียบร้อยแล้ว`, 'info');
      await refreshFromServer();
    } else {
      showToast(res.error || 'ไม่พบสถานะหุ้นที่ต้องการปิด', 'sell');
    }
  };

  const handleCloseSpecificPosition = async (sym: string) => {
    await handleManualSell(sym);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-12 antialiased overflow-x-hidden">
      {/* Toast Notification Popup */}
      {toastMessage && (
        <div
          className={`fixed bottom-3 left-3 right-3 sm:bottom-6 sm:left-auto sm:right-6 z-50 max-w-[calc(100vw-1.5rem)] px-4 py-3 rounded-2xl shadow-2xl border flex items-center justify-center sm:justify-start space-x-2 text-center sm:text-left text-xs font-bold transition-all animate-bounce ${
            toastMessage.type === 'buy'
              ? 'bg-emerald-600 text-white border-emerald-400'
              : toastMessage.type === 'sell'
              ? 'bg-rose-600 text-white border-rose-400'
              : 'bg-slate-800 text-white border-slate-700'
          }`}
        >
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Header Bar */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        botConfig={botConfig}
        paperAccount={paperAccount}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onResetPaperAccount={handleResetPaperAccount}
        onToggleBot={async () => {
          const nextState = !botConfig.isActive;
          const saved = await handleSaveBotConfig({ ...botConfig, isActive: nextState });
          if (saved) showToast(nextState ? 'เปิดระบบ Paper Trading อัตโนมัติแล้ว' : 'หยุดระบบอัตโนมัติ CDC Stock Bot แล้ว', 'info');
        }}
        pttPrice={pttPrice}
        cpallPrice={cpallPrice}
        tickers={allTickers}
        tickerStatus={tickerStatus}
        onRetryTickers={loadTickers}
        onSelectSymbol={(selectedSymbol) => {
          handleSaveBotConfig({ ...botConfig, symbol: selectedSymbol });
          setActiveTab('chart');
          showToast(`เลือกหุ้น ${selectedSymbol} ขึ้นชาร์ตเรียบร้อยแล้ว`, 'info');
        }}
      />

      {/* Main Content Body */}
      <main className="max-w-7xl mx-auto min-w-0 px-3 sm:px-6 lg:px-8 pt-3 sm:pt-6 space-y-4 sm:space-y-6">
        {activeTab === 'chart' && (
          <div className="space-y-6">
            <CDCChart
              candles={candles}
              symbol={botConfig.symbol}
              timeframe={chartTimeframe}
              botTimeframe={botConfig.timeframe}
              isBotActive={botConfig.isActive}
              onSymbolChange={(newSym) => handleSaveBotConfig({ ...botConfig, symbol: newSym })}
              onTimeframeChange={(newTf) => setChartTimeframe(newTf)}
              onBotTimeframeChange={(newBotTf) => {
                handleSaveBotConfig({ ...botConfig, timeframe: newBotTf });
                showToast(`เปลี่ยนไทม์เฟรมบอทเป็น ${newBotTf.toUpperCase()} เรียบร้อยแล้ว`, 'info');
              }}
              onRefresh={loadCandles}
              isLoading={isLoadingCandles}
            />

            <BotControlPanel
              botConfig={botConfig}
              paperAccount={paperAccount}
              currentPrice={currentPrice}
              watchlist={watchlist}
              onUpdateWatchlist={handleUpdateWatchlist}
              onSaveConfig={handleSaveBotConfig}
              onToggleBot={() => handleSaveBotConfig({ ...botConfig, isActive: !botConfig.isActive })}
              onManualBuy={handleManualBuy}
              onManualSell={handleManualSell}
              onUnlockSymbol={async (symToUnlock) => {
                await unlockSymbolOnServer(symToUnlock);
                const updatedLocks = { ...(botConfig.stopLossLocks || {}) };
                delete updatedLocks[symToUnlock];
                handleSaveBotConfig({ ...botConfig, stopLossLocks: updatedLocks });
                showToast(`ปลดล็อกหุ้น ${symToUnlock} เรียบร้อยแล้ว`, 'info');
              }}
              botLogs={botLogs}
              onClearLogs={async () => {
                localStorage.removeItem(STORAGE_KEYS.BOT_LOGS);
                localStorage.removeItem(LEGACY_STORAGE_KEYS.BOT_LOGS);
                setBotLogs([]);
                try {
                  await clearBotServerLogs();
                  showToast('ล้างบันทึก Bot Activity Console เรียบร้อยแล้ว', 'info');
                } catch (e) {
                  console.error('Failed to clear bot logs on server:', e);
                }
              }}
            />
          </div>
        )}

        {activeTab === 'wallet' && (
          <WalletPortfolio
            paperAccount={paperAccount}
            botConfig={botConfig}
            tickers={allTickers}
            onSelectStock={(selectedSymbol) => {
              handleSaveBotConfig({ ...botConfig, symbol: selectedSymbol });
              setActiveTab('chart');
              showToast(`เลือกหุ้น ${selectedSymbol} ขึ้นชาร์ตเรียบร้อย`, 'info');
            }}
            onClosePosition={handleCloseSpecificPosition}
            onResetPaperAccount={handleResetPaperAccount}
            onUpdateBalance={(newBal) => {
              const updated = { ...paperAccount, usdtBalance: newBal };
              setPaperAccount(updated);
              savePaperAccount(updated);
              showToast('อัปเดตยอดเงินสดคงเหลือเรียบร้อย', 'info');
            }}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        )}

        {activeTab === 'backtest' && <BacktestingView />}

        {activeTab === 'stats' && (
          <TradingStats
            trades={tradeHistory}
            onClearStats={() => {
              localStorage.removeItem(STORAGE_KEYS.TRADE_HISTORY);
              localStorage.removeItem(LEGACY_STORAGE_KEYS.TRADE_HISTORY);
              setTradeHistory([]);
              showToast('ล้างสถิติและประวัติการเทรดทั้งหมดแล้ว', 'info');
            }}
          />
        )}

        {activeTab === 'scanner' && (
          <MarketScanner
            watchlist={watchlist}
            onUpdateWatchlist={handleUpdateWatchlist}
            onSelectStock={(selectedSymbol) => {
              handleSaveBotConfig({ ...botConfig, symbol: selectedSymbol });
              setActiveTab('chart');
              showToast(`เลือกหุ้น ${selectedSymbol} ขึ้นชาร์ตและบอทเรียบร้อย`, 'info');
            }}
          />
        )}

        {activeTab === 'ai' && (
          <AiAnalystPanel
            symbol={botConfig.symbol}
            timeframe={botConfig.timeframe}
            latestCandle={currentCandle}
            recentCandles={candles}
          />
        )}

        {activeTab === 'coffee' && <CoffeeDonation />}

        {activeTab === 'history' && (
          <TradeHistoryTable
            trades={tradeHistory}
            onClearHistory={() => {
              localStorage.removeItem(STORAGE_KEYS.TRADE_HISTORY);
              localStorage.removeItem(LEGACY_STORAGE_KEYS.TRADE_HISTORY);
              setTradeHistory([]);
              showToast('ล้างประวัติการเทรดแล้ว', 'info');
            }}
            activePositions={paperAccount.activePositions}
            onClosePosition={handleCloseSpecificPosition}
            allTickers={allTickers}
          />
        )}
      </main>

      {/* Settrade Broker Settings Modal */}
      <SettradeSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        keys={brokerKeys}
        botConfig={botConfig}
        telegramConfig={telegramConfig}
        onSaveKeys={handleSaveBrokerKeys}
        onSaveConfig={handleSaveBotConfig}
        onSaveTelegramConfig={(newTg) => {
          setTelegramConfig(newTg);
          saveTelegramConfig(newTg);
          showToast('บันทึกการตั้งค่า Telegram เรียบร้อย', 'info');
        }}
      />
    </div>
  );
}
