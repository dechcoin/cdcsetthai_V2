import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  LineStyle,
  IChartApi,
  ISeriesApi,
  IPriceLine,
  ISeriesMarkersPluginApi,
  SeriesMarker,
  Time,
} from 'lightweight-charts';
import { KlineData, Timeframe, CDCZoneColor } from '../types';
import { getStoredSymbols, getStoredWatchlist } from '../lib/botStore';
import { getZoneColorHex } from '../lib/cdcIndicator';
import {
  formatStockPrice,
  SET50_STOCKS,
  SET100_STOCKS,
  SSET_STOCKS,
  MAI_STOCKS,
  ALL_MARKET_STOCKS,
} from '../lib/stockApi';
import { assessDailyPricePosition } from '../lib/quantEngine';
import { stripFormingCandle } from '../lib/marketTime';
import {
  RefreshCw,
  Search,
  ChevronDown,
  Activity,
  Info,
  Zap,
  Layers,
  Star,
  X,
} from 'lucide-react';

interface CDCChartProps {
  candles: KlineData[];
  symbol: string;
  timeframe: Timeframe;
  botTimeframe?: Timeframe;
  isBotActive?: boolean;
  onSymbolChange: (newSymbol: string) => void;
  onTimeframeChange: (newTimeframe: Timeframe) => void;
  onBotTimeframeChange?: (newBotTimeframe: Timeframe) => void;
  onRefresh: () => void;
  isLoading: boolean;
}

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '45m', label: '45m' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
];

export const CDCChart: React.FC<CDCChartProps> = ({
  candles,
  symbol,
  timeframe,
  botTimeframe,
  isBotActive,
  onSymbolChange,
  onTimeframeChange,
  onBotTimeframeChange,
  onRefresh,
  isLoading,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ema12SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema26SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const seriesMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const lastFittedViewKeyRef = useRef<string | null>(null);
  const lastCandleCountRef = useRef(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedMarketTab, setSelectedMarketTab] = useState<'ALL' | 'SET50' | 'SET100' | 'SSET' | 'MAI' | 'WATCHLIST'>('ALL');
  const [showRibbon, setShowRibbon] = useState(true);
  const [showDailyPosition, setShowDailyPosition] = useState(false);
  const [showSignalDots, setShowSignalDots] = useState(true);
  const [showCalloutBanner, setShowCalloutBanner] = useState(true);
  const [orderAmount, setOrderAmount] = useState('100');

  // Hovered or latest candle state for top OHLC header
  const [hoveredCandle, setHoveredCandle] = useState<KlineData | null>(null);
  const [calloutPosition, setCalloutPosition] = useState<{ x: number; y: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  const getSymbolMarketInfo = useCallback((sym: string) => {
    const upper = sym.toUpperCase().trim();
    if (SET50_STOCKS.includes(upper)) {
      return { label: 'SET50', color: 'text-emerald-400', bg: 'bg-emerald-500/20', border: 'border-emerald-500/40' };
    }
    if (SET100_STOCKS.includes(upper)) {
      return { label: 'SET100', color: 'text-cyan-400', bg: 'bg-cyan-500/20', border: 'border-cyan-500/40' };
    }
    if (SSET_STOCKS.includes(upper)) {
      return { label: 'sSET', color: 'text-amber-400', bg: 'bg-amber-500/20', border: 'border-amber-500/40' };
    }
    if (MAI_STOCKS.includes(upper)) {
      return { label: 'mai', color: 'text-purple-400', bg: 'bg-purple-500/20', border: 'border-purple-500/40' };
    }
    return { label: 'SET', color: 'text-slate-400', bg: 'bg-slate-500/20', border: 'border-slate-500/40' };
  }, []);

  const currentMarketInfo = useMemo(() => getSymbolMarketInfo(symbol), [symbol, getSymbolMarketInfo]);

  const allAvailableSymbols = useMemo(() => {
    const set = new Set<string>();
    if (symbol) set.add(symbol.toUpperCase());
    getStoredSymbols().forEach((s) => set.add(s.toUpperCase()));
    getStoredWatchlist().forEach((s) => set.add(s.toUpperCase()));
    ALL_MARKET_STOCKS.forEach((s) => set.add(s.toUpperCase()));
    return Array.from(set);
  }, [symbol]);

  const filteredPairs = useMemo(() => {
    const q = searchQuery.toUpperCase().trim();
    let list = allAvailableSymbols;

    if (selectedMarketTab === 'SET50') {
      list = list.filter((s) => SET50_STOCKS.includes(s));
    } else if (selectedMarketTab === 'SET100') {
      list = list.filter((s) => SET100_STOCKS.includes(s));
    } else if (selectedMarketTab === 'SSET') {
      list = list.filter((s) => SSET_STOCKS.includes(s));
    } else if (selectedMarketTab === 'MAI') {
      list = list.filter((s) => MAI_STOCKS.includes(s));
    } else if (selectedMarketTab === 'WATCHLIST') {
      const wl = getStoredWatchlist();
      list = list.filter((s) => wl.includes(s));
    }

    if (q) {
      list = list.filter((p) => p.includes(q));
    }

    return list;
  }, [allAvailableSymbols, selectedMarketTab, searchQuery]);

  // Latest candle computation
  const latestCandle = useMemo(() => {
    return candles.length > 0 ? candles[candles.length - 1] : null;
  }, [candles]);

  const activeDisplayCandle = hoveredCandle || latestCandle;

  // OHLC Change Calculation
  const ohlcChange = useMemo(() => {
    if (!activeDisplayCandle) return { diff: 0, percent: 0, isPositive: true };
    const diff = activeDisplayCandle.close - activeDisplayCandle.open;
    const percent = activeDisplayCandle.open ? (diff / activeDisplayCandle.open) * 100 : 0;
    return {
      diff,
      percent,
      isPositive: diff >= 0,
    };
  }, [activeDisplayCandle]);

  // Clean deduplicated & sorted candle data for lightweight-charts
  const formattedCandles = useMemo(() => {
    if (!candles || candles.length === 0) return [];

    const map = new Map<number, KlineData>();
    candles.forEach((c) => {
      const timeInSec = Math.floor(c.time / 1000);
      map.set(timeInSec, c);
    });

    const sortedSecs = Array.from(map.keys()).sort((a, b) => a - b);
    return sortedSecs.map((sec) => ({
      sec,
      data: map.get(sec)!,
    }));
  }, [candles]);

  // Find latest CDC Action Zone crossover point (Golden Cross / Death Cross)
  const latestCrossoverPoint = useMemo(() => {
    if (formattedCandles.length < 2) return null;
    for (let i = formattedCandles.length - 1; i >= 1; i--) {
      const prevData = formattedCandles[i - 1].data;
      const currData = formattedCandles[i].data;
      const prevFast = prevData.emaFast;
      const prevSlow = prevData.emaSlow;
      const currFast = currData.emaFast;
      const currSlow = currData.emaSlow;

      const isBullishCross =
        prevFast !== undefined && prevSlow !== undefined && currFast !== undefined && currSlow !== undefined
          ? prevFast <= prevSlow && currFast > currSlow
          : currData.signal === 'BUY';

      const isBearishCross =
        prevFast !== undefined && prevSlow !== undefined && currFast !== undefined && currSlow !== undefined
          ? prevFast >= prevSlow && currFast < currSlow
          : currData.signal === 'SELL';

      if (isBullishCross || isBearishCross) {
        return {
          index: i,
          sec: formattedCandles[i].sec,
          candle: currData,
          isBullishCross,
          isBearishCross,
          crossPrice: currData.close,
        };
      }
    }
    return null;
  }, [formattedCandles]);

  const dailyPosition = useMemo(
    () => timeframe === '1d' ? assessDailyPricePosition(stripFormingCandle(formattedCandles.map(item => item.data), '1d')) : null,
    [formattedCandles, timeframe]
  );

  // Draw CDC Action Zone Ribbon (Cloud) between EMA 12 & EMA 26
  const drawRibbonCloud = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    const chart = chartRef.current;
    const ema12Series = ema12SeriesRef.current;
    const ema26Series = ema26SeriesRef.current;

    if (!canvas || !chart || !ema12Series || !ema26Series || !showRibbon || formattedCandles.length === 0) {
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const timeScale = chart.timeScale();
    const visibleRange = timeScale.getVisibleLogicalRange();
    if (!visibleRange) return;

    const points: { x: number; y1: number; y2: number; isBullish: boolean }[] = [];

    formattedCandles.forEach(({ sec, data }) => {
      if (data.emaFast === undefined || data.emaSlow === undefined) return;

      const x = timeScale.timeToCoordinate(sec as Time);
      if (x === null) return;

      const y1 = ema12Series.priceToCoordinate(data.emaFast);
      const y2 = ema26Series.priceToCoordinate(data.emaSlow);

      if (y1 === null || y2 === null) return;

      points.push({
        x,
        y1,
        y2,
        isBullish: data.emaFast >= data.emaSlow,
      });
    });

    if (points.length < 2) return;

    // Draw shaded polygons between consecutive points
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y1);
      ctx.lineTo(p2.x, p2.y1);
      ctx.lineTo(p2.x, p2.y2);
      ctx.lineTo(p1.x, p1.y2);
      ctx.closePath();

      // Green ribbon for Bullish (EMA12 > EMA26), Red ribbon for Bearish (EMA12 < EMA26)
      if (p1.isBullish) {
        ctx.fillStyle = 'rgba(34, 197, 94, 0.18)';
      } else {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
      }
      ctx.fill();
    }
  }, [formattedCandles, showRibbon]);

  // Update Callout Banner Position (pinned directly above latest crossover point)
  const updateCalloutPosition = useCallback(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries || formattedCandles.length === 0 || !showCalloutBanner) {
      setCalloutPosition(null);
      return;
    }

    const targetCandle = latestCrossoverPoint
      ? { sec: latestCrossoverPoint.sec, data: latestCrossoverPoint.candle }
      : formattedCandles[formattedCandles.length - 1];

    const timeScale = chart.timeScale();
    const x = timeScale.timeToCoordinate(targetCandle.sec as Time);
    const peakPrice = Math.max(
      targetCandle.data.high,
      targetCandle.data.emaFast ?? 0,
      targetCandle.data.emaSlow ?? 0
    );
    const y = candleSeries.priceToCoordinate(peakPrice);

    if (x !== null && y !== null) {
      setCalloutPosition({ x, y });
    } else {
      setCalloutPosition(null);
    }
  }, [formattedCandles, latestCrossoverPoint, showCalloutBanner]);

  // 1. Initialize Lightweight Chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const container = chartContainerRef.current;

    const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
    const initialHeight = container.clientHeight || (isMobile ? 380 : 520);

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor: '#9b9b9b',
        fontSize: 11,
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false, // 🚀 Allows smooth vertical page scrolling on mobile touch screens
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      grid: {
        vertLines: { color: '#1e222d', style: LineStyle.Solid },
        horzLines: { color: '#1e222d', style: LineStyle.Solid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#363c4e',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#2b2b43',
        },
        horzLine: {
          color: '#363c4e',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#2b2b43',
        },
      },
      rightPriceScale: {
        borderColor: '#2b2b43',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      timeScale: {
        borderColor: '#2b2b43',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
      },
      width: Math.max(1, container.clientWidth),
      height: initialHeight,
    });

    // Add Candlestick Series using CandlestickSeries
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => formatStockPrice(price).replace('$', ''),
        minMove: 0.00000001,
      },
    });

    // Add EMA Fast Series (12)
    const ema12Series = chart.addSeries(LineSeries, {
      color: '#06b6d4',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      title: 'EMA 12',
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => formatStockPrice(price).replace('$', ''),
        minMove: 0.00000001,
      },
    });

    // Add EMA Slow Series (26)
    const ema26Series = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      title: 'EMA 26',
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => formatStockPrice(price).replace('$', ''),
        minMove: 0.00000001,
      },
    });

    // Add Series Markers plugin (lightweight-charts v5)
    const seriesMarkers = createSeriesMarkers(candleSeries, []);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    ema12SeriesRef.current = ema12Series;
    ema26SeriesRef.current = ema26Series;
    seriesMarkersRef.current = seriesMarkers;

    // Crosshair move handler
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData.get(candleSeries)) {
        setHoveredCandle(null);
        return;
      }

      const candleSec = param.time as number;
      const found = formattedCandles.find((c) => c.sec === candleSec);
      if (found) {
        setHoveredCandle(found.data);
      }
    });

    // Sync ribbon and callout position on scroll/zoom
    const onRangeChange = () => {
      drawRibbonCloud();
      updateCalloutPosition();
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);

    // Resize observer
    const handleResize = () => {
      if (container && chartRef.current) {
        const w = Math.max(1, container.clientWidth);
        const h = Math.max(1, container.clientHeight);
        chartRef.current.applyOptions({ width: w, height: h });
        if (overlayCanvasRef.current) {
          overlayCanvasRef.current.width = w;
          overlayCanvasRef.current.height = h;
        }
        drawRibbonCloud();
        updateCalloutPosition();
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (seriesMarkersRef.current) {
        try {
          seriesMarkersRef.current.detach();
        } catch {
          // ignore cleanup errors
        }
        seriesMarkersRef.current = null;
      }
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // 2. Update Series Data & Markers when Candles / Settings change
  useEffect(() => {
    if (!candleSeriesRef.current || !ema12SeriesRef.current || !ema26SeriesRef.current || !chartRef.current) return;

    if (formattedCandles.length === 0) return;

    // Dynamic price formatting for micro-cap / meme coins with many decimal digits
    const latestPrice = formattedCandles[formattedCandles.length - 1].data.close;
    let dynamicMinMove = 0.01;
    if (latestPrice < 0.0001) {
      dynamicMinMove = 0.00000001;
    } else if (latestPrice < 0.01) {
      dynamicMinMove = 0.000001;
    } else if (latestPrice < 1) {
      dynamicMinMove = 0.0001;
    }

    const customPriceFormat = {
      type: 'custom' as const,
      formatter: (price: number) => formatStockPrice(price).replace('$', ''),
      minMove: dynamicMinMove,
    };

    candleSeriesRef.current.applyOptions({ priceFormat: customPriceFormat });
    ema12SeriesRef.current.applyOptions({ priceFormat: customPriceFormat });
    ema26SeriesRef.current.applyOptions({ priceFormat: customPriceFormat });

    // Prepare Candlesticks with CDC Action Zone dynamic colors
    const candleData = formattedCandles.map(({ sec, data }) => {
      const colorHex = getZoneColorHex(data.zone);
      return {
        time: sec as Time,
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
        color: colorHex,
        borderColor: colorHex,
        wickColor: colorHex,
      };
    });

    const viewKey = `${symbol}:${timeframe}`;
    const timeScale = chartRef.current.timeScale();
    const shouldFitContent = lastFittedViewKeyRef.current !== viewKey;
    const previousRange = shouldFitContent ? null : timeScale.getVisibleLogicalRange();
    const previousCandleCount = lastCandleCountRef.current;
    const wasAtRightEdge = previousRange !== null
      && previousCandleCount > 0
      && previousRange.to >= previousCandleCount - 1 - 2;

    candleSeriesRef.current.setData(candleData);

    // Prepare EMA 12 Data
    const ema12Data = formattedCandles
      .filter(({ data }) => data.emaFast !== undefined)
      .map(({ sec, data }) => ({
        time: sec as Time,
        value: data.emaFast!,
      }));
    ema12SeriesRef.current.setData(ema12Data);

    // Prepare EMA 26 Data
    const ema26Data = formattedCandles
      .filter(({ data }) => data.emaSlow !== undefined)
      .map(({ sec, data }) => ({
        time: sec as Time,
        value: data.emaSlow!,
      }));
    ema26SeriesRef.current.setData(ema26Data);

    // Prepare Buy / Sell Markers (Exact TradingView CDC Crossover Points)
    if (showSignalDots) {
      const markers: SeriesMarker<Time>[] = [];

      formattedCandles.forEach(({ sec, data }, idx) => {
        const prevData = idx > 0 ? formattedCandles[idx - 1].data : null;

        const prevFast = prevData?.emaFast;
        const prevSlow = prevData?.emaSlow;
        const currFast = data.emaFast;
        const currSlow = data.emaSlow;

        // 🎯 Crossover points: Fast EMA (12) crosses Slow EMA (26)
        const isBullishCross =
          prevFast !== undefined && prevSlow !== undefined && currFast !== undefined && currSlow !== undefined
            ? prevFast <= prevSlow && currFast > currSlow
            : data.signal === 'BUY';

        const isBearishCross =
          prevFast !== undefined && prevSlow !== undefined && currFast !== undefined && currSlow !== undefined
            ? prevFast >= prevSlow && currFast < currSlow
            : data.signal === 'SELL';

        if (isBullishCross) {
          markers.push({
            time: sec as Time,
            position: 'belowBar',
            color: '#3b82f6',
            shape: 'circle',
            size: 2,
            text: 'BUY',
          });
        } else if (isBearishCross) {
          markers.push({
            time: sec as Time,
            position: 'aboveBar',
            color: '#ef4444',
            shape: 'circle',
            size: 2,
            text: 'SELL',
          });
        }
      });

      if (seriesMarkersRef.current) {
        markers.sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
        seriesMarkersRef.current.setMarkers(markers);
      }
    } else {
      if (seriesMarkersRef.current) {
        seriesMarkersRef.current.setMarkers([]);
      }
    }

    // Fit once for each symbol/timeframe. During polling, preserve the user's
    // zoom and scroll position instead of snapping the chart back to all data.
    if (shouldFitContent) {
      timeScale.fitContent();
      lastFittedViewKeyRef.current = viewKey;
    } else if (previousRange) {
      const addedBars = candleData.length - previousCandleCount;
      timeScale.setVisibleLogicalRange(wasAtRightEdge
        ? { from: previousRange.from + addedBars, to: previousRange.to + addedBars }
        : previousRange);
    }
    lastCandleCountRef.current = candleData.length;

    // Redraw Overlay Ribbon & Update Callout
    setTimeout(() => {
      if (overlayCanvasRef.current && chartContainerRef.current) {
        overlayCanvasRef.current.width = chartContainerRef.current.clientWidth;
        overlayCanvasRef.current.height = chartContainerRef.current.clientHeight;
      }
      drawRibbonCloud();
      updateCalloutPosition();
    }, 50);
  }, [formattedCandles, showSignalDots, drawRibbonCloud, updateCalloutPosition, symbol, timeframe]);

  // Keep the optional daily decision levels independent from candle updates so
  // toggling them never triggers a chart data refresh or a viewport fit.
  const dailySupport = timeframe === '1d' ? dailyPosition?.support : undefined;
  const dailyResistance = timeframe === '1d' ? dailyPosition?.resistance : undefined;
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    priceLinesRef.current.forEach(line => candleSeries?.removePriceLine(line));
    priceLinesRef.current = [];

    if (!candleSeries || timeframe !== '1d' || !showDailyPosition || dailySupport === undefined || dailyResistance === undefined) return;

    priceLinesRef.current.push(candleSeries.createPriceLine({
      price: dailySupport,
      color: '#34d399',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'ฐาน 60D',
    }));
    priceLinesRef.current.push(candleSeries.createPriceLine({
      price: dailyResistance,
      color: '#fb7185',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'High 60D',
    }));
  }, [dailySupport, dailyResistance, showDailyPosition, timeframe]);

  // Derived Signal Status for Callout Banner (tied to latest crossover point)
  const signalBannerInfo = useMemo(() => {
    if (!latestCandle) return null;

    if (latestCrossoverPoint) {
      const isBearish = latestCrossoverPoint.isBearishCross;
      const barsAgo = formattedCandles.length - 1 - latestCrossoverPoint.index;
      const isFresh = barsAgo <= 2;

      let actionText = '';
      let trendText = '';

      if (isBearish) {
        actionText = isFresh ? 'SELL NEXT BAR' : 'BEARISH TREND (WAIT)';
        trendText = isFresh ? 'currently in a bearish trend' : `Death cross ${barsAgo} bars ago`;
      } else {
        actionText = isFresh ? 'BUY NEXT BAR' : 'BULLISH TREND (HOLD)';
        trendText = isFresh ? 'currently in a bullish trend' : `Golden cross ${barsAgo} bars ago`;
      }

      return {
        isBearish,
        isFresh,
        actionText,
        trendText,
        price: latestCrossoverPoint.crossPrice,
        symbol,
      };
    }

    const isBearish =
      latestCandle.zone === 'RED' ||
      latestCandle.zone === 'YELLOW' ||
      latestCandle.zone === 'ORANGE' ||
      latestCandle.signal === 'SELL';

    const actionText = isBearish ? 'BEARISH TREND' : 'BULLISH TREND';
    const trendText = isBearish ? 'currently in a bearish trend' : 'currently in a bullish trend';

    return {
      isBearish,
      isFresh: false,
      actionText,
      trendText,
      price: latestCandle.close,
      symbol,
    };
  }, [formattedCandles, latestCandle, latestCrossoverPoint, symbol]);

  return (
    <div className="min-w-0 bg-[#131722] text-slate-200 rounded-xl border border-[#2a2e39] shadow-2xl overflow-hidden font-sans">
      {/* 1. TradingView Style Header Bar */}
      <div className="bg-[#181c27] px-3 sm:px-4 py-2.5 border-b border-[#2a2e39] flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3 text-xs">
        {/* Left Section: Symbol, OHLC & Quick Buy/Sell Box */}
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-4">
          {/* Symbol Dropdown Selector (Whole Market / ทั้งตลาด) */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center space-x-2 bg-[#2a2e39] hover:bg-[#363c4e] text-white px-3 py-1.5 rounded font-medium transition border border-slate-700/60 cursor-pointer shadow-sm"
              title="คลิกเพื่อเลือกหุ้นทั้งตลาด (SET50, SET100, sSET, mai)"
            >
              <div
                className={`w-10 h-5 rounded-md ${currentMarketInfo.bg} ${currentMarketInfo.color} border ${currentMarketInfo.border} flex items-center justify-center font-black text-[9px]`}
              >
                {currentMarketInfo.label}
              </div>
              <span className="font-bold text-sm tracking-wide">{symbol}</span>
              <span className="text-slate-400 text-[10px]">
                · {timeframe.toUpperCase()}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 ml-1 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isDropdownOpen && (
              <div className="absolute left-0 mt-1 w-[calc(100vw-1.5rem)] max-w-80 sm:w-96 sm:max-w-none bg-[#1e222d] border border-[#2a2e39] rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                {/* Search Header */}
                <div className="p-2.5 border-b border-[#2a2e39] flex items-center bg-[#131722] gap-2">
                  <Search className="w-4 h-4 text-emerald-400 shrink-0" />
                  <input
                    type="text"
                    placeholder="ค้นหาหุ้นทั้งตลาด เช่น PTT, BANPU, AU..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchQuery.trim()) {
                        onSymbolChange(searchQuery.toUpperCase().trim());
                        setIsDropdownOpen(false);
                        setSearchQuery('');
                      }
                    }}
                    autoFocus
                    className="bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none w-full font-mono uppercase"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="text-slate-400 hover:text-white p-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Market Group Selector Tabs (ทั้งตลาด, SET50, SET100, sSET, mai, Watchlist) */}
                <div className="px-2 py-1.5 bg-[#181c27] border-b border-[#2a2e39] flex items-center gap-1 overflow-x-auto text-[10px]">
                  {[
                    { id: 'ALL', label: '🌐 ทั้งตลาด' },
                    { id: 'SET50', label: 'SET50' },
                    { id: 'SET100', label: 'SET100' },
                    { id: 'SSET', label: 'sSET' },
                    { id: 'MAI', label: 'mai' },
                    { id: 'WATCHLIST', label: '⭐ Watchlist' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setSelectedMarketTab(tab.id as any)}
                      className={`px-2 py-0.5 rounded font-bold whitespace-nowrap transition cursor-pointer ${
                        selectedMarketTab === tab.id
                          ? 'bg-emerald-500 text-slate-950 font-black shadow-sm'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Quick Action: Open typed symbol directly */}
                {searchQuery.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      onSymbolChange(searchQuery.toUpperCase().trim());
                      setIsDropdownOpen(false);
                      setSearchQuery('');
                    }}
                    className="w-full text-left px-3 py-2 bg-emerald-950/40 hover:bg-emerald-900/60 border-b border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center justify-between transition cursor-pointer"
                  >
                    <div className="flex items-center space-x-2">
                      <Search className="w-3.5 h-3.5 text-emerald-400" />
                      <span>เปิดดูกราฟ <b>{searchQuery.toUpperCase().trim()}</b></span>
                    </div>
                    <span className="text-[10px] text-emerald-300 font-mono font-normal bg-emerald-900/60 px-1.5 py-0.5 rounded border border-emerald-500/40">
                      กด Enter ↵
                    </span>
                  </button>
                )}

                {/* Stock List (Whole Market) */}
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/50">
                  {filteredPairs.length === 0 ? (
                    <div className="p-6 text-center text-slate-500 text-xs space-y-2">
                      <p>ไม่พบหุ้นที่ค้นหาในหมวดนี้</p>
                      {searchQuery.trim() && (
                        <button
                          onClick={() => {
                            onSymbolChange(searchQuery.toUpperCase().trim());
                            setIsDropdownOpen(false);
                            setSearchQuery('');
                          }}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold transition cursor-pointer"
                        >
                          เปิดกราฟหุ้น "{searchQuery.toUpperCase().trim()}" ทันที
                        </button>
                      )}
                    </div>
                  ) : (
                    filteredPairs.map((pair) => {
                      const mInfo = getSymbolMarketInfo(pair);
                      const isCurrent = pair === symbol;

                      return (
                        <button
                          key={pair}
                          onClick={() => {
                            onSymbolChange(pair);
                            setIsDropdownOpen(false);
                            setSearchQuery('');
                          }}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-[#2a2e39] flex items-center justify-between transition cursor-pointer ${
                            isCurrent ? 'text-amber-400 bg-amber-500/10 font-bold' : 'text-slate-300'
                          }`}
                        >
                          <div className="flex items-center space-x-2">
                            <span className="font-mono font-semibold">{pair}</span>
                            {isCurrent && <span className="text-[9px] text-amber-400 bg-amber-500/20 px-1.5 py-0.2 rounded font-sans">กำลังเปิดอยู่</span>}
                          </div>
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-black border font-mono ${mInfo.bg} ${mInfo.color} ${mInfo.border}`}
                          >
                            {mInfo.label}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* OHLC Bar Readout */}
          {activeDisplayCandle && (
            <div className="hidden lg:flex items-center space-x-3 text-[11px] font-mono">
              <span className="text-slate-400">
                O: <span className={ohlcChange.isPositive ? 'text-emerald-400' : 'text-rose-400'}>{formatStockPrice(activeDisplayCandle.open)}</span>
              </span>
              <span className="text-slate-400">
                H: <span className="text-slate-200">{formatStockPrice(activeDisplayCandle.high)}</span>
              </span>
              <span className="text-slate-400">
                L: <span className="text-slate-200">{formatStockPrice(activeDisplayCandle.low)}</span>
              </span>
              <span className="text-slate-400">
                C: <span className={ohlcChange.isPositive ? 'text-emerald-400' : 'text-rose-400'}>{formatStockPrice(activeDisplayCandle.close)}</span>
              </span>
              <span className={`font-bold ${ohlcChange.isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                {ohlcChange.isPositive ? '+' : ''}
                {formatStockPrice(ohlcChange.diff)} ({ohlcChange.percent.toFixed(2)}%)
              </span>
            </div>
          )}

          {/* Quick Buy/Sell Trading Pill Widget (Matching User Screenshot Top-Left) */}
          {latestCandle && (
            <div className="flex shrink-0 items-center bg-[#131722] border border-[#2a2e39] rounded-lg overflow-hidden shadow-inner p-0.5">
              <button
                onClick={() => alert(`สั่งขาย SELL ${symbol} @ ${formatStockPrice(latestCandle.close)}`)}
                className="bg-rose-600/90 hover:bg-rose-600 text-white font-bold px-2.5 py-1 text-[11px] transition flex items-center space-x-1"
              >
                <span>{formatStockPrice(latestCandle.close).replace('$', '')}</span>
                <span className="text-[9px] bg-black/30 px-1 rounded uppercase">SELL</span>
              </button>

              <div className="px-2 py-0.5 text-[11px] text-slate-300 font-mono bg-[#181c27] border-x border-[#2a2e39]">
                <input
                  type="text"
                  value={orderAmount}
                  onChange={(e) => setOrderAmount(e.target.value)}
                  className="w-10 text-center bg-transparent focus:outline-none text-white font-semibold"
                />
              </div>

              <button
                onClick={() => alert(`สั่งซื้อ BUY ${symbol} @ ${formatStockPrice(latestCandle.close)}`)}
                className="bg-blue-600/90 hover:bg-blue-600 text-white font-bold px-2.5 py-1 text-[11px] transition flex items-center space-x-1"
              >
                <span>{formatStockPrice(latestCandle.close).replace('$', '')}</span>
                <span className="text-[9px] bg-black/30 px-1 rounded uppercase">BUY</span>
              </button>
            </div>
          )}

          {activeDisplayCandle && (
            <div className="flex w-full min-w-0 items-center gap-x-3 overflow-x-auto whitespace-nowrap text-[10px] font-mono lg:hidden scrollbar-none">
              <span className="text-slate-400">O <span className={ohlcChange.isPositive ? 'text-emerald-400' : 'text-rose-400'}>{formatStockPrice(activeDisplayCandle.open)}</span></span>
              <span className="text-slate-400">H <span className="text-slate-200">{formatStockPrice(activeDisplayCandle.high)}</span></span>
              <span className="text-slate-400">L <span className="text-slate-200">{formatStockPrice(activeDisplayCandle.low)}</span></span>
              <span className="text-slate-400">C <span className={ohlcChange.isPositive ? 'text-emerald-400' : 'text-rose-400'}>{formatStockPrice(activeDisplayCandle.close)}</span></span>
              <span className={`font-bold ${ohlcChange.isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                {ohlcChange.isPositive ? '+' : ''}{formatStockPrice(ohlcChange.diff)} ({ohlcChange.percent.toFixed(2)}%)
              </span>
            </div>
          )}
        </div>

        {/* Right Section: Timeframes & Indicator Toggles */}
        <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
          {/* Bot Strategy Timeframe Status Badge / Selector */}
          {botTimeframe && (
            <div
              className="flex w-fit max-w-full items-center space-x-1.5 px-2.5 py-1 bg-slate-900/90 border border-slate-700/80 rounded-md text-[10px]"
              title="ไทม์เฟรมที่บอทใช้รันกลยุทธ์ซื้อขาย (คลิกเปลี่ยนได้ทันที)"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isBotActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                }`}
              />
              <span className="text-slate-400 font-medium hidden sm:inline">บอทกลยุทธ์:</span>
              <select
                value={botTimeframe}
                onChange={(e) => onBotTimeframeChange && onBotTimeframeChange(e.target.value as Timeframe)}
                className="bg-transparent text-emerald-400 font-bold font-mono uppercase cursor-pointer focus:outline-none"
              >
                <option value="15m" className="bg-slate-900 text-white">15M</option>
                <option value="30m" className="bg-slate-900 text-white">30M</option>
                <option value="45m" className="bg-slate-900 text-white">45M</option>
                <option value="1h" className="bg-slate-900 text-white">1H</option>
                <option value="4h" className="bg-slate-900 text-white">4H</option>
                <option value="1d" className="bg-slate-900 text-white">1D (แนะนำ)</option>
                <option value="1w" className="bg-slate-900 text-white">1W</option>
              </select>
            </div>
          )}

          {/* Timeframe Buttons */}
          <div className="flex w-full max-w-full shrink-0 items-center overflow-x-auto bg-[#131722] p-0.5 rounded-md border border-[#2a2e39] scrollbar-none touch-pan-x sm:w-auto">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                onClick={() => onTimeframeChange(tf.value)}
                className={`min-w-8 min-h-9 shrink-0 px-1.5 sm:px-2 py-2 text-[11px] font-semibold rounded transition ${
                  timeframe === tf.value
                    ? 'bg-[#2a2e39] text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          {/* Indicator Toggles */}
          <div className="flex min-w-0 flex-1 items-start gap-2 sm:flex-none">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 bg-[#131722] p-0.5 rounded-md border border-[#2a2e39] sm:flex-none">
            <button
              onClick={() => setShowDailyPosition(value => !value)}
              disabled={timeframe !== '1d'}
              className={`px-1.5 sm:px-2 py-1 rounded text-[10px] sm:text-[11px] font-medium transition ${showDailyPosition && timeframe === '1d' ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-400 hover:text-slate-200'} disabled:opacity-40 disabled:cursor-not-allowed`}
              title="แสดง/ซ่อนฐานและ High จาก 60 วันก่อนหน้า พร้อมระยะห่างเป็น ATR(14)"
            >
              ฐาน / โซน
            </button>
            <button
              onClick={() => setShowRibbon(!showRibbon)}
              className={`px-1.5 sm:px-2 py-1 rounded text-[10px] sm:text-[11px] font-medium transition flex items-center space-x-1 ${
                showRibbon ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-500 hover:text-slate-300'
              }`}
              title="เปิด/ปิด CDC Cloud Ribbon"
            >
              <Layers className="w-3 h-3" />
              <span>ริบบอน</span>
            </button>

            <button
              onClick={() => setShowSignalDots(!showSignalDots)}
              className={`px-1.5 sm:px-2 py-1 rounded text-[10px] sm:text-[11px] font-medium transition flex items-center space-x-1 ${
                showSignalDots ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-500 hover:text-slate-300'
              }`}
              title="เปิด/ปิด จุดสัญญาณซื้อขาย"
            >
              <Zap className="w-3 h-3" />
              <span>จุดซื้อ/ขาย</span>
            </button>

            <button
              onClick={() => setShowCalloutBanner(!showCalloutBanner)}
              className={`px-1.5 sm:px-2 py-1 rounded text-[10px] sm:text-[11px] font-medium transition flex items-center space-x-1 ${
                showCalloutBanner ? 'bg-amber-500/20 text-amber-400' : 'text-slate-500 hover:text-slate-300'
              }`}
              title="เปิด/ปิด ป้ายบอกสัญญาณ Callout Banner"
            >
              <Activity className="w-3 h-3" />
              <span>ป้ายเตือน</span>
            </button>
          </div>

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="shrink-0 p-1.5 bg-[#2a2e39] hover:bg-[#363c4e] text-slate-300 rounded transition border border-slate-700/60"
            title="อัปเดตราคากราฟ"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
          </button>
          </div>
        </div>
      </div>

      {timeframe === '1d' && showDailyPosition && dailyPosition && (
        <div className="px-4 py-2 bg-[#181c27] border-b border-[#2a2e39] flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px]">
          <span className={`font-bold ${dailyPosition.zone === 'NEAR_BASE' ? 'text-emerald-300' : dailyPosition.zone === 'EXTENDED' ? 'text-rose-300' : 'text-amber-200'}`}>
            ตำแหน่งรอบ 60 วัน: {dailyPosition.labelTh}
          </span>
          <span className="text-slate-300">ฐาน {formatStockPrice(dailyPosition.support)}</span>
          <span className="text-slate-300">High {formatStockPrice(dailyPosition.resistance)}</span>
          <span className="text-slate-400">ห่างฐาน {dailyPosition.distanceToBaseAtr.toFixed(1)} ATR</span>
          {dailyPosition.zone === 'NEAR_BASE' && (
            <span className={dailyPosition.entryReady ? 'text-emerald-300' : 'text-rose-300'}>
              {!dailyPosition.supportHeld ? 'ราคาปิดหลุด swing low — อย่าตีความเป็นจุดซื้อ' : dailyPosition.entryReady ? 'แนวโน้มยังไม่เสีย — รอสัญญาณ CDC 1D' : 'ฐานใกล้ แต่แนวโน้มยังไม่ยืนยัน — รอสัญญาณ CDC 1D'}
            </span>
          )}
          {dailyPosition.zone === 'EXTENDED' && <span className="text-rose-300">ราคาเริ่มยืดตัว — ระวังไล่ราคา</span>}
        </div>
      )}

      {/* 2. Main Chart Body with Overlay Ribbon & Callout Speech Bubble */}
      <div className="relative w-full min-w-0 h-[min(420px,55vh)] min-h-[340px] sm:h-[min(520px,70vh)] bg-[#131722] touch-pan-y">
        {/* Lightweight Charts Canvas Container */}
        <div ref={chartContainerRef} className="w-full h-full touch-pan-y" />

        {/* Overlay Canvas for CDC Action Zone Ribbon Cloud */}
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 pointer-events-none z-10 touch-pan-y"
          width={800}
          height={520}
        />

        {/* 3. Floating Callout Banner (Matching User's Screenshot Banner EXACTLY) */}
        {showCalloutBanner && signalBannerInfo && (
          <div
            className={`absolute z-30 transition-all duration-300 transform -translate-x-1/2 -translate-y-full ${
              calloutPosition ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
            }`}
            style={{
              left: calloutPosition
                ? Math.max(80, Math.min(calloutPosition.x, (chartContainerRef.current?.clientWidth || 800) - 80))
                : '70%',
              top: calloutPosition ? Math.max(12, calloutPosition.y - 12) : '60%',
            }}
          >
            <div
              className={`px-4 py-2.5 rounded-lg shadow-2xl border text-white font-sans text-center relative ${
                signalBannerInfo.isBearish
                  ? 'bg-rose-600 border-rose-400 shadow-rose-900/50'
                  : 'bg-emerald-600 border-emerald-400 shadow-emerald-900/50'
              }`}
            >
              <div className="text-[12px] font-black uppercase tracking-wider leading-tight">
                {signalBannerInfo.actionText}
              </div>
              <div className="text-[11px] font-extrabold my-0.5 tracking-tight drop-shadow-sm">
                {signalBannerInfo.symbol} {formatStockPrice(signalBannerInfo.price)}
              </div>
              <div className="text-[10px] font-medium opacity-90 leading-tight">
                {signalBannerInfo.trendText}
              </div>

              {/* Speech bubble pointer arrow tip */}
              <div
                className={`absolute left-1/2 -bottom-2 -translate-x-1/2 w-0 h-0 border-x-8 border-x-transparent border-t-8 ${
                  signalBannerInfo.isBearish ? 'border-t-rose-600' : 'border-t-emerald-600'
                }`}
              />
            </div>
          </div>
        )}

        {/* Loading Spinner Overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-[#131722]/70 backdrop-blur-xs flex items-center justify-center z-40">
            <div className="flex items-center space-x-2 bg-[#1e222d] border border-[#2a2e39] px-4 py-2 rounded-lg text-amber-400 text-xs font-semibold shadow-xl">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>กำลังดึงข้อมูลกราฟหุ้น...</span>
            </div>
          </div>
        )}
      </div>

      {/* 3. Footer Legend Bar */}
      <div className="bg-[#181c27] px-4 py-2.5 border-t border-[#2a2e39] flex flex-wrap items-center justify-between text-[11px] text-slate-400 gap-3">
        <div className="flex items-center space-x-2">
          <Info className="w-3.5 h-3.5 text-slate-500" />
          <span className="font-medium text-slate-300">CDC Action Zone V3 Strategy Legend:</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-1.5 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/30">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block animate-ping" />
            <span className="text-blue-300 font-bold">● จุดฟ้า/เขียว: สัญญาณซื้อ (BUY)</span>
          </div>
          <div className="flex items-center space-x-1.5 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/30">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block animate-ping" />
            <span className="text-rose-300 font-bold">● จุดแดง: สัญญาณขาย (SELL)</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            <span>โซนเขียว (ถือครอง Long)</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 inline-block" />
            <span>โซนเหลือง (เตือนขาย)</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
            <span>โซนแดง (ถือเงินสด / Short)</span>
          </div>
        </div>
      </div>
    </div>
  );
};
