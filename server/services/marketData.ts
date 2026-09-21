import type { KlineData } from '../../src/types';

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
  if (interval !== '1d' && interval !== '1w') return candles;
  if (candles.length < 2) return candles;

  const last = candles[candles.length - 1];
  const now = getBangkokParts(new Date());
  const lastParts = getBangkokParts(new Date(last.time));

  if (interval === '1w') {
    return getBangkokWeekKey(now) === getBangkokWeekKey(lastParts) ? candles.slice(0, -1) : candles;
  }
  return now.dateKey === lastParts.dateKey ? candles.slice(0, -1) : candles;
}


// ==================== YAHOO FINANCE CLIENT ====================

// แคชข้อมูลแท่งเทียน + backoff เพื่อไม่ให้ Yahoo Finance จำกัดอัตรา/แบน IP
const klineCache = new Map<string, { data: KlineData[]; ts: number }>();
const KLINE_CACHE_TTL_MS: Record<string, number> = {
  '1m': 15000,
  '5m': 30000,
  '15m': 60000,
  '1h': 120000,
  '4h': 300000,
  '1d': 300000,
  '1w': 600000,
};
let yahooBackoffUntil = 0;

function klineCacheTTL(interval: string): number {
  return KLINE_CACHE_TTL_MS[interval] || 300000;
}

/** Fetches candles straight from Yahoo Finance (no cache) and applies backoff on failure. */
export async function fetchKlinesDirect(symbol: string, interval: string, limit = 300): Promise<KlineData[]> {
  try {
    if (Date.now() < yahooBackoffUntil) return [];
    let cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'PTT';
    const yahooSymbol = cleanSymbol.endsWith('.BK') ? cleanSymbol : `${cleanSymbol}.BK`;

    let yahooInterval = '1d';
    let step = 86400;
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
      case '1h':
        yahooInterval = '60m';
        step = 3600;
        break;
      case '4h':
        yahooInterval = '60m';
        step = 14400;
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
    const from = to - limit * step;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${yahooInterval}&period1=${from}&period2=${to}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) {
      yahooBackoffUntil = Date.now() + (res.status === 429 ? 60000 : 15000);
      return [];
    }
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result || !result.timestamp) return [];

    const quote = result.indicators?.quote?.[0];
    if (!quote) return [];

    const klines: KlineData[] = [];
    for (let i = 0; i < result.timestamp.length; i++) {
      const t = result.timestamp[i];
      const o = quote.open?.[i];
      const h = quote.high?.[i];
      const l = quote.low?.[i];
      const c = quote.close?.[i];
      const v = quote.volume?.[i] || 0;

      if (o == null || h == null || l == null || c == null) continue;

      klines.push({
        time: t,
        open: Number(o),
        high: Number(h),
        low: Number(l),
        close: Number(c),
        volume: Number(v),
      });
    }
    return klines;
  } catch (err) {
    yahooBackoffUntil = Date.now() + 15000;
    return [];
  }
}

/** Timeframe-aware cached read used by the 24/7 trading engine. */
export async function fetchKlinesCached(symbol: string, interval: string, limit = 300): Promise<KlineData[]> {
  const key = `${symbol.toUpperCase()}|${interval}`;
  const cached = klineCache.get(key);
  if (cached && Date.now() - cached.ts < klineCacheTTL(interval)) return cached.data;
  const data = await fetchKlinesDirect(symbol, interval, limit);
  if (data.length > 0) klineCache.set(key, { data, ts: Date.now() });
  return data;
}
