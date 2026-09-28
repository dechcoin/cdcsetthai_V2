import type { ScannerStockResult, Timeframe } from '../types';
import { calculateCDCActionZone, calculateCdcQualityScore, getBarsSinceZoneChange, getCrossoverInfo } from './cdcIndicator';
import { fetchStockKlines, fetchStockTicker24h } from './stockApi';
import { assessDailyPricePosition, detectTechnicalStatus } from './quantEngine';
import { stripFormingCandle } from './marketTime';

/**
 * Pure scanner business logic, extracted from `MarketScanner.tsx`.
 *
 * Nothing in this module touches React, so the scan engine, the result
 * filtering/sorting and the summary maths can be reasoned about (and tested)
 * without mounting a component.
 */

export type SignalFilterType =
  | 'ALL'
  | 'PRIME_ENTRY'
  | 'BUY_FRESH'
  | 'BULL_STRONG'
  | 'WARN_TAKE_PROFIT'
  | 'BEAR_CASH'
  | 'QUALITY_HIGH'
  | 'FRESH_SIGNAL'
  | 'HIGH_VOLUME'
  | 'TOP_GAINERS'
  | 'BULLISH'
  | 'BREAKOUT'
  | 'DIVERGENCE';

export type SortOption = 'SCORE_DESC' | 'CHANGE_DESC' | 'CHANGE_ASC' | 'VOLUME_DESC' | 'RECENCY_ASC' | 'SYMBOL_ASC';

/** Minimum traded value (THB) for the "high volume" filter badge. */
export const HIGH_VOLUME_THRESHOLD_THB = 20_000_000;

/** Quality score at/above which a stock counts as "top quality" (grade S/A). */
export const TOP_QUALITY_SCORE = 75;

/** Default EMA periods used by the CDC Action Zone V3 scan. */
const SCAN_FAST_EMA = 12;
const SCAN_SLOW_EMA = 26;

/** Parallel batch size when fetching candles during a scan. */
const SCAN_CHUNK_SIZE = 4;

/** Candles requested per symbol when scanning. */
const SCAN_KLINE_LIMIT = 120;

export interface ScanProgress {
  /** 0–100 */
  percent: number;
  /** Symbols finished so far. */
  completed: number;
  /** Total symbols in this scan. */
  total: number;
}

/**
 * Runs the CDC Action Zone V3 scan over `symbols`.
 *
 * Fetches tickers once (for 24h change/volume) then candles per symbol in small
 * parallel batches to stay within provider rate limits. `onProgress` fires after
 * each symbol settles and is safe to feed straight into `setState`.
 */
export async function scanSymbols(
  symbols: string[],
  timeframe: Timeframe,
  onProgress?: (progress: ScanProgress) => void
): Promise<ScannerStockResult[]> {
  if (symbols.length === 0) return [];

  const results: ScannerStockResult[] = [];

  const tickers = await fetchStockTicker24h();
  const tickerMap = new Map<string, any>();
  tickers.forEach((t) => tickerMap.set(t.symbol, t));

  let completed = 0;
  for (let i = 0; i < symbols.length; i += SCAN_CHUNK_SIZE) {
    const chunk = symbols.slice(i, i + SCAN_CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (sym) => {
        try {
          const rawCandles = await fetchStockKlines(sym, timeframe, SCAN_KLINE_LIMIT);
          const timeframeCandles = stripFormingCandle(rawCandles, timeframe);
          const cdcCandles = calculateCDCActionZone(timeframeCandles, SCAN_FAST_EMA, SCAN_SLOW_EMA);

          if (cdcCandles.length > 0) {
            const latest = cdcCandles[cdcCandles.length - 1];
            const prev = cdcCandles.length > 1 ? cdcCandles[cdcCandles.length - 2] : latest;
            const ticker = tickerMap.get(sym);

            const currentPrice = latest.close;
            const priceChange24h = ticker
              ? ticker.priceChangePercent
              : prev.close > 0
              ? ((currentPrice - prev.close) / prev.close) * 100
              : 0;
            const volume24h = ticker && ticker.quoteVolume > 0 ? ticker.quoteVolume : latest.volume * latest.close;

            const trendStrength =
              latest.emaFast && latest.emaSlow && latest.emaSlow > 0
                ? ((latest.emaFast - latest.emaSlow) / latest.emaSlow) * 100
                : 0;

            const barsSinceZoneChange = getBarsSinceZoneChange(cdcCandles);
            const crossoverInfo = getCrossoverInfo(cdcCandles);
            const barsSinceGoldenCross = crossoverInfo.barsSinceGoldenCross;
            const isFreshGoldenCross = crossoverInfo.isFreshGoldenCross;
            const isFresh = barsSinceZoneChange <= 1 || isFreshGoldenCross;

            const qualityBreakdown = calculateCdcQualityScore({
              zone: latest.zone || 'CYAN',
              barsSinceZoneChange,
              barsSinceGoldenCross,
              isFreshGoldenCross,
              trendStrength,
              volume24h,
              priceChange24h,
            });
            const pricePosition = assessDailyPricePosition(timeframeCandles);
            const technicalStatus = detectTechnicalStatus(timeframeCandles, cdcCandles);

            results.push({
              symbol: sym,
              currentPrice,
              priceChange24h,
              volume24h,
              timeframe,
              zone: latest.zone || 'CYAN',
              signal: latest.signal || 'NEUTRAL',
              emaFast: latest.emaFast || 0,
              emaSlow: latest.emaSlow || 0,
              trendStrength,
              lastSignalTime: new Date(latest.time).toLocaleDateString('th-TH'),
              barsSinceSignal: barsSinceZoneChange,
              barsSinceGoldenCross,
              isFresh,
              isFreshGoldenCross,
              entryTimingCategory: qualityBreakdown.entryTimingCategory,
              entryTimingLabel: qualityBreakdown.entryTimingLabel,
              qualityScore: qualityBreakdown.totalScore,
              qualityGrade: qualityBreakdown.grade,
              qualityBreakdown,
              pricePosition,
              isBullish: technicalStatus.isBullish,
              isBreakout: technicalStatus.isBreakout,
              isDivergence: technicalStatus.isDivergence,
            });
          }
        } catch (e) {
          console.warn(`Failed to scan ${sym}:`, e);
        } finally {
          completed++;
          onProgress?.({
            percent: Math.round((completed / symbols.length) * 100),
            completed,
            total: symbols.length,
          });
        }
      })
    );
  }

  return results;
}

export interface ScannerFilterOptions {
  searchQuery: string;
  signalFilter: SignalFilterType;
  sortBy: SortOption;
}

/** Applies the search box, the signal-filter badge and the sort option. */
export function filterAndSortStockResults(
  results: ScannerStockResult[],
  { searchQuery, signalFilter, sortBy }: ScannerFilterOptions
): ScannerStockResult[] {
  return results
    .filter((stock) => {
      // Search query filter
      const matchesSearch = stock.symbol.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      // Signal Filter Badges
      switch (signalFilter) {
        case 'PRIME_ENTRY':
          return stock.barsSinceGoldenCross <= 2 && stock.zone === 'GREEN';
        case 'BUY_FRESH':
          return stock.zone === 'BLUE';
        case 'BULL_STRONG':
          return stock.zone === 'GREEN';
        case 'WARN_TAKE_PROFIT':
          return stock.zone === 'YELLOW';
        case 'BEAR_CASH':
          return stock.zone === 'RED';
        case 'QUALITY_HIGH':
          return stock.qualityScore >= TOP_QUALITY_SCORE; // Grade S and A
        case 'FRESH_SIGNAL':
          return stock.barsSinceSignal <= 2;
        case 'HIGH_VOLUME':
          return stock.volume24h >= HIGH_VOLUME_THRESHOLD_THB;
        case 'TOP_GAINERS':
          return stock.priceChange24h > 0;
        case 'BULLISH':
          return !!stock.isBullish;
        case 'BREAKOUT':
          return !!stock.isBreakout;
        case 'DIVERGENCE':
          return !!stock.isDivergence;
        case 'ALL':
        default:
          return true;
      }
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'SCORE_DESC':
          return b.qualityScore - a.qualityScore;
        case 'CHANGE_DESC':
          return b.priceChange24h - a.priceChange24h;
        case 'CHANGE_ASC':
          return a.priceChange24h - b.priceChange24h;
        case 'VOLUME_DESC':
          return b.volume24h - a.volume24h;
        case 'RECENCY_ASC':
          return a.barsSinceSignal - b.barsSinceSignal;
        case 'SYMBOL_ASC':
        default:
          return a.symbol.localeCompare(b.symbol);
      }
    });
}

export interface ScannerSummaryMetrics {
  total: number;
  buySignals: number;
  freshBuys: number;
  primeEntries: number;
  topQuality: number;
  avgScore: number;
}

/** Aggregate numbers shown in the summary banner above the results. */
export function calculateScannerSummary(results: ScannerStockResult[]): ScannerSummaryMetrics {
  const total = results.length;
  const buySignals = results.filter((r) => r.zone === 'GREEN').length;
  const freshBuys = results.filter((r) => r.zone === 'BLUE').length;
  const primeEntries = results.filter(
    (r) => r.barsSinceGoldenCross <= 2 && r.zone === 'GREEN'
  ).length;
  const topQuality = results.filter((r) => r.qualityScore >= TOP_QUALITY_SCORE).length;
  const avgScore = total > 0 ? Math.round(results.reduce((acc, r) => acc + r.qualityScore, 0) / total) : 0;

  return { total, buySignals, freshBuys, primeEntries, topQuality, avgScore };
}

export interface QualityScoreTheme {
  /** Wrapper classes for the score card. */
  bg: string;
  /** Gradient classes for the progress bar. */
  bar: string;
  /** Classes for the grade badge. */
  badge: string;
}

/** Colour theme for a CDC quality score (0–100). */
export function getQualityScoreTheme(score: number): QualityScoreTheme {
  if (score >= 85) {
    return {
      bg: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400',
      bar: 'from-emerald-500 to-teal-400',
      badge: 'bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-black',
    };
  }
  if (score >= 70) {
    return {
      bg: 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400',
      bar: 'from-cyan-500 to-blue-400',
      badge: 'bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950 font-black',
    };
  }
  if (score >= 55) {
    return {
      bg: 'bg-amber-500/15 border-amber-500/40 text-amber-400',
      bar: 'from-amber-500 to-yellow-400',
      badge: 'bg-amber-500 text-slate-950 font-bold',
    };
  }
  if (score >= 40) {
    return {
      bg: 'bg-orange-500/15 border-orange-500/40 text-orange-400',
      bar: 'from-orange-500 to-rose-400',
      badge: 'bg-orange-500 text-slate-950 font-bold',
    };
  }
  return {
    bg: 'bg-rose-500/15 border-rose-500/40 text-rose-400',
    bar: 'from-rose-600 to-red-500',
    badge: 'bg-rose-600 text-white font-bold',
  };
}
