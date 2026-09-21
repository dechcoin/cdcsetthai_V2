/**
 * Shared types for the Market Scanner feature module.
 */

export type MarketScanMode =
  | 'ALL_MARKET'
  | 'SET100'
  | 'SET50'
  | 'SSET'
  | 'MAI'
  | 'WATCHLIST'
  | 'CUSTOM';

export type ScannerViewLayout = 'GRID' | 'TABLE';