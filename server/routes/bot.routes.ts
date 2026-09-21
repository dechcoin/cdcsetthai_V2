import express from 'express';
import type { BotConfig, ExecutedTrade, PaperPosition } from '../../src/types';
import { calculateBoardLotShares } from '../../src/lib/stockApi';
import { calculateSpotPnl } from '../../src/lib/pnl';
import {
  addServerLog,
  getServerState,
  saveServerState,
  sanitizeBotConfig,
} from '../repositories/stateRepository';
import { fetchKlinesDirect, isThaiMarketOpen } from '../services/marketData';
import { sendTelegramAlert, sendTelegramMessage } from '../services/telegram.service';
import { sanitizeErrorMessage } from '../utils/validation';

/**
 * Central bot control endpoints.
 *
 * `botRouter` is mounted at `/api/bot` and `telegramRouter` at `/api/telegram`.
 * All state mutations go through the state repository and are persisted with
 * `saveServerState()`.
 */

export const botRouter = express.Router();
export const telegramRouter = express.Router();

// 1. Get central server state
botRouter.get('/state', (req, res) => {
  const state = getServerState();
  return res.json({
    botConfig: sanitizeBotConfig(),
    paperAccount: state.paperAccount,
    tradeHistory: state.tradeHistory,
    botLogs: state.botLogs,
    serverTime: Date.now(),
    isServerRunning: true,
  });
});

// 2. Update bot config
botRouter.post('/config', (req, res) => {
  try {
    const state = getServerState();
    const updated = req.body as Partial<BotConfig>;
    if (Array.isArray(updated.customWatchlist)) {
      updated.customWatchlist = updated.customWatchlist
        .map((s) => String(s).toUpperCase().trim().replace(/[^A-Z0-9]/g, ''))
        .filter((s) => s.length > 0);
    }
    // อย่าให้ client ส่ง botToken ว่างมาลบทิ้ง token ที่เซิร์ฟเวอร์ถืออยู่โดยไม่ตั้งใจ
    if (updated.telegramConfig && !updated.telegramConfig.botToken) {
      updated.telegramConfig.botToken = state.botConfig.telegramConfig?.botToken || '';
    }
    state.botConfig = {
      ...state.botConfig,
      ...updated,
    };
    saveServerState();

    const scopeLabel =
      state.botConfig.scanMode === 'MULTI_SCAN'
        ? 'ทั้งตลาด (SET/mai)'
        : state.botConfig.scanMode === 'SINGLE'
        ? `เฉพาะ ${state.botConfig.symbol}`
        : `Watchlist (${state.botConfig.customWatchlist?.length || 0} หุ้น)`;

    addServerLog(
      `⚙️ อัปเดตการตั้งค่าบอท: โหมด ${scopeLabel} | TF: ${state.botConfig.timeframe} | สถานะ: ${state.botConfig.isActive ? 'เปิดทำงาน 🟢' : 'หยุด 🔴'}`
    );
    return res.json({ success: true, botConfig: state.botConfig });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
});

// 3. Toggle bot active status
botRouter.post('/toggle', (req, res) => {
  const state = getServerState();
  const { isActive } = req.body;
  const next = typeof isActive === 'boolean' ? isActive : !state.botConfig.isActive;
  state.botConfig.isActive = next;
  saveServerState();
  addServerLog(
    next
      ? '🟢 [CLOUD 24/7 STOCK BOT ACTIVATED] เริ่มระบบเทรดหุ้นไทยอัตโนมัติบนคลาวด์'
      : '🔴 [CLOUD STOCK BOT STOPPED] หยุดระบบเทรดอัตโนมัติ'
  );
  sendTelegramAlert(
    next
      ? `🟢 <b>[CDC Stock Bot] เริ่มระบบอัตโนมัติ 24/7</b>\n\n🎯 เฝ้าระวังสัญญาณ CDC Action Zone V3 บนตลาดหุ้นไทย (SET)`
      : `🔴 <b>[CDC Stock Bot] พักการทำงานของบอท</b>`
  );
  return res.json({ success: true, isActive: next });
});

// 4. Manual Order
botRouter.post('/manual-order', (req, res) => {
  try {
    const state = getServerState();
    const { symbol, side, amountUsdt, currentPrice } = req.body;
    if (!symbol || !side || !amountUsdt || !currentPrice) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    // ห้ามส่งคำสั่ง Live นอกเวลาทำการของตลาดหลักทรัพย์ (SET)
    if (state.botConfig.mode === 'SETTRADE_LIVE' && !isThaiMarketOpen()) {
      return res.status(400).json({
        error: 'นอกเวลาทำการซื้อขายของตลาดหลักทรัพย์ (SET): 10:00–12:30 / 14:30–16:30 จันทร์–ศุกร์',
      });
    }

    if (state.paperAccount.usdtBalance < amountUsdt) {
      return res.status(400).json({ error: 'ยอดเงินคงเหลือไม่เพียงพอ' });
    }

    const lotInfo = calculateBoardLotShares(amountUsdt, currentPrice);

    if (!lotInfo.isValidLot) {
      return res.status(400).json({
        error: `จำนวนเงินไม่เพียงพอสำหรับ 1 Board Lot (ขั้นต่ำ 100 หุ้น = ฿${(currentPrice * 100).toFixed(2)} บาท)`,
      });
    }

    const sharesAmount = lotInfo.shares;
    const actualInvested = lotInfo.actualCostThb;

    if (state.paperAccount.usdtBalance < actualInvested) {
      return res.status(400).json({ error: 'ยอดเงินคงเหลือไม่เพียงพอ' });
    }

    state.paperAccount.usdtBalance -= actualInvested;

    const newPos: PaperPosition = {
      symbol,
      side,
      entryPrice: currentPrice,
      amount: sharesAmount,
      usdtInvested: actualInvested,
      entryTime: Date.now(),
      currentPnlUsdt: 0,
      currentPnlPercent: 0,
    };

    state.paperAccount.activePositions.push(newPos);

    const trade: ExecutedTrade = {
      id: `trade_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      symbol,
      timeframe: state.botConfig.timeframe,
      side: side === 'LONG' ? 'BUY' : 'SELL',
      price: currentPrice,
      amount: sharesAmount,
      usdtValue: actualInvested,
      reason: `[Manual Order] เปิด ${side} ${sharesAmount.toLocaleString()} หุ้น (${(sharesAmount / 100).toLocaleString()} Lots) ด้วยตนเอง`,
      timestamp: Date.now(),
      mode: state.botConfig.mode,
    };

    state.tradeHistory.unshift(trade);
    addServerLog(
      `✋ [MANUAL ORDER] เปิด ${side} ${symbol} @ ฿${currentPrice} | ทุน ฿${actualInvested.toFixed(2)} บาท (${sharesAmount.toLocaleString()} หุ้น / ${(sharesAmount / 100).toLocaleString()} Lots)`
    );
    saveServerState();

    sendTelegramAlert(
      `✋ <b>[CDC Stock Bot] เปิดออเดอร์ด้วยตนเอง (${side})</b>\n\n` +
      `📈 <b>หุ้น:</b> <code>${symbol}</code>\n` +
      `💰 <b>ราคาเข้า:</b> ฿${currentPrice.toFixed(2)}\n` +
      `📊 <b>จำนวน:</b> ${sharesAmount.toLocaleString()} หุ้น (${(sharesAmount / 100).toLocaleString()} Lots)\n` +
      `💵 <b>เงินลงทุน:</b> ฿${actualInvested.toLocaleString('en-US', { minimumFractionDigits: 2 })} THB\n` +
      `💼 <b>โหมด:</b> ${state.botConfig.mode === 'SETTRADE_LIVE' ? '⚡ InnovestX Live' : '🟢 Paper Trading'}\n` +
      `📅 <b>เวลา:</b> ${new Date().toLocaleTimeString('th-TH')}`
    );

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
});

// 5. Manual Close Position
botRouter.post('/close-position', async (req, res) => {
  try {
    const state = getServerState();
    let { symbol, currentPrice, reason = 'Manual Close' } = req.body;
    const idx = state.paperAccount.activePositions.findIndex((p) => p.symbol === symbol);
    if (idx === -1) {
      return res.status(404).json({ error: 'ไม่พบตำแหน่งที่เปิดอยู่' });
    }

    const pos = state.paperAccount.activePositions[idx];

    const priceRatio = currentPrice && pos.entryPrice ? currentPrice / pos.entryPrice : 0;
    if (!currentPrice || currentPrice <= 0 || priceRatio > 50 || priceRatio < 0.02) {
      try {
        const liveKlines = await fetchKlinesDirect(pos.symbol, '1m', 1);
        if (liveKlines.length > 0 && liveKlines[0].close > 0) {
          currentPrice = liveKlines[0].close;
        }
      } catch (err) {
        console.warn(`Failed to verify close price for ${pos.symbol}:`, err);
      }
    }

    const { pnlPercent, pnlThb: pnlUsdt } = calculateSpotPnl(
      pos.side,
      pos.entryPrice,
      currentPrice,
      pos.amount
    );
    const returnUsdt = Math.max(0, pos.usdtInvested + pnlUsdt);

    state.paperAccount.usdtBalance += returnUsdt;
    state.paperAccount.activePositions.splice(idx, 1);
    state.paperAccount.totalTrades += 1;
    if (pnlUsdt > 0) state.paperAccount.winningTrades += 1;
    else state.paperAccount.losingTrades += 1;
    state.paperAccount.totalProfitUsdt += pnlUsdt;

    const trade: ExecutedTrade = {
      id: `trade_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      symbol: pos.symbol,
      timeframe: state.botConfig.timeframe,
      side: pos.side === 'LONG' ? 'CLOSE_LONG' : 'CLOSE_SHORT',
      price: currentPrice,
      amount: pos.amount,
      usdtValue: returnUsdt,
      pnlUsdt: Number(pnlUsdt.toFixed(2)),
      pnlPercent: Number(pnlPercent.toFixed(2)),
      reason: `[Manual Close] ${reason}`,
      timestamp: Date.now(),
      mode: state.botConfig.mode,
    };

    state.tradeHistory.unshift(trade);
    addServerLog(
      `✋ [MANUAL CLOSE] ปิดสถานะ ${pos.symbol} @ ฿${currentPrice} | PnL: ${pnlUsdt >= 0 ? '+' : ''}฿${pnlUsdt.toFixed(2)} (${pnlPercent.toFixed(2)}%)`
    );
    saveServerState();

    const isWin = pnlUsdt >= 0;
    sendTelegramAlert(
      `${isWin ? '🎯' : '🛑'} <b>[CDC Stock Bot] ปิดสถานะด้วยตนเอง (${pos.side})</b>\n\n` +
      `📈 <b>หุ้น:</b> <code>${pos.symbol}</code>\n` +
      `💰 <b>ราคาปิด:</b> ฿${currentPrice.toFixed(2)}\n` +
      `📊 <b>จำนวน:</b> ${pos.amount.toLocaleString()} หุ้น (${(pos.amount / 100).toLocaleString()} Lots)\n` +
      `💵 <b>ผลตอบแทน:</b> ${isWin ? '+' : ''}฿${pnlUsdt.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)\n` +
      `📝 <b>เหตุผล:</b> ${reason}\n` +
      `💼 <b>โหมด:</b> ${state.botConfig.mode === 'SETTRADE_LIVE' ? '⚡ InnovestX Live' : '🟢 Paper Trading'}\n` +
      `📅 <b>เวลา:</b> ${new Date().toLocaleTimeString('th-TH')}`
    );

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
});

// 6. Clear Logs
botRouter.post('/clear-logs', (req, res) => {
  const state = getServerState();
  state.botLogs = [];
  saveServerState();
  return res.json({ success: true });
});

// 7. Reset Paper Account
botRouter.post('/reset-paper', (req, res) => {
  const state = getServerState();
  state.paperAccount = {
    usdtBalance: 100000,
    initialUsdtBalance: 100000,
    activePositions: [],
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalProfitUsdt: 0,
  };
  state.tradeHistory = [];
  addServerLog('🔄 รีเซ็ตพอร์ตจำลอง (Paper Account) เป็น ฿100,000 บาท เรียบร้อยแล้ว');
  saveServerState();
  return res.json({ success: true });
});

// 7.1 Unlock Symbol from Stop Loss Lock
botRouter.post('/unlock-symbol', (req, res) => {
  try {
    const state = getServerState();
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' });
    const cleanSym = String(symbol).toUpperCase().trim();
    if (state.botConfig.stopLossLocks && state.botConfig.stopLossLocks[cleanSym]) {
      delete state.botConfig.stopLossLocks[cleanSym];
      saveServerState();
      addServerLog(`🔓 [MANUAL UNLOCK] ปลดล็อก ${cleanSym} สำเร็จ`);
    }
    return res.json({ success: true, stopLossLocks: state.botConfig.stopLossLocks || {} });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
});

// 8. Telegram Notification Test & Configuration
telegramRouter.post('/test', async (req, res) => {
  try {
    const state = getServerState();
    const { botToken, chatId } = req.body;
    const token = botToken || state.botConfig.telegramConfig?.botToken || process.env.TELEGRAM_BOT_TOKEN;
    const chat = chatId || state.botConfig.telegramConfig?.chatId || process.env.TELEGRAM_CHAT_ID;

    if (!token || !chat) {
      return res.status(400).json({ error: 'กรุณากรอก Telegram Bot Token และ Chat ID ให้ครบถ้วน' });
    }

    const testMsg =
      `🔔 <b>ทดสอบการเชื่อมต่อ Telegram สำเร็จ!</b>\n\n` +
      `🚀 ระบบ <b>CDC Action Zone V3 SET Thai Stock Bot</b> เชื่อมต่อระบบแจ้งเตือนสำเร็จ พร้อมส่งสัญญาณเทรดและสรุปผลกำไร-ขาดทุนให้คุณแบบ Realtime 24/7 ครับ 📈✨`;

    const result = await sendTelegramMessage(token, chat, testMsg);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    addServerLog('🔔 ส่งข้อความทดสอบแจ้งเตือนเข้า Telegram สำเร็จ');
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
});
