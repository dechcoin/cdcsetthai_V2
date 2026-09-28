import type { KlineData } from '../types';

/**
 * SET market-time helpers shared by the trading engine (server) and the chart
 * (client). Kept here so both sides use the exact same "still-forming candle"
 * detection and can never drift apart.
 */

const ICT_OFFSET_MS = 7 * 60 * 60 * 1000; // Bangkok (UTC+7)

export interface BangkokParts {
  day: number;
  hour: number;
  minute: number;
  dateKey: string;
}

export function getBangkokParts(now: Date): BangkokParts {
  const t = new Date(now.getTime() + ICT_OFFSET_MS);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return { day: t.getUTCDay(), hour: t.getUTCHours(), minute: t.getUTCMinutes(), dateKey: `${y}-${m}-${d}` };
}

/** Returns a Monday-based week key (YYYY-MM-DD) for a Bangkok date. */
export function getBangkokWeekKey(parts: { dateKey: string }): string {
  const d = new Date(`${parts.dateKey}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday
  const sinceMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d.toISOString().slice(0, 10);
}

const INTRADAY_STEP_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '45m': 2_700_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
};

function isThaiTradingDayCandleStillForming(now: Date): boolean {
  const { day, hour, minute } = getBangkokParts(now);
  if (day === 0 || day === 6) return false;
  const minuteOfDay = hour * 60 + minute;
  // The daily candle remains incomplete through the lunch break as well.
  return minuteOfDay >= 10 * 60 && minuteOfDay < 16 * 60 + 35;
}

function isThaiTradingWeekIncomplete(now: Date): boolean {
  const { day, hour, minute } = getBangkokParts(now);
  if (day === 0 || day === 6) return false;
  if (day < 5) return true;
  return hour * 60 + minute < 16 * 60 + 35;
}

/**
 * Drops the still-forming latest candle for every timeframe.
 *
 * Yahoo Finance returns the current (incomplete) candle while the market is
 * open — not just for 1d/1w but also for intraday bars. Acting on it makes
 * เขียว/แดง signals flip intraday and reverse by the close, which violates
 * Uncle Chaloke's "Confirmed Next-Bar Rule" (decide on a COMPLETED candle,
 * then act on the next bar). The caller still uses the raw latest candle for
 * the live execution price.
 */
export function stripFormingCandle(candles: KlineData[], interval: string, now = new Date()): KlineData[] {
  if (candles.length < 2) return candles;

  const last = candles[candles.length - 1];
  // Browser klines are milliseconds; the server's Yahoo client returns seconds.
  const lastTimeMs = last.time < 1_000_000_000_000 ? last.time * 1000 : last.time;
  const lastParts = getBangkokParts(new Date(lastTimeMs));

  if (interval === '1w') {
    const nowParts = getBangkokParts(now);
    return isThaiTradingWeekIncomplete(now) && getBangkokWeekKey(nowParts) === getBangkokWeekKey(lastParts)
      ? candles.slice(0, -1)
      : candles;
  }

  if (interval === '1d') {
    const nowParts = getBangkokParts(now);
    return isThaiTradingDayCandleStillForming(now) && nowParts.dateKey === lastParts.dateKey
      ? candles.slice(0, -1)
      : candles;
  }

  const stepMs = INTRADAY_STEP_MS[interval];
  if (!stepMs) return candles;
  return now.getTime() < lastTimeMs + stepMs ? candles.slice(0, -1) : candles;
}
