import type { ExecutedTrade, PaperPosition } from '../../src/types';
import { calculateCDCActionZone, isLongEntrySignal, isShortEntrySignal } from '../../src/lib/cdcIndicator';
import { ALL_MARKET_STOCKS, calculateBoardLotShares } from '../../src/lib/stockApi';
import { calculateOrderSize } from '../../src/lib/positionSizing';
import { calculateSpotPnl } from '../../src/lib/pnl';
import { addServerLog, getServerState, saveServerState } from '../repositories/stateRepository';
import { fetchKlinesCached, isThaiMarketOpen, stripFormingCandle } from './marketData';
import { sendTelegramAlert } from './telegram.service';

/**
 * 24/7 server-side trading engine (CDC Action Zone V3 strategy).
 *
 * The engine has NO side effects on import: `startTradingEngine()` must be
 * called explicitly by the app bootstrap (`server/index.ts`). This keeps the
 * module testable and prevents accidentally starting live trading merely by
 * importing the file.
 *
 * State access goes through the `stateRepository` singleton; the engine mutates
 * properties of `getServerState()` and then persists with `saveServerState()`.
 */

let isCycleRunning = false;

export async function runServerBotCycle() {
  if (isCycleRunning) return;
  const state = getServerState();
  const config = state.botConfig;
  if (!config.isActive) return;

  // ห้ามส่งคำสั่งซื้อขายนอกเวลาทำการของตลาดหลักทรัพย์ (SET)
  if (!isThaiMarketOpen()) return;

  isCycleRunning = true;
  try {
    const dirMode = config.directionMode ?? 'LONG_ONLY';
    const scanMode = config.scanMode || 'WATCHLIST';
    let symbolsToEvaluate: string[] = [];
    if (scanMode === 'MULTI_SCAN') {
      symbolsToEvaluate = ALL_MARKET_STOCKS;
    } else if (scanMode === 'SINGLE') {
      symbolsToEvaluate = [config.symbol];
    } else {
      // 🎯 WATCHLIST (Default)
      const wl = config.customWatchlist && config.customWatchlist.length > 0
        ? config.customWatchlist
        : ['PTT', 'CPALL', 'DELTA', 'KBANK', 'ADVANC', 'AOT'];
      symbolsToEvaluate = wl;
    }

    for (const sym of symbolsToEvaluate) {
      if (!state.botConfig.isActive) break;

      const rawCandles = await fetchKlinesCached(sym, config.timeframe, 300);
      if (rawCandles.length < 30) continue;

      // 🎯 กราฟ 1D/1W: ตัดสินใจบนแท่งเทียนที่ "ปิดสมบูรณ์แล้ว" เท่านั้น
      // เพื่อไม่ให้สัญญาณ เขียว/แดง กลับตัวกลางวัน (แท่งล่าสุดยังฟอร์มไม่จบ)
      const signalCandles = stripFormingCandle(rawCandles, config.timeframe);
      const cdcCandles = calculateCDCActionZone(signalCandles, config.fastEmaPeriod, config.slowEmaPeriod);
      if (cdcCandles.length < 2) continue;

      const latestCandle = cdcCandles[cdcCandles.length - 1];
      const currentPrice = rawCandles[rawCandles.length - 1].close;

      // 1. Check Exits on Active Positions for this symbol
      const existingPosIndex = state.paperAccount.activePositions.findIndex((p) => p.symbol === sym);
      if (existingPosIndex !== -1) {
        const pos = state.paperAccount.activePositions[existingPosIndex];

        // Update Highest Price Reached for Trailing Stop Engine
        pos.highestPriceSinceEntry = Math.max(
          pos.highestPriceSinceEntry || pos.entryPrice,
          currentPrice
        );

        if (config.useTrailingStop && config.trailingStopPercent > 0) {
          pos.trailingStopPrice = pos.highestPriceSinceEntry * (1 - config.trailingStopPercent / 100);
        }

        const { pnlPercent, pnlThb: pnlUsdt } = calculateSpotPnl(
          pos.side,
          pos.entryPrice,
          currentPrice,
          pos.amount
        );

        let exitReason = '';
        if (config.stopLossPercent > 0 && pnlPercent <= -config.stopLossPercent) {
          exitReason = `Stop Loss (-${config.stopLossPercent}%)`;

          // Stop Loss Lock & Whipsaw Protection
          if (config.useStopLossLock !== false) {
            if (!state.botConfig.stopLossLocks) state.botConfig.stopLossLocks = {};
            state.botConfig.stopLossLocks[pos.symbol] = {
              symbol: pos.symbol,
              lockedAt: Date.now(),
              triggerPrice: currentPrice,
              triggerZone: latestCandle.zone || 'RED',
              reason: `Stop Loss Cut-Loss @ ฿${currentPrice}`,
            };
            addServerLog(`🔒 [SL LOCK] ล็อก ${pos.symbol} ป้องกัน Whipsaw จะไม่เข้าซื้อซ้ำในรอบเดิม`);
          }
        } else if (
          config.useTrailingStop &&
          config.trailingStopPercent > 0 &&
          pos.highestPriceSinceEntry &&
          pos.highestPriceSinceEntry > pos.entryPrice * (1 + (config.trailingStopPercent * 0.5) / 100) &&
          pos.trailingStopPrice &&
          currentPrice <= pos.trailingStopPrice
        ) {
          exitReason = `Trailing Stop Lock (-${config.trailingStopPercent}% จากจุดสูงสุด ฿${pos.highestPriceSinceEntry.toFixed(2)})`;
        } else if (config.takeProfitPercent > 0 && pnlPercent >= config.takeProfitPercent) {
          exitReason = `Take Profit (+${config.takeProfitPercent}%)`;
        } else {
          const isExitSignal =
            pos.side === 'SHORT'
              ? config.buyOnSignal.includes(latestCandle.zone as any)
              : config.sellOnSignal.includes(latestCandle.zone as any);
          if (isExitSignal) {
            exitReason = `CDC Exit Signal ${latestCandle.colorNameTh}`;
          }
        }

        if (exitReason) {
          const returnUsdt = Math.max(0, pos.usdtInvested + pnlUsdt);
          state.paperAccount.usdtBalance += returnUsdt;
          state.paperAccount.activePositions.splice(existingPosIndex, 1);
          state.paperAccount.totalTrades += 1;
          if (pnlUsdt > 0) {
            state.paperAccount.winningTrades += 1;
          } else {
            state.paperAccount.losingTrades += 1;
          }
          state.paperAccount.totalProfitUsdt += pnlUsdt;

          const trade: ExecutedTrade = {
            id: `trade_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            symbol: pos.symbol,
            timeframe: config.timeframe,
            side: pos.side === 'LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT',
            price: currentPrice,
            amount: pos.amount,
            usdtValue: returnUsdt,
            pnlUsdt: Number(pnlUsdt.toFixed(2)),
            pnlPercent: Number(pnlPercent.toFixed(2)),
            reason: `[Auto 100%] ${exitReason}`,
            timestamp: Date.now(),
            mode: config.mode,
          };

          state.tradeHistory.unshift(trade);
          if (state.tradeHistory.length > 500) {
            state.tradeHistory = state.tradeHistory.slice(0, 500);
          }

          addServerLog(
            `🛑 [AUTO CLOSE ${pos.side}] ${pos.symbol} @ ฿${currentPrice} | PnL: ${pnlUsdt >= 0 ? '+' : ''}฿${pnlUsdt.toFixed(2)} (${pnlPercent.toFixed(2)}%) | เหตุผล: ${exitReason}`
          );
          saveServerState();

          const isWin = pnlUsdt >= 0;
          sendTelegramAlert(
            `${isWin ? '🎯' : '🛑'} <b>[CDC Stock Bot] ปิดสถานะหุ้น (${pos.side})</b>\n\n` +
            `📈 <b>หุ้น:</b> <code>${pos.symbol}</code>\n` +
            `💰 <b>ราคาปิด:</b> ฿${currentPrice.toFixed(2)}\n` +
            `📊 <b>จำนวน:</b> ${pos.amount.toLocaleString()} หุ้น (${(pos.amount / 100).toLocaleString()} Lots)\n` +
            `💵 <b>ผลตอบแทน:</b> ${isWin ? '+' : ''}฿${pnlUsdt.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)\n` +
            `📝 <b>เหตุผล:</b> ${exitReason}\n` +
            `⏱️ <b>ไทม์เฟรม:</b> ${config.timeframe}\n` +
            `💼 <b>โหมด:</b> ${config.mode === 'SETTRADE_LIVE' ? '⚡ InnovestX Live' : '🟢 Paper Trading'}\n` +
            `📅 <b>เวลา:</b> ${new Date().toLocaleTimeString('th-TH')}`
          );
        } else {
          pos.currentPnlUsdt = Number(pnlUsdt.toFixed(2));
          pos.currentPnlPercent = Number(pnlPercent.toFixed(2));
        }
        continue;
      }

      // 2. Check Entries for this symbol
      const maxPositions = Math.max(1, Math.min(20, config.maxOpenPositions || 5));
      if (state.paperAccount.activePositions.length >= maxPositions) {
        break; // Max concurrent slots reached
      }

      // Check Stop Loss Lock / Whipsaw Protection
      if (config.useStopLossLock !== false && config.stopLossLocks?.[sym]) {
        if (latestCandle.zone === 'RED') {
          delete config.stopLossLocks[sym];
          saveServerState();
          addServerLog(`🔓 [SL UNLOCK] ปลดล็อก ${sym} หลังเข้าสู่โซนแดง (เตรียมรอบใหม่)`);
        } else {
          // Symbol is locked against re-entry in this cycle
          continue;
        }
      }

      const isBuySignal = isLongEntrySignal(cdcCandles, config.buyOnSignal);
      const isSellSignal = isShortEntrySignal(cdcCandles, config.sellOnSignal);

      let targetSide: 'LONG' | 'SHORT' | null = null;
      if ((dirMode === 'LONG_ONLY' || dirMode === 'BOTH') && isBuySignal) {
        targetSide = 'LONG';
      } else if ((dirMode === 'SHORT_ONLY' || dirMode === 'BOTH') && isSellSignal) {
        targetSide = 'SHORT';
      }

      if (targetSide) {
        const rawBudget = calculateOrderSize(config, state.paperAccount);

        // SET Board Lot (100 shares) Validation — spot: เงินสดเต็มจำนวน ไม่มีเลเวอเรจ
        const lotInfo = calculateBoardLotShares(rawBudget, currentPrice);
        if (!lotInfo.isValidLot) {
          addServerLog(`⚠️ [BOARD LOT SKIPPED] ${sym} @ ฿${currentPrice} เงินลงทุน ฿${rawBudget.toFixed(2)} ไม่พอสำหรับ 1 Lot (100 หุ้น = ฿${(currentPrice * 100).toFixed(2)})`);
          continue;
        }

        const sharesAmount = lotInfo.shares;
        const actualTradeUsdt = lotInfo.actualCostThb;

        if (actualTradeUsdt >= 10 && state.paperAccount.usdtBalance >= actualTradeUsdt) {
          state.paperAccount.usdtBalance -= actualTradeUsdt;

          const newPos: PaperPosition = {
            symbol: sym,
            side: targetSide,
            entryPrice: currentPrice,
            amount: sharesAmount,
            usdtInvested: actualTradeUsdt,
            entryTime: Date.now(),
            currentPnlUsdt: 0,
            currentPnlPercent: 0,
          };

          state.paperAccount.activePositions.push(newPos);

          const trade: ExecutedTrade = {
            id: `trade_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            symbol: sym,
            timeframe: config.timeframe,
            side: targetSide === 'LONG' ? 'BUY' : 'SELL',
            price: currentPrice,
            amount: sharesAmount,
            usdtValue: actualTradeUsdt,
            reason: `[Auto 100% Entry] CDC ${latestCandle.colorNameTh} (${targetSide})`,
            timestamp: Date.now(),
            mode: config.mode,
          };

          state.tradeHistory.unshift(trade);
          addServerLog(
            `🚀 [AUTO OPEN ${targetSide}] ${sym} @ ฿${currentPrice} | ทุน ฿${actualTradeUsdt.toFixed(2)} บาท (${sharesAmount.toLocaleString()} หุ้น / ${(sharesAmount / 100).toLocaleString()} Lots) | สัญญาณ ${latestCandle.colorNameTh}`
          );
          saveServerState();

          sendTelegramAlert(
            `🚀 <b>[CDC Action Zone V3] เข้าซื้อหุ้น (${targetSide})</b>\n\n` +
            `📈 <b>หุ้น:</b> <code>${sym}</code>\n` +
            `💰 <b>ราคาเข้า:</b> ฿${currentPrice.toFixed(2)}\n` +
            `📊 <b>จำนวน:</b> ${sharesAmount.toLocaleString()} หุ้น (${(sharesAmount / 100).toLocaleString()} Lots)\n` +
            `💵 <b>เงินลงทุน:</b> ฿${actualTradeUsdt.toLocaleString('en-US', { minimumFractionDigits: 2 })} THB\n` +
            `🎯 <b>สัญญาณ:</b> ${latestCandle.colorNameTh} (CDC Action Zone)\n` +
            `⏱️ <b>ไทม์เฟรม:</b> ${config.timeframe}\n` +
            `💼 <b>โหมด:</b> ${config.mode === 'SETTRADE_LIVE' ? '⚡ InnovestX Live' : '🟢 Paper Trading'}\n` +
            `📅 <b>เวลา:</b> ${new Date().toLocaleTimeString('th-TH')}`
          );
        }
      }
    }
  } catch (err) {
    console.error('Error in server bot cycle:', err);
  } finally {
    isCycleRunning = false;
  }
}

/**
 * Schedules the next cycle, throttled per timeframe to avoid hammering the data
 * provider and getting rate-limited / banned.
 */
function scheduleBotCycle(): void {
  const tf = getServerState().botConfig.timeframe || '1d';
  const intervalMs =
    tf === '1m' || tf === '5m' ? 15000 : tf === '15m' || tf === '1h' ? 30000 : 60000;
  setTimeout(() => {
    runServerBotCycle().finally(scheduleBotCycle);
  }, intervalMs);
}

/**
 * Starts the continuous background execution loop.
 *
 * Must be invoked explicitly from `server/index.ts` — importing this module has
 * no side effects by design.
 */
export function startTradingEngine(): void {
  scheduleBotCycle();
  console.log('⚙️  Trading engine scheduled (CDC Action Zone V3).');
}
