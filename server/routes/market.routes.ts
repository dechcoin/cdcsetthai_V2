import express from 'express';
import { POPULAR_STOCKS } from '../../src/lib/stockApi';
import { orderLimiter } from '../middleware/rateLimiters';
import { addServerLog, getServerState, saveServerState } from '../repositories/stateRepository';
import { sanitizeErrorMessage } from '../utils/validation';

/**
 * Thai stock market-data + broker endpoints.
 * Mounted at `/api/stock`.
 */

export const marketRouter = express.Router();

const handleKlines = async (req: express.Request, res: express.Response) => {
  try {
    let symbol = (req.query.symbol as string) || 'PTT';
    symbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'PTT';
    const resolution = String(req.query.resolution || '1D');
    const from = parseInt(String(req.query.from || '0'), 10);
    const to = parseInt(String(req.query.to || '0'), 10);

    const yahooSymbol = symbol.endsWith('.BK') ? symbol : `${symbol}.BK`;
    let interval = '1d';
    if (resolution === '1') interval = '1m';
    else if (resolution === '5') interval = '5m';
    else if (resolution === '15') interval = '15m';
    else if (resolution === '60') interval = '60m';
    else if (resolution === '240') interval = '60m';
    else if (resolution === '1D' || resolution === 'D') interval = '1d';
    else if (resolution === '1W' || resolution === 'W') interval = '1wk';

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${interval}&period1=${from}&period2=${to}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ s: 'error', error: 'Stock API request failed' });
    }

    const data = await response.json();
    const result = data.chart?.result?.[0];
    if (!result || !result.timestamp) {
      return res.json({ s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] });
    }

    const timestamps = result.timestamp;
    const quote = result.indicators?.quote?.[0];
    if (!quote) {
      return res.json({ s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] });
    }

    const t: number[] = [];
    const o: number[] = [];
    const h: number[] = [];
    const l: number[] = [];
    const c: number[] = [];
    const v: number[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      if (
        quote.open?.[i] == null ||
        quote.high?.[i] == null ||
        quote.low?.[i] == null ||
        quote.close?.[i] == null
      ) {
        continue;
      }
      t.push(timestamps[i]);
      o.push(Number(quote.open[i]));
      h.push(Number(quote.high[i]));
      l.push(Number(quote.low[i]));
      c.push(Number(quote.close[i]));
      v.push(Number(quote.volume?.[i] || 0));
    }

    return res.json({
      s: 'ok',
      t,
      o,
      h,
      l,
      c,
      v,
    });
  } catch (error: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
};

marketRouter.get('/klines', handleKlines);

const handleTicker = async (req: express.Request, res: express.Response) => {
  try {
    const popularStocks = POPULAR_STOCKS;
    const symbolsQuery = popularStocks.map((s) => `${s}.BK`).join(',');
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbolsQuery}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const tickerResult: Record<string, any> = {};

    if (response.ok) {
      const data = await response.json();
      const quotes = data.quoteResponse?.result || [];
      quotes.forEach((q: any) => {
        const rawSym = q.symbol.replace('.BK', '');
        const formatKey = `THB_${rawSym}`;
        const last = q.regularMarketPrice || 0;
        const changePercent = q.regularMarketChangePercent || 0;
        const volume = q.regularMarketVolume || 0;

        tickerResult[formatKey] = {
          last: last,
          percentChange: changePercent,
          lowestAsk: last,
          highestBid: last,
          baseVolume: volume,
          quoteVolume: volume * last,
        };
      });
    }

    // ไม่เติมราคาปลอม (40.0) ให้หุ้นที่ Yahoo ไม่มีข้อมูล — หุ้นที่หายไปจะถูกข้าม
    // เพื่อป้องกันไม่ให้บอทเทรดบนราคาที่ไม่ใช่ราคาจริงของตลาด

    return res.json(tickerResult);
  } catch (error: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
};

marketRouter.get('/ticker', handleTicker);

const handleDepth = async (req: express.Request, res: express.Response) => {
  try {
    const rawSymbol = (req.query.symbol as string) || 'PTT';
    let symbol = rawSymbol;
    if (symbol.includes('_')) {
      const parts = symbol.split('_');
      symbol = parts[1] === 'THB' ? parts[0] : parts[1];
    }

    const clean = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'PTT';
    const yahooSymbol = clean.endsWith('.BK') ? clean : `${clean}.BK`;
    let lastPrice = 35.0;
    try {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yahooSymbol}`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        }
      );
      if (response.ok) {
        const data = await response.json();
        lastPrice = data.quoteResponse?.result?.[0]?.regularMarketPrice || 35.0;
      }
    } catch (e) {
      console.warn('Depth price fetch fallback');
    }

    const bids: [string, string][] = [];
    const asks: [string, string][] = [];
    const limit = Math.min(Math.max(1, parseInt(String(req.query.limit || '15'), 10) || 15), 50);

    let tickSize = 0.25;
    if (lastPrice < 2) tickSize = 0.01;
    else if (lastPrice < 5) tickSize = 0.02;
    else if (lastPrice < 10) tickSize = 0.05;
    else if (lastPrice < 25) tickSize = 0.1;
    else if (lastPrice < 100) tickSize = 0.25;
    else if (lastPrice < 200) tickSize = 0.5;
    else if (lastPrice < 400) tickSize = 1.0;
    else tickSize = 2.0;

    for (let i = 1; i <= limit; i++) {
      const bidPrice = (lastPrice - i * tickSize).toFixed(2);
      const askPrice = (lastPrice + i * tickSize).toFixed(2);
      const bidQty = (Math.floor(Math.random() * 500) * 100 + 100).toString();
      const askQty = (Math.floor(Math.random() * 500) * 100 + 100).toString();
      bids.push([bidPrice, bidQty]);
      asks.push([askPrice, askQty]);
    }

    return res.json({ bids, asks });
  } catch (error: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
};

marketRouter.get('/depth', handleDepth);

const handleBalances = async (req: express.Request, res: express.Response) => {
  try {
    // NOTE: stub — ยังไม่เชื่อมต่อ broker Open API จริง (P1)
    const { apiKey, apiSecret, brokerId, accountNo } = req.body || {};
    return res.json({
      success: true,
      canTrade: true,
      simulated: true,
      accountType: brokerId === '023' ? 'INNOVESTX_OPEN_API' : 'SETTRADE_OPEN_API',
      accountNo: accountNo || 'INVX-MAIN',
      balances: [{ asset: 'THB', free: '1000000.00', locked: '0.00' }],
    });
  } catch (error: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
};

marketRouter.post('/balances', handleBalances);

const handleOrder = async (req: express.Request, res: express.Response) => {
  try {
    // NOTE: stub — ยังไม่ส่งคำสั่งไปยัง broker จริง (P1) คืน simulated success เท่านั้น
    const { apiKey, symbol, side, quantity, price, orderType = 'MARKET', pin } = req.body;
    return res.json({
      success: true,
      simulated: true,
      order: {
        orderId: `invx_${Date.now()}`,
        symbol: symbol,
        side: side,
        quantity: quantity,
        price: price || 'MARKET',
        status: 'SUCCESS',
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
};

marketRouter.post('/order', orderLimiter, handleOrder);

const handleKeys = (req: express.Request, res: express.Response) => {
  try {
    const state = getServerState();
    const { apiKey, apiSecret, appCode, brokerId, accountNo, pin } = req.body;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'กรุณากรอก App Key และ App Secret ให้ครบถ้วน' });
    }
    state.liveApiKeys = {
      apiKey,
      apiSecret,
      appCode,
      brokerId: brokerId || '023',
      accountNo,
      pin,
      isTestnet: brokerId === 'SANDBOX',
    };
    saveServerState();
    addServerLog(`🔑 ซิงก์ InnovestX / Settrade Open API Key (พอร์ต: ${accountNo || 'Default'}) ขึ้นเซิร์ฟเวอร์เรียบร้อย`);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
};

marketRouter.post('/keys', handleKeys);