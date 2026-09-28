import type { CDCZoneColor, CDCSignalType, Timeframe } from './market.types';
import type { PricePositionAssessment } from '../lib/quantEngine';

/**
 * Market-scanner domain types: per-symbol scan results plus the CDC quality
 * scoring breakdown that drives scanner ranking.
 */

export interface QualityFactorDetail {
  score: number;
  maxScore: number;
  label: string;
  detail: string;
}

export interface QualityScoreBreakdown {
  totalScore: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  gradeLabel: string;
  entryTimingCategory: 'PRIME_ENTRY' | 'EARLY_TREND' | 'MID_TREND' | 'LATE_STAGE' | 'BEAR_AVOID';
  entryTimingLabel: string;
  recency: QualityFactorDetail;
  zone: QualityFactorDetail;
  trendStrength: QualityFactorDetail;
  volume24h: QualityFactorDetail;
  priceChange: QualityFactorDetail;
}

export interface ScannerStockResult {
  symbol: string;
  currentPrice: number;
  priceChange24h: number;
  volume24h: number;
  timeframe: Timeframe;
  zone: CDCZoneColor;
  signal: CDCSignalType;
  emaFast: number;
  emaSlow: number;
  trendStrength: number; // % difference between Fast and Slow EMA
  lastSignalTime: string;
  barsSinceSignal: number;
  barsSinceGoldenCross: number;
  isFresh: boolean;
  isFreshGoldenCross: boolean;
  isWatchlist?: boolean;
  entryTimingCategory: 'PRIME_ENTRY' | 'EARLY_TREND' | 'MID_TREND' | 'LATE_STAGE' | 'BEAR_AVOID';
  entryTimingLabel: string;
  qualityScore: number;
  qualityGrade: 'S' | 'A' | 'B' | 'C' | 'D';
  qualityBreakdown: QualityScoreBreakdown;
  pricePosition: PricePositionAssessment | null;
  isBullish?: boolean;
  isBreakout?: boolean;
  isDivergence?: boolean;
}

export interface TechnicalStatus {
  isBullish: boolean;
  isBreakout: boolean;
  isDivergence: boolean;
}
