import type { KlineData } from '../types';
import { calculateEMA, calculateCDCActionZone, getCrossoverInfo } from './cdcIndicator';

export type MarketRegime = 'BULLISH_TRENDING' | 'BEARISH_TRENDING' | 'RANGING' | 'HIGH_VOLATILITY';

export interface QuantAssessment {
  baseScore: number;
  effectiveScore: number;
  regime: MarketRegime;
  regimeFactor: number;
  entryFactor: number;
  atr: number;
  rsi: number;
  rvol: number;
  vwap: number;
  reasons: string[];
}

export type PricePositionZone = 'NEAR_BASE' | 'MID_RANGE' | 'EXTENDED';

/** Broader daily price-location bands; these are advisory heuristics, not buy signals. */
export const DAILY_PRICE_POSITION_THRESHOLDS = {
  nearBaseAtr: 2,
  nearBaseRange: 0.35,
  extendedAtr: 4,
  extendedRange: 0.75,
} as const;

export interface PricePositionAssessment {
  zone: PricePositionZone;
  labelTh: string;
  support: number;
  resistance: number;
  atr: number;
  distanceToBaseAtr: number;
  rangePosition: number;
  /** Advisory only: the daily CDC trend has not broken down. */
  entryReady: boolean;
  supportHeld: boolean;
}

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

export function calculateRSI(closes: number[], period = 14): number[] {
  const out = new Array(closes.length).fill(50);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; gain += Math.max(d, 0); loss += Math.max(-d, 0); }
  for (let i = period; i < closes.length; i++) {
    if (i > period) { const d = closes[i] - closes[i - 1]; gain = (gain * (period - 1) + Math.max(d, 0)) / period; loss = (loss * (period - 1) + Math.max(-d, 0)) / period; }
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function calculateATR(candles: KlineData[], period = 14): number[] {
  const out = new Array(candles.length).fill(0); if (!candles.length) return out;
  let atr = 0;
  for (let i = 0; i < candles.length; i++) {
    const prev = i ? candles[i - 1].close : candles[i].close;
    const tr = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - prev), Math.abs(candles[i].low - prev));
    atr = i === 0 ? tr : i < period ? (atr * i + tr) / (i + 1) : (atr * (period - 1) + tr) / period;
    out[i] = atr;
  }
  return out;
}

/**
 * Classifies the latest CLOSED daily candle against the prior 60-session range.
 * The current candle is excluded from swing-point discovery so a fresh low
 * cannot redefine itself as support. This is a location aid, never a CDC signal.
 */
export function assessDailyPricePosition(candles: KlineData[]): PricePositionAssessment | null {
  if (candles.length < 22) return null;
  const latest = candles[candles.length - 1];
  const history = candles.slice(Math.max(0, candles.length - 61), -1);
  if (history.length < 20 || latest.close <= 0) return null;

  const swingLowStart = Math.max(2, history.length - 60);
  let support = Math.min(...history.map(c => c.low));
  for (let i = swingLowStart; i < history.length - 2; i++) {
    const candidate = history[i].low;
    const isConfirmedSwingLow = candidate <= history[i - 1].low && candidate <= history[i - 2].low &&
      candidate <= history[i + 1].low && candidate <= history[i + 2].low;
    if (isConfirmedSwingLow) support = candidate; // most recent confirmed daily pivot low
  }
  const resistance = Math.max(...history.map(c => c.high));
  const atrValues = calculateATR(candles, 14);
  const atr = atrValues[atrValues.length - 1];
  if (!(atr > 0) || !(resistance > support)) return null;

  const distanceToBaseAtr = (latest.close - support) / atr;
  const supportHeld = latest.close >= support;
  const rangePosition = clamp((latest.close - support) / (resistance - support), 0, 1);
  let zone: PricePositionZone;
  if (distanceToBaseAtr <= DAILY_PRICE_POSITION_THRESHOLDS.nearBaseAtr || rangePosition <= DAILY_PRICE_POSITION_THRESHOLDS.nearBaseRange) zone = 'NEAR_BASE';
  else if (distanceToBaseAtr >= DAILY_PRICE_POSITION_THRESHOLDS.extendedAtr || rangePosition >= DAILY_PRICE_POSITION_THRESHOLDS.extendedRange) zone = 'EXTENDED';
  else zone = 'MID_RANGE';

  const ema26 = calculateEMA(candles.map(c => c.close), 26).at(-1) || 0;
  const cdc = calculateCDCActionZone(candles, 12, 26);
  const currentZone = cdc.at(-1)?.zone;
  const freshGoldenCross = getCrossoverInfo(cdc).barsSinceGoldenCross <= 2;
  const entryReady = zone === 'NEAR_BASE' && supportHeld && latest.close >= ema26 && currentZone === 'GREEN' && freshGoldenCross;

  return {
    zone,
    labelTh: zone === 'NEAR_BASE' ? (supportHeld ? 'ใกล้ฐาน' : 'หลุดฐาน') : zone === 'MID_RANGE' ? 'โซนกลาง' : 'ราคายืดตัว',
    support,
    resistance,
    atr,
    distanceToBaseAtr,
    rangePosition,
    entryReady,
    supportHeld,
  };
}

export function assessBuySetup(candles: KlineData[]): QuantAssessment | null {
  if (candles.length < 30) return null;
  const enriched = calculateCDCActionZone(candles, 12, 26);
  const closes = candles.map(c => c.close), volumes = candles.map(c => c.volume || 0);
  const fast = calculateEMA(closes, 12), slow = calculateEMA(closes, 26), baseline = calculateEMA(closes, 99);
  const rsi = calculateRSI(closes), atr = calculateATR(candles);
  const i = candles.length - 1, c = candles[i], a = atr[i], rvWindow = volumes.slice(Math.max(0, i - 19), i);
  const avgVol = rvWindow.reduce((s, v) => s + v, 0) / Math.max(1, rvWindow.length);
  const rvol = avgVol > 0 ? volumes[i] / avgVol : 0;
  const vwapWindow = candles.slice(Math.max(0, i - 19), i + 1);
  const vwapDen = vwapWindow.reduce((s, x) => s + x.volume, 0);
  const vwap = vwapDen > 0 ? vwapWindow.reduce((s, x) => s + ((x.high + x.low + x.close) / 3) * x.volume, 0) / vwapDen : c.close;
  const volPct = c.close > 0 ? a / c.close : 0;
  const regime: MarketRegime = volPct > 0.06 ? 'HIGH_VOLATILITY' : fast[i] > slow[i] && slow[i] > baseline[i] && c.close >= fast[i] ? 'BULLISH_TRENDING' : fast[i] < slow[i] && slow[i] < baseline[i] ? 'BEARISH_TRENDING' : 'RANGING';
  const regimeFactor = regime === 'BULLISH_TRENDING' ? 1.25 : regime === 'HIGH_VOLATILITY' ? 0.75 : regime === 'BEARISH_TRENDING' ? 0.4 : 0.95;
  const latest = enriched[i], prev = enriched[i - 1];
  const barsSinceGoldenCross = getCrossoverInfo(enriched).barsSinceGoldenCross;
  const freshGreen = latest.zone === 'GREEN' && barsSinceGoldenCross <= 2;
  let score = latest.zone === 'GREEN' ? 20 : latest.zone === 'BLUE' ? 10 : 4;
  score += fast[i] > slow[i] ? (c.close >= fast[i] ? 10 : 7) : 1;
  score += c.close >= baseline[i] && fast[i] > baseline[i] ? 10 : Math.abs(c.close - baseline[i]) / baseline[i] <= .015 ? 5 : 1;
  score += rvol >= 2 ? 15 : rvol >= 1.5 ? 12 : rvol >= 1 ? 9 : rvol >= .7 ? 6 : 3;
  score += rsi[i] >= 50 && rsi[i] <= 65 ? 10 : rsi[i] >= 40 && rsi[i] <= 70 ? 7 : 2;
  score += c.close >= vwap ? 10 : 3;
  score += freshGreen ? 10 : 4;
  const range = Math.max(c.high - c.low, Number.EPSILON);
  const upperWick = (c.high - Math.max(c.open, c.close)) / range;
  score += upperWick <= .45 ? 5 : 1;
  score += freshGreen ? 10 : latest.zone === 'GREEN' ? 6 : 2;
  const entryFactor = latest.zone === 'RED' || latest.zone === 'ORANGE'
    ? .3
    : freshGreen ? 1.05
    : latest.zone === 'GREEN' ? 0.95
    : latest.zone === 'BLUE' ? 0.55
    : 0.45;
  const reasons = [`CDC=${latest.zone}${freshGreen ? '/FRESH_GREEN' : ''}`, `regime=${regime}`, `RSI=${rsi[i].toFixed(1)}`, `RVOL=${rvol.toFixed(2)}`, `VWAP=${vwap.toFixed(2)}`];
  return { baseScore: clamp(score), effectiveScore: clamp(score * regimeFactor * entryFactor), regime, regimeFactor, entryFactor, atr: a, rsi: rsi[i], rvol, vwap, reasons };
}

/**
 * Detects key technical setup statuses:
 * - BULLISH: EMA12 > EMA26 with price holding above EMA26 / CDC Green or Blue zone.
 * - BREAKOUT: Close or High >= highest high of the prior 20-session window with positive close.
 * - DIVERGENCE: Bullish RSI(14) divergence where price makes lower/equal low while RSI makes higher low.
 */
export function detectTechnicalStatus(
  candles: KlineData[],
  cdcCandles?: Array<KlineData & { zone?: string; emaFast?: number; emaSlow?: number }>
): { isBullish: boolean; isBreakout: boolean; isDivergence: boolean } {
  if (!candles || candles.length < 20) {
    return { isBullish: false, isBreakout: false, isDivergence: false };
  }

  const closes = candles.map((c) => c.close);
  const n = candles.length;
  const latest = candles[n - 1];

  // 1. BULLISH
  const fast = calculateEMA(closes, 12);
  const slow = calculateEMA(closes, 26);
  const latestFast = fast[n - 1];
  const latestSlow = slow[n - 1];
  const latestZone = cdcCandles?.[cdcCandles.length - 1]?.zone;

  const isBullish =
    latestFast > latestSlow &&
    (latest.close >= latestSlow || latestZone === 'GREEN' || latestZone === 'BLUE');

  // 2. BREAKOUT (20-period swing high resistance breakout)
  const lookbackBars = Math.min(20, n - 1);
  const priorWindow = candles.slice(n - 1 - lookbackBars, n - 1);
  const highestPriorHigh = Math.max(...priorWindow.map((c) => c.high));
  const highestPriorClose = Math.max(...priorWindow.map((c) => c.close));

  const isBreakout =
    (latest.close >= highestPriorHigh || (latest.high >= highestPriorHigh && latest.close >= highestPriorClose)) &&
    latest.close >= latest.open;

  // 3. DIVERGENCE (Bullish Divergence on RSI 14)
  const rsi = calculateRSI(closes, 14);
  let isDivergence = false;

  const windowStart = Math.max(1, n - 35);
  const swingLows: { index: number; priceLow: number; rsiVal: number }[] = [];

  for (let i = windowStart + 1; i < n - 1; i++) {
    const isPivotLow =
      candles[i].low <= candles[i - 1].low &&
      candles[i].low <= candles[i + 1].low;
    if (isPivotLow) {
      swingLows.push({
        index: i,
        priceLow: candles[i].low,
        rsiVal: rsi[i],
      });
    }
  }

  if (swingLows.length >= 2) {
    const prevLow = swingLows[swingLows.length - 2];
    const currLow = swingLows[swingLows.length - 1];
    const barDiff = currLow.index - prevLow.index;

    if (barDiff >= 4 && barDiff <= 28) {
      const priceLowerOrEqual = currLow.priceLow <= prevLow.priceLow * 1.015;
      const rsiHigher = currLow.rsiVal > prevLow.rsiVal + 1.5;
      if (priceLowerOrEqual && rsiHigher && currLow.rsiVal < 65) {
        if (latest.close >= currLow.priceLow * 0.98) {
          isDivergence = true;
        }
      }

      if (!isDivergence && isBullish) {
        const priceHigherLow = currLow.priceLow >= prevLow.priceLow * 0.99;
        const rsiLowerLow = currLow.rsiVal < prevLow.rsiVal - 1.5;
        if (priceHigherLow && rsiLowerLow && currLow.rsiVal < 55) {
          isDivergence = true;
        }
      }
    }
  } else if (swingLows.length === 1 && n >= 20) {
    const prevLow = swingLows[0];
    const recentMinPrice = Math.min(...candles.slice(n - 5).map((c) => c.low));
    const recentMinRsi = Math.min(...rsi.slice(n - 5));

    if (
      n - prevLow.index >= 5 &&
      recentMinPrice <= prevLow.priceLow * 1.015 &&
      recentMinRsi > prevLow.rsiVal + 2.0 &&
      recentMinRsi < 60
    ) {
      isDivergence = true;
    }
  }

  return { isBullish, isBreakout, isDivergence };
}
