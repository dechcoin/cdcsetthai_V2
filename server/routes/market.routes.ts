import express from 'express';
import { POPULAR_STOCKS } from '../../src/lib/stockApi';
import { fetchQuotesCached } from '../services/marketData';
import { orderLimiter } from '../middleware/rateLimiters';
import { addServerLog, getServerState, saveServerState } from '../repositories/stateRepository';
import { sanitizeErrorMessage } from '../utils/validation';
import { hasSecretEncryptionKey } from '../utils/secretVault';

/**
 * Thai stock market-data + broker endpoints.
 * Mounted at `/api/stock`.
 */

export const marketRouter = express.Router();

const handleKlines = async (req: express.Request, res: express.Response) => {
  try {
    const rawSymbol = String(req.query.symbol || 'PTT').trim();
    const isIndex = rawSymbol.startsWith('^');
    const symbolWithoutIndex = isIndex ? rawSymbol.slice(1) : rawSymbol;
    const baseSymbol = symbolWithoutIndex.replace(/\.BK$/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cleanSymbol = isIndex ? `^${baseSymbol}` : (baseSymbol || 'PTT');
    const yahooSymbol = `${cleanSymbol}.BK`;
    let interval = '1d';
    let bucketSeconds = 0;

    if (resolution === '1') interval = '1m';
    else if (resolution === '5') interval = '5m';
    else if (resolution === '15') interval = '15m';
    else if (resolution === '30') interval = '30m';
    else if (resolution === '45') {
      interval = '15m';
      bucketSeconds = 2700; // 45 minutes
    } else if (resolution === '60' || resolution === '1H' || resolution === '1h') {
      interval = '60m';
    } else if (resolution === '240' || resolution === '4H' || resolution === '4h') {
      interval = '60m';
      bucketSeconds = 14400; // 4 hours
    } else if (resolution === '1D' || resolution === 'D' || resolution === '1d') {
      interval = '1d';
    } else if (resolution === '1W' || resolution === 'W' || resolution === '1w') {
      interval = '1wk';
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&period1=${from}&period2=${to}`;
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

    let t: number[] = [];
    let o: number[] = [];
    let h: number[] = [];
    let l: number[] = [];
    let c: number[] = [];
    let v: number[] = [];

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

    if (bucketSeconds > 0 && t.length > 0) {
      const resT: number[] = [];
      const resO: number[] = [];
      const resH: number[] = [];
      const resL: number[] = [];
      const resC: number[] = [];
      const resV: number[] = [];

      let currentBucket = -1;
      let curO = 0;
      let curH = -Infinity;
      let curL = Infinity;
      let curC = 0;
      let curV = 0;

      for (let i = 0; i < t.length; i++) {
        const bucket = Math.floor(t[i] / bucketSeconds) * bucketSeconds;
        if (bucket !== currentBucket) {
          if (currentBucket !== -1) {
            resT.push(currentBucket);
            resO.push(curO);
            resH.push(curH);
            resL.push(curL);
            resC.push(curC);
            resV.push(curV);
          }
          currentBucket = bucket;
          curO = o[i];
          curH = h[i];
          curL = l[i];
          curC = c[i];
          curV = v[i];
        } else {
          curH = Math.max(curH, h[i]);
          curL = Math.min(curL, l[i]);
          curC = c[i];
          curV += v[i];
        }
      }

      if (currentBucket !== -1) {
        resT.push(currentBucket);
        resO.push(curO);
        resH.push(curH);
        resL.push(curL);
        resC.push(curC);
        resV.push(curV);
      }

      t = resT;
      o = resO;
      h = resH;
      l = resL;
      c = resC;
      v = resV;
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
    const quotes = await fetchQuotesCached(POPULAR_STOCKS);

    const tickerResult: Record<string, any> = {};
    for (const symbol of POPULAR_STOCKS) {
      const q = quotes[symbol];
      if (!q || q.last <= 0) continue; // ข้ามหุ้นที่ Yahoo ไม่มีข้อมูล — ไม่เติมราคาปลอม

      // หมายเหตุ: ฝั่งเว็บ map `lowestAsk` → highPrice และ `highestBid` → lowPrice
      // (ชื่อฟิลด์เป็น legacy จากบอทคริปโต) จึงใส่ dayHigh ไว้ที่ lowestAsk ตามนั้น
      tickerResult[`THB_${symbol}`] = {
        last: q.last,
        percentChange: q.changePercent,
        lowestAsk: q.dayHigh,
        highestBid: q.dayLow,
        baseVolume: q.volume,
        quoteVolume: q.volume * q.last,
      };
    }

    if (Object.keys(tickerResult).length === 0) {
      console.warn('[ticker] Yahoo quotes returned empty');
      return res.status(502).json({ error: 'ไม่สามารถดึงราคาหุ้นจากแหล่งข้อมูลได้ (Yahoo)' });
    }

    return res.json(tickerResult);
  } catch (error: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
};

marketRouter.get('/ticker', handleTicker);

const handleDepth = async (req: express.Request, res: express.Response) => {
  return res.status(501).json({
    code: 'ORDER_BOOK_UNAVAILABLE',
    error: 'แหล่งข้อมูลหุ้นที่เชื่อมต่ออยู่ไม่มีข้อมูล Bid/Ask Depth จึงยังไม่สามารถแสดง Order Book จริงได้',
  });
};

marketRouter.get('/depth', handleDepth);

const handleBalances = async (req: express.Request, res: express.Response) => {
  return res.status(501).json({
    code: 'BROKER_ADAPTER_UNAVAILABLE',
    error: 'ยังไม่มีการเชื่อมต่อ Settrade/InnovestX Open API จริง จึงตรวจสอบยอดเงินไม่ได้',
  });
};

marketRouter.post('/balances', handleBalances);

const handleOrder = async (req: express.Request, res: express.Response) => {
  return res.status(501).json({
    code: 'BROKER_ADAPTER_UNAVAILABLE',
    error: 'ปฏิเสธคำสั่ง: ระบบยังไม่มี broker adapter และไม่ได้ส่งคำสั่งซื้อขายจริง',
  });
};

marketRouter.post('/order', orderLimiter, handleOrder);

const handleKeys = (req: express.Request, res: express.Response) => {
  try {
    const state = getServerState();
    const { apiKey, apiSecret, appCode, brokerId, accountNo, pin } = req.body;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'กรุณากรอก App Key และ App Secret ให้ครบถ้วน' });
    }
    if (!hasSecretEncryptionKey()) {
      return res.status(503).json({
        error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้ง LIVE_KEYS_ENCRYPTION_KEY อย่างน้อย 32 ตัวอักษร จึงไม่รับบันทึกข้อมูลลับ',
      });
    }
    const previousKeys = state.liveApiKeys;
    state.liveApiKeys = {
      apiKey,
      apiSecret,
      appCode,
      brokerId: brokerId || '023',
      accountNo,
      pin,
      isTestnet: brokerId === 'SANDBOX',
    };
    if (!saveServerState()) {
      state.liveApiKeys = previousKeys;
      return res.status(503).json({ error: 'ไม่สามารถเข้ารหัสหรือบันทึกข้อมูล API Key ได้' });
    }
    addServerLog('🔑 บันทึกข้อมูลเชื่อมต่อโบรกเกอร์ที่เข้ารหัสบนเซิร์ฟเวอร์เรียบร้อย');
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
};

marketRouter.post('/keys', handleKeys);
