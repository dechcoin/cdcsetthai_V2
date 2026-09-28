/**
 * Market data domain types: candles, tickers and order-book primitives that are
 * shared by the price feed, indicators, charts and the scanner.
 */

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '45m' | '1h' | '4h' | '1d' | '1w';

export type CDCZoneColor = 'GREEN' | 'BLUE' | 'YELLOW' | 'RED' | 'ORANGE' | 'CYAN';

export type CDCSignalType = 'BUY' | 'SELL' | 'HOLD_BULL' | 'HOLD_BEAR' | 'WARNING' | 'NEUTRAL';

export interface KlineData {
  time: number; // Timestamp in ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  // Indicator calculations
  emaFast?: number;
  emaSlow?: number;
  zone?: CDCZoneColor;
  signal?: CDCSignalType;
  colorNameTh?: string;
  actionRecommendation?: string;
  emaBaseline?: number;
  rsi?: number;
  atr?: number;
  rvol?: number;
  vwap?: number;
}

export interface StockTicker24h {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
}

export interface OrderBookEntry {
  price: number;
  quantity: number;
  total: number;
}

export interface OrderBookData {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
}
