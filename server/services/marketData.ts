import type { KlineData } from '../../src/types';
import { stripFormingCandle as stripClosedCandles } from '../../src/lib/marketTime';

/**
 * Market data service: SET trading-hours logic plus a Yahoo Finance client with
 * an in-memory cache and rate-limit backoff.
 *
 * The cache/backoff state is intentionally module-private (module singleton) so
 * every caller — the trading engine, the chart API and the manual-close price
 * validator — shares the same protection against getting the IP banned.
 */

// ==================== SET MARKET HOURS ====================

const ICT_OFFSET_MS = 7 * 60 * 60 * 1000; // Bangkok (UTC+7)

// วันหยุดทำการของตลาดหลักทรัพย์แห่งประเทศไทย (รูปแบบ YYYY-MM-DD)
// อ้างอิงวันหยุดราชการ/วันหยุดธนาคารที่ ตลท. ประกาศปิดทำการ (เฉพาะวันจันทร์–ศุกร์,
// วันเสาร์–อาทิตย์ถูกกรองแยกไว้แล้วใน isThaiMarketOpen)
// หมายเหตุ:
//  - วันหยุดชดเชย (in-lieu Monday) รวมไว้แล้ว
//  - "วันพืชมงคล" (Royal Ploughing Ceremony) เป็นวันหยุดเฉพาะภาครัฐ ธนาคาร/ตลท. เปิดทำการ → ไม่รวม
//  - วันตรุษจีนเป็นวันหยุดเฉพาะจังหวัดชายแดนใต้ → ไม่รวม
//  - ควรอัปเดตทุกปีตามประกาศทางการของ ตลท.
const MARKET_HOLIDAYS: string[] = [
  // === 2025 ===
  '2025-01-01', // วันขึ้นปีใหม่
  '2025-02-12', // วันมาฆบูชา
  '2025-04-07', // วันจักรี (ชดเชย 6 เม.ย.)
  '2025-04-14', // สงกรานต์
  '2025-04-15', // สงกรานต์
  '2025-04-16', // สงกรานต์ (วันเพิ่ม)
  '2025-05-01', // วันแรงงานแห่งชาติ
  '2025-05-05', // วันฉัตรมงคล (ชดเชย 4 พ.ค.)
  '2025-05-12', // วันวิสาขบูชา (ชดเชย 11 พ.ค.)
  '2025-06-03', // วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี
  '2025-07-10', // วันอาสาฬหบูชา
  '2025-07-11', // วันเข้าพรรษา
  '2025-07-28', // วันเฉลิมพระชนมพรรษา ร.10
  '2025-08-12', // วันแม่แห่งชาติ / วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนีพันปีหลวง
  '2025-10-13', // วันคล้ายวันสวรรคต ร.9
  '2025-10-23', // วันปิยมหาราช
  '2025-12-05', // วันพ่อแห่งชาติ / วันชาติ / วันคล้ายวันพระบรมราชสมภพ ร.9
  '2025-12-10', // วันรัฐธรรมนูญ
  '2025-12-31', // วันสิ้นปี
  // === 2026 ===
  '2026-01-01', // วันขึ้นปีใหม่
  '2026-01-02', // วันหยุดชดเชยปีใหม่ (เพิ่ม)
  '2026-03-03', // วันมาฆบูชา
  '2026-04-06', // วันจักรี
  '2026-04-13', // สงกรานต์
  '2026-04-14', // สงกรานต์
  '2026-04-15', // สงกรานต์
  '2026-05-01', // วันแรงงานแห่งชาติ
  '2026-05-04', // วันฉัตรมงคล
  '2026-06-01', // วันวิสาขบูชา (ชดเชย 31 พ.ค.)
  '2026-06-03', // วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี
  '2026-07-28', // วันเฉลิมพระชนมพรรษา ร.10
  '2026-07-29', // วันอาสาฬหบูชา
  '2026-07-30', // วันเข้าพรรษา
  '2026-08-12', // วันแม่แห่งชาติ / วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนีพันปีหลวง
  '2026-10-13', // วันคล้ายวันสวรรคต ร.9
  '2026-10-23', // วันปิยมหาราช
  '2026-12-07', // วันพ่อแห่งชาติ / วันชาติ (ชดเชย 5 ธ.ค.)
  '2026-12-10', // วันรัฐธรรมนูญ
  '2026-12-31', // วันสิ้นปี
  // === 2027 ===
  '2027-01-01', // วันขึ้นปีใหม่
  '2027-02-22', // วันมาฆบูชา (ชดเชย 21 ก.พ.)
  '2027-04-06', // วันจักรี
  '2027-04-13', // สงกรานต์
  '2027-04-14', // สงกรานต์
  '2027-04-15', // สงกรานต์
  '2027-05-03', // วันแรงงานแห่งชาติ (ชดเชย 1 พ.ค.)
  '2027-05-04', // วันฉัตรมงคล
  '2027-05-20', // วันวิสาขบูชา
  '2027-06-03', // วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี
  '2027-07-19', // วันอาสาฬหบูชา
  '2027-07-20', // วันเข้าพรรษา
  '2027-07-28', // วันเฉลิมพระชนมพรรษา ร.10
  '2027-08-12', // วันแม่แห่งชาติ / วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนีพันปีหลวง
  '2027-10-13', // วันคล้ายวันสวรรคต ร.9
  '2027-10-25', // วันปิยมหาราช (ชดเชย 23 ต.ค.)
  '2027-12-06', // วันพ่อแห่งชาติ / วันชาติ (ชดเชย 5 ธ.ค.)
  '2027-12-10', // วันรัฐธรรมนูญ
  '2027-12-31', // วันสิ้นปี
];

function getBangkokParts(now: Date): { day: number; hour: number; minute: number; dateKey: string } {
  const t = new Date(now.getTime() + ICT_OFFSET_MS);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return { day: t.getUTCDay(), hour: t.getUTCHours(), minute: t.getUTCMinutes(), dateKey: `${y}-${m}-${d}` };
}

/** True while the SET is in a continuous trading session (Bangkok time). */
export function isThaiMarketOpen(now: Date = new Date()): boolean {
  const { day, hour, minute, dateKey } = getBangkokParts(now);
  if (day === 0 || day === 6) return false; // เสาร์-อาทิตย์
  if (MARKET_HOLIDAYS.includes(dateKey)) return false;
  const mins = hour * 60 + minute;
  const morning = mins >= 10 * 60 && mins < 12 * 60 + 30; // 10:00–12:30
  const afternoon = mins >= 14 * 60 + 30 && mins < 16 * 60 + 35; // 14:30–16:30 (+buffer รับราคาปิด)
  return morning || afternoon;
}

/** Returns a Monday-based week key (YYYY-MM-DD) for a Bangkok date. */
function getBangkokWeekKey(parts: { dateKey: string }): string {
  const d = new Date(`${parts.dateKey}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday
  const sinceMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d.toISOString().slice(0, 10);
}

/**
 * Drops the still-forming latest candle for daily/weekly timeframes.
 *
 * Yahoo Finance returns the current (incomplete) 1d/1w candle while the market
 * is open. Acting on it makes "เขียว/แดง" signals flip intraday and reverse by
 * the close. The CDC daily strategy must therefore decide on COMPLETED candles
 * only — the caller still uses the raw latest candle for the live execution
 * price.
 */
export function stripFormingCandle(candles: KlineData[], interval: string): KlineData[] {
  return stripClosedCandles(candles, interval);
}


// ==================== YAHOO FINANCE CLIENT (resilient + crumb-aware) ====================

export const YAHOO_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9,th;q=0.8',
  'Origin': 'https://finance.yahoo.com',
  'Referer': 'https://finance.yahoo.com/',
  'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
};

export function getYahooBaseHosts(): string[] {
  const customProxy = process.env.YAHOO_PROXY_URL?.trim();
  if (customProxy) {
    const clean = customProxy.replace(/\/+$/, '');
    return [clean, 'https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
  }
  return [
    'https://query1.finance.yahoo.com',
    'https://query2.finance.yahoo.com',
  ];
}

// แคชข้อมูลแท่งเทียน + backoff เพื่อไม่ให้ Yahoo Finance จำกัดอัตรา/แบน IP
const klineCache = new Map<string, { data: KlineData[]; ts: number }>();
const KLINE_CACHE_TTL_MS: Record<string, number> = {
  '1m': 15000,
  '5m': 30000,
  '15m': 60000,
  '30m': 120000,
  '45m': 120000,
  '1h': 120000,
  '4h': 300000,
  '1d': 300000,
  '1w': 600000,
};
let yahooBackoffUntil = 0;

function klineCacheTTL(interval: string): number {
  return KLINE_CACHE_TTL_MS[interval] || 300000;
}

export interface YahooQuote {
  symbol: string; // e.g. 'PTT' (no .BK suffix)
  last: number;
  changePercent: number;
  volume: number;
  dayHigh: number;
  dayLow: number;
}

const QUOTE_CACHE_TTL_MS = 60_000; // 60s — tape polls every ~20s; the cache absorbs the rest
const quoteCache = new Map<string, { data: Record<string, YahooQuote>; ts: number }>();
const quoteInFlight = new Map<string, Promise<Record<string, YahooQuote>>>();

interface YahooSession {
  cookie: string;
  crumb: string;
  fetchedAt: number;
}

let yahooSession: YahooSession | null = null;
const SESSION_TTL_MS = 30 * 60 * 1000;

function extractCookies(res: Response): string {
  try {
    const setCookies = res.headers.getSetCookie?.() ?? [];
    const single = res.headers.get('set-cookie');
    const all = setCookies.length > 0 ? setCookies : single ? [single] : [];
    return all
      .map((c) => c.split(';')[0])
      .filter(Boolean)
      .join('; ');
  } catch {
    return '';
  }
}

async function fetchYahooCrumb(): Promise<YahooSession | null> {
  const hosts = getYahooBaseHosts();
  let cookie = '';
  try {
    // 404 is expected here — the request is only used to collect Yahoo's `A3` cookie.
    const fcRes = await fetch('https://fc.yahoo.com', {
      headers: {
        'User-Agent': YAHOO_HEADERS['User-Agent'],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    cookie = extractCookies(fcRes);
  } catch {
    /* fallback to main site */
  }

  if (!cookie) {
    try {
      const mainRes = await fetch('https://finance.yahoo.com/quote/PTT.BK', {
        headers: {
          'User-Agent': YAHOO_HEADERS['User-Agent'],
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      cookie = extractCookies(mainRes);
    } catch {
      /* ignore */
    }
  }

  if (!cookie) return null;

  for (const host of hosts) {
    try {
      const crumbRes = await fetch(`${host}/v1/test/getcrumb`, {
        headers: { ...YAHOO_HEADERS, Cookie: cookie },
      });
      if (crumbRes.ok) {
        const crumb = (await crumbRes.text()).trim();
        if (crumb && !crumb.includes('<html') && crumb.length < 50) {
          return { cookie, crumb, fetchedAt: Date.now() };
        }
      }
    } catch {
      // try next host
    }
  }
  return null;
}

export async function getYahooSession(force = false): Promise<YahooSession | null> {
  if (!force && yahooSession && Date.now() - yahooSession.fetchedAt < SESSION_TTL_MS) {
    return yahooSession;
  }
  const session = await fetchYahooCrumb();
  if (session) yahooSession = session;
  return session;
}

export interface RawChartResult {
  timestamps: number[];
  opens: (number | null)[];
  highs: (number | null)[];
  lows: (number | null)[];
  closes: (number | null)[];
  volumes: (number | null)[];
}

/**
 * Shared, resilient raw chart fetcher trying hosts (query1, query2, or custom proxy),
 * browser headers, and session crumb/cookie with automatic fallback.
 */
export async function fetchYahooChartRaw(
  yahooSymbol: string,
  interval: string,
  from: number,
  to: number
): Promise<RawChartResult | null> {
  const hosts = getYahooBaseHosts();
  const session = await getYahooSession();
  const crumbQuery = session?.crumb ? `&crumb=${encodeURIComponent(session.crumb)}` : '';
  const headers: Record<string, string> = { ...YAHOO_HEADERS };
  if (session?.cookie) {
    headers['Cookie'] = session.cookie;
  }

  for (const host of hosts) {
    const url = `${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&period1=${from}&period2=${to}${crumbQuery}`;
    try {
      const res = await fetch(url, { headers });
      if (res.status === 401 || res.status === 403) {
        yahooSession = null; // Session expired or rejected, invalidate
      }
      if (!res.ok) {
        continue; // try next host
      }

      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result || !Array.isArray(result.timestamp) || result.timestamp.length === 0) {
        continue;
      }

      const quote = result.indicators?.quote?.[0];
      if (!quote) continue;

      return {
        timestamps: result.timestamp,
        opens: quote.open || [],
        highs: quote.high || [],
        lows: quote.low || [],
        closes: quote.close || [],
        volumes: quote.volume || [],
      };
    } catch {
      // network/fetch error, try next host
    }
  }

  return null;
}

/** Fetches candles straight from Yahoo Finance (no cache) and applies backoff on failure. */
export async function fetchKlinesDirect(symbol: string, interval: string, limit = 750): Promise<KlineData[]> {
  try {
    if (Date.now() < yahooBackoffUntil) return [];
    const isIndex = symbol.startsWith('^');
    const symbolWithoutIndex = isIndex ? symbol.slice(1) : symbol;
    const baseSymbol = symbolWithoutIndex.replace(/\.BK$/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cleanSymbol = isIndex ? `^${baseSymbol}` : (baseSymbol || 'PTT');
    const yahooSymbol = `${cleanSymbol}.BK`;

    let yahooInterval = '1d';
    let step = 86400;
    let bucketSeconds = 0;

    switch (interval) {
      case '1m':
        yahooInterval = '1m';
        step = 60;
        break;
      case '5m':
        yahooInterval = '5m';
        step = 300;
        break;
      case '15m':
        yahooInterval = '15m';
        step = 900;
        break;
      case '30m':
        yahooInterval = '30m';
        step = 1800;
        break;
      case '45m':
        yahooInterval = '15m';
        step = 2700;
        bucketSeconds = 2700;
        break;
      case '1h':
      case '60m':
        yahooInterval = '60m';
        step = 3600;
        break;
      case '4h':
      case '240m':
        yahooInterval = '60m';
        step = 14400;
        bucketSeconds = 14400;
        break;
      case '1d':
        yahooInterval = '1d';
        step = 86400;
        break;
      case '1w':
        yahooInterval = '1wk';
        step = 604800;
        break;
    }
    const to = Math.floor(Date.now() / 1000);
    const calendarFactor = (interval === '1d' || interval === '1w') ? 1.5 : 1;
    const from = to - Math.floor(limit * step * calendarFactor);

    const chart = await fetchYahooChartRaw(yahooSymbol, yahooInterval, from, to);
    if (!chart) {
      yahooBackoffUntil = Date.now() + 15000;
      return [];
    }

    const rawKlines: KlineData[] = [];
    for (let i = 0; i < chart.timestamps.length; i++) {
      const t = chart.timestamps[i];
      const o = chart.opens[i];
      const h = chart.highs[i];
      const l = chart.lows[i];
      const c = chart.closes[i];
      const v = chart.volumes[i] || 0;

      if (o == null || h == null || l == null || c == null) continue;

      rawKlines.push({
        time: t,
        open: Number(o),
        high: Number(h),
        low: Number(l),
        close: Number(c),
        volume: Number(v),
      });
    }

    if (bucketSeconds > 0 && rawKlines.length > 0) {
      const aggregated: KlineData[] = [];
      let currentBucket = -1;
      let curOpen = 0;
      let curHigh = -Infinity;
      let curLow = Infinity;
      let curClose = 0;
      let curVolume = 0;

      for (const k of rawKlines) {
        const bucket = Math.floor(k.time / bucketSeconds) * bucketSeconds;
        if (bucket !== currentBucket) {
          if (currentBucket !== -1) {
            aggregated.push({
              time: currentBucket,
              open: curOpen,
              high: curHigh,
              low: curLow,
              close: curClose,
              volume: curVolume,
            });
          }
          currentBucket = bucket;
          curOpen = k.open;
          curHigh = k.high;
          curLow = k.low;
          curClose = k.close;
          curVolume = k.volume;
        } else {
          curHigh = Math.max(curHigh, k.high);
          curLow = Math.min(curLow, k.low);
          curClose = k.close;
          curVolume += k.volume;
        }
      }

      if (currentBucket !== -1) {
        aggregated.push({
          time: currentBucket,
          open: curOpen,
          high: curHigh,
          low: curLow,
          close: curClose,
          volume: curVolume,
        });
      }

      return aggregated;
    }

    return rawKlines;
  } catch (err) {
    yahooBackoffUntil = Date.now() + 15000;
    return [];
  }
}

/** Timeframe-aware cached read used by the 24/7 trading engine. */
export async function fetchKlinesCached(symbol: string, interval: string, limit = 750): Promise<KlineData[]> {
  const key = `${symbol.toUpperCase()}|${interval}`;
  const cached = klineCache.get(key);
  if (cached && Date.now() - cached.ts < klineCacheTTL(interval)) return cached.data;
  const data = await fetchKlinesDirect(symbol, interval, limit);
  if (data.length > 0) klineCache.set(key, { data, ts: Date.now() });
  return data;
}

async function fetchQuotesV7(symbols: string[]): Promise<Record<string, YahooQuote>> {
  const result: Record<string, YahooQuote> = {};
  let session = await getYahooSession();
  if (!session) return result;

  const hosts = getYahooBaseHosts();
  const yahooSymbols = symbols.map((x) => `${x}.BK`).join(',');

  const doFetch = async (s: YahooSession) => {
    for (const host of hosts) {
      const url = `${host}/v7/finance/quote?symbols=${yahooSymbols}&crumb=${encodeURIComponent(s.crumb)}`;
      try {
        const res = await fetch(url, { headers: { ...YAHOO_HEADERS, Cookie: s.cookie } });
        if (res.ok) return res;
        if (res.status === 401 || res.status === 403) return res;
      } catch {
        // try next host
      }
    }
    return null;
  };

  let res = await doFetch(session);
  if (res && (res.status === 401 || res.status === 403)) {
    // crumb expired — refresh once and retry
    const fresh = await getYahooSession(true);
    if (fresh) {
      session = fresh;
      res = await doFetch(session);
    }
  }
  if (!res || !res.ok) return result;

  const data = await res.json();
  const quotes = data?.quoteResponse?.result || [];
  for (const q of quotes) {
    const rawSym = String(q.symbol || '').replace('.BK', '').toUpperCase();
    if (!rawSym) continue;
    const last = Number(q.regularMarketPrice) || 0;
    if (last <= 0) continue;
    result[rawSym] = {
      symbol: rawSym,
      last,
      changePercent: Number(q.regularMarketChangePercent) || 0,
      volume: Number(q.regularMarketVolume) || 0,
      dayHigh: Number(q.regularMarketDayHigh) || last,
      dayLow: Number(q.regularMarketDayLow) || last,
    };
  }
  return result;
}

async function fetchQuotesSpark(symbols: string[]): Promise<Record<string, YahooQuote>> {
  const result: Record<string, YahooQuote> = {};
  const batchSize = 20; // spark rejects >~20 symbols per request
  const hosts = getYahooBaseHosts();

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const yahooSymbols = batch.map((x) => `${x}.BK`).join(',');

    for (const host of hosts) {
      const url = `${host}/v8/finance/spark?symbols=${yahooSymbols}&range=5d&interval=1d`;
      try {
        const res = await fetch(url, { headers: YAHOO_HEADERS });
        if (!res.ok) continue;
        const data = await res.json();
        for (const [key, spark] of Object.entries(data)) {
          const rawSym = key.replace('.BK', '').toUpperCase();
          const s = spark as any;
          const closes: number[] = Array.isArray(s?.close) ? s.close.map(Number) : [];
          const last = Number(s?.fulldayPrice) || (closes.length > 0 ? closes[closes.length - 1] : 0);
          if (last <= 0) continue;
          let changePercent = Number(s?.fulldayChangePercent) || 0;
          if (!changePercent && closes.length >= 2 && closes[closes.length - 2] > 0) {
            changePercent = ((last - closes[closes.length - 2]) / closes[closes.length - 2]) * 100;
          }
          result[rawSym] = { symbol: rawSym, last, changePercent, volume: 0, dayHigh: last, dayLow: last };
        }
        break; // Batch succeeded, don't need next host
      } catch {
        // try next host
      }
    }
  }
  return result;
}

/**
 * Cached, rate-limited quote lookup for the SET ticker tape / order-book anchor.
 * Tries the crumb-authenticated v7 endpoint first, then falls back to the
 * crumb-free spark endpoint. Reuses the shared `yahooBackoffUntil` gate.
 */
export async function fetchQuotesCached(symbols: string[]): Promise<Record<string, YahooQuote>> {
  const clean = symbols.map((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean);
  if (clean.length === 0) return {};

  const cacheKey = clean.slice().sort().join(',');
  const cached = quoteCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < QUOTE_CACHE_TTL_MS) return cached.data;

  const existing = quoteInFlight.get(cacheKey);
  if (existing) return existing;

  const p = (async () => {
    if (Date.now() < yahooBackoffUntil) return {};
    let quotes = await fetchQuotesV7(clean);
    if (Object.keys(quotes).length === 0) {
      quotes = await fetchQuotesSpark(clean);
    }
    if (Object.keys(quotes).length === 0) {
      yahooBackoffUntil = Date.now() + 15000;
      return {};
    }
    quoteCache.set(cacheKey, { data: quotes, ts: Date.now() });
    return quotes;
  })();

  quoteInFlight.set(cacheKey, p);
  try {
    return await p;
  } finally {
    quoteInFlight.delete(cacheKey);
  }
}
