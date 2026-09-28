import { useCallback, useEffect, useRef, useState } from 'react';
import type { KlineData, StockTicker24h, Timeframe } from '../types';
import { calculateCDCActionZone } from '../lib/cdcIndicator';
import { fetchStockKlines, fetchStockTicker24h, POPULAR_STOCKS } from '../lib/stockApi';

/**
 * Owns every piece of market data the dashboard renders: CDC candles for the
 * chart timeframe, candles for the bot timeframe, the ticker tape and the
 * derived "current price" of the selected symbol.
 *
 * Data fetching + polling used to live inline in `App.tsx`; keeping it here
 * means `App` no longer knows about poll intervals or the Yahoo payload shape,
 * and the fetch logic can be reused by future views / tested in isolation.
 */

export interface UseMarketDataParams {
  /** Symbol whose candles drive the chart and the bot. */
  symbol: string;
  /** Timeframe displayed on the chart. */
  chartTimeframe: Timeframe;
  /** Timeframe the bot strategy runs on (may differ from the chart). */
  botTimeframe: Timeframe;
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  /** Candle refresh interval in ms (default 10s). */
  candlePollMs?: number;
  /** Ticker tape refresh interval in ms (default 8s). */
  tickerPollMs?: number;
  /** Max number of symbols kept for the ticker tape (default 30). */
  tickerLimit?: number;
}

export interface UseMarketDataResult {
  /** CDC candles for `chartTimeframe`. */
  candles: KlineData[];
  /**
   * CDC candles for `botTimeframe`.
   *
   * TODO: currently not rendered by any component. It is kept because the two
   * timeframes are fetched on purpose (chart TF ≠ bot TF) — either wire it into
   * the chart overlay or drop it together with the extra request.
   */
  botCandles: KlineData[];
  allTickers: StockTicker24h[];
  pttPrice?: number;
  cpallPrice?: number;
  /** Latest close of `symbol`, used as the live price for manual orders. */
  currentPriceInfo: { symbol: string; price: number };
  isLoadingCandles: boolean;
  candleError: string | null;
  /** Ticker-tape fetch state so the header can show an error instead of loading forever. */
  tickerStatus: 'loading' | 'ready' | 'error';
  /** Manual refresh (e.g. the CDCChart refresh button). */
  loadCandles: () => Promise<void>;
  /** Manual ticker refresh (the polling loop calls this automatically). */
  loadTickers: () => Promise<void>;
}

const DEFAULT_CANDLE_POLL_MS = 10000;
const DEFAULT_TICKER_POLL_MS = 20000;
const DEFAULT_TICKER_LIMIT = 30;

export function useMarketData({
  symbol,
  chartTimeframe,
  botTimeframe,
  fastEmaPeriod,
  slowEmaPeriod,
  candlePollMs = DEFAULT_CANDLE_POLL_MS,
  tickerPollMs = DEFAULT_TICKER_POLL_MS,
  tickerLimit = DEFAULT_TICKER_LIMIT,
}: UseMarketDataParams): UseMarketDataResult {
  const chartIdentity = `${symbol}|${chartTimeframe}`;
  const requestIdentity = `${chartIdentity}|${botTimeframe}|${fastEmaPeriod}|${slowEmaPeriod}`;
  const [candleState, setCandleState] = useState<{ identity: string; data: KlineData[] }>({
    identity: chartIdentity,
    data: [],
  });
  const candles = candleState.identity === chartIdentity ? candleState.data : [];
  const [botCandles, setBotCandles] = useState<KlineData[]>([]);
  const [isLoadingCandles, setIsLoadingCandles] = useState(false);
  const [candleErrorState, setCandleErrorState] = useState<{ identity: string; message: string | null }>({
    identity: chartIdentity,
    message: null,
  });
  const candleError = candleErrorState.identity === chartIdentity ? candleErrorState.message : null;
  const [pttPrice, setPttPrice] = useState<number | undefined>(undefined);
  const [cpallPrice, setCpallPrice] = useState<number | undefined>(undefined);
  const [allTickers, setAllTickers] = useState<StockTicker24h[]>([]);
  const [tickerStatus, setTickerStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [currentPriceInfo, setCurrentPriceInfo] = useState<{ symbol: string; price: number }>({
    symbol: 'PTT',
    price: 0,
  });
  const activeRequestIdentityRef = useRef(requestIdentity);
  const candleRequestIdRef = useRef(0);
  activeRequestIdentityRef.current = requestIdentity;

  // 1. Fetch Market Candlestick Data (Separating Chart View from Bot Engine)
  const loadCandles = useCallback(async () => {
    if (activeRequestIdentityRef.current !== requestIdentity) return;

    const requestId = ++candleRequestIdRef.current;
    setIsLoadingCandles(true);
    setCandleErrorState({ identity: chartIdentity, message: null });
    try {
      // A. Load Chart Viewing Candles (on chartTimeframe)
      const chartRaw = await fetchStockKlines(symbol, chartTimeframe, 750);
      if (requestId !== candleRequestIdRef.current || activeRequestIdentityRef.current !== requestIdentity) return;

      if (chartRaw.length === 0) {
        setCandleErrorState({
          identity: chartIdentity,
          message: 'เซิร์ฟเวอร์ไม่ส่งแท่งเทียนกลับมา ตรวจ DASHBOARD_TOKEN และแหล่งข้อมูลหุ้นบน Host',
        });
      }

      const chartCdc = calculateCDCActionZone(chartRaw, fastEmaPeriod, slowEmaPeriod);
      setCandleState({ identity: chartIdentity, data: chartCdc });
      if (chartCdc.length > 0) {
        const latest = chartCdc[chartCdc.length - 1];
        setCurrentPriceInfo({ symbol, price: latest.close });
      }

      // B. Load Bot Strategy Candles (strictly on botTimeframe)
      if (chartTimeframe === botTimeframe) {
        setBotCandles(chartCdc);
      } else {
        const botRaw = await fetchStockKlines(symbol, botTimeframe, 750);
        if (requestId !== candleRequestIdRef.current || activeRequestIdentityRef.current !== requestIdentity) return;

        const botCdc = calculateCDCActionZone(botRaw, fastEmaPeriod, slowEmaPeriod);
        setBotCandles(botCdc);
      }
    } catch (err) {
      if (requestId === candleRequestIdRef.current && activeRequestIdentityRef.current === requestIdentity) {
        console.error('Error loading klines:', err);
        setCandleErrorState({
          identity: chartIdentity,
          message: err instanceof Error ? err.message : 'ดึงข้อมูลกราฟหุ้นไม่สำเร็จ',
        });
      }
    } finally {
      if (requestId === candleRequestIdRef.current && activeRequestIdentityRef.current === requestIdentity) {
        setIsLoadingCandles(false);
      }
    }
  }, [symbol, botTimeframe, chartTimeframe, fastEmaPeriod, slowEmaPeriod, chartIdentity, requestIdentity]);

  // 2. Fetch All Stock Prices for Header Running Ticker Tape
  const loadTickers = useCallback(async () => {
    try {
      const raw = await fetchStockTicker24h();
      if (raw && raw.length > 0) {
        const popularSet = new Set(POPULAR_STOCKS);
        const filtered = raw
          .filter((t) => popularSet.has(t.symbol))
          .sort((a, b) => {
            const indexA = POPULAR_STOCKS.indexOf(a.symbol);
            const indexB = POPULAR_STOCKS.indexOf(b.symbol);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return b.quoteVolume - a.quoteVolume;
          })
          .slice(0, tickerLimit);

        setAllTickers(filtered);
        setTickerStatus('ready');

        const ptt = raw.find((t) => t.symbol === 'PTT');
        const cpall = raw.find((t) => t.symbol === 'CPALL');
        if (ptt) setPttPrice(ptt.lastPrice);
        if (cpall) setCpallPrice(cpall.lastPrice);
      } else {
        setTickerStatus('error');
      }
    } catch (err) {
      console.warn('Ticker update failed:', err);
      setTickerStatus('error');
    }
  }, [tickerLimit]);

  // Initial load + polling. Re-runs (and resets the intervals) whenever the
  // symbol / timeframe / EMA settings change, which also triggers an immediate refetch.
  useEffect(() => {
    loadCandles();
    loadTickers();

    const candleInterval = setInterval(loadCandles, candlePollMs);
    const tickerInterval = setInterval(loadTickers, tickerPollMs);

    return () => {
      clearInterval(candleInterval);
      clearInterval(tickerInterval);
    };
  }, [loadCandles, loadTickers, candlePollMs, tickerPollMs]);

  return {
    candles,
    botCandles,
    allTickers,
    pttPrice,
    cpallPrice,
    currentPriceInfo,
    isLoadingCandles,
    candleError,
    tickerStatus,
    loadCandles,
    loadTickers,
  };
}
