import React, { useMemo, useState } from 'react';
import { Timeframe, BacktestResult, KlineData } from '../types';
import {
  fetchStockKlines,
  formatStockPrice,
  POPULAR_STOCKS,
  SET50_STOCKS,
  SET100_STOCKS,
  SSET_STOCKS,
  MAI_STOCKS,
  ALL_MARKET_STOCKS,
} from '../lib/stockApi';
import { getStoredSymbols, getStoredWatchlist } from '../lib/botStore';
import { runBacktestSimulation } from '../lib/backtestEngine';
import { stripFormingCandle } from '../lib/marketTime';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { Play, TrendingUp, Award, AlertTriangle, ArrowUpRight, ArrowDownRight, RefreshCw, BarChart2, Layers, Loader2, ShieldCheck } from 'lucide-react';

type MarketUniverse = 'ALL_MARKET' | 'SET50' | 'SET100' | 'SSET' | 'MAI' | 'WATCHLIST';
type BenchmarkSymbol = '^SET.BK' | 'TDEX' | 'BSET100' | 'NONE';

const BENCHMARK_LABELS: Record<BenchmarkSymbol, string> = {
  '^SET.BK': 'SET Index (^SET.BK)',
  TDEX: 'TDEX (SET50 ETF)',
  BSET100: 'BSET100 (SET100 ETF)',
  NONE: 'ปิด Benchmark',
};

export const BacktestingView: React.FC = () => {
  const [mode, setMode] = useState<'SINGLE' | 'ALL_MARKET'>('SINGLE');
  const [symbol, setSymbol] = useState('PTT');
  const [timeframe, setTimeframe] = useState<Timeframe>('1d');
  const [candleCount, setCandleCount] = useState(500);
  const [initialCapital, setInitialCapital] = useState<number | string>(100000);
  const [stopLossPct, setStopLossPct] = useState<number | string>(5);
  const [takeProfitPct, setTakeProfitPct] = useState<number | string>(20);
  const [buyZone, setBuyZone] = useState<'BLUE' | 'GREEN'>('GREEN');
  const [feePercent, setFeePercent] = useState<number | string>(0.15);
  const [otherFeePercent, setOtherFeePercent] = useState<number | string>(0);
  const [slippagePercent, setSlippagePercent] = useState<number | string>(0.1);
  const [minNotionalThb, setMinNotionalThb] = useState<number | string>(0);
  const [benchmarkSymbol, setBenchmarkSymbol] = useState<BenchmarkSymbol>('^SET.BK');

  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);

  const [marketUniverse, setMarketUniverse] = useState<MarketUniverse>('ALL_MARKET');
  const [isMarketLoading, setIsMarketLoading] = useState(false);
  const [marketProgress, setMarketProgress] = useState(0);
  const [marketTotal, setMarketTotal] = useState(0);
  const [marketResults, setMarketResults] = useState<BacktestResult[]>([]);
  const [marketSortKey, setMarketSortKey] = useState<'totalReturnPercent' | 'winRatePercent' | 'profitFactor' | 'totalTrades'>('totalReturnPercent');
  const [marketSortAsc, setMarketSortAsc] = useState(false);

  const numInitialCapital = Number(initialCapital) || 100000;
  const numStopLossPct = Number(stopLossPct) || 0;
  const numTakeProfitPct = Number(takeProfitPct) || 0;

  const runBacktest = async () => {
    setIsLoading(true);
    try {
      let benchmarkCandles: KlineData[] = [];
      if (benchmarkSymbol !== 'NONE') {
        try {
          const rawBenchmark = await fetchStockKlines(benchmarkSymbol, timeframe, candleCount);
          benchmarkCandles = stripFormingCandle(rawBenchmark, timeframe);
        } catch (e) {
          console.warn('Failed to fetch benchmark candles for', benchmarkSymbol, e);
        }
      }

      const rawCandles = await fetchStockKlines(symbol, timeframe, candleCount);
      const closedCandles = stripFormingCandle(rawCandles, timeframe);
      if (closedCandles.length < 30) {
        alert(`มีแท่งเทียนปิดแล้ว ${closedCandles.length} แท่ง แต่ Backtest ต้องใช้อย่างน้อย 30 แท่ง`);
        return;
      }
      const backtestResult = runBacktestSimulation(closedCandles, {
        symbol,
        timeframe,
        initialCapital: numInitialCapital,
        stopLossPct: numStopLossPct,
        takeProfitPct: numTakeProfitPct,
        benchmarkName: benchmarkSymbol,
        directionMode: 'LONG_ONLY',
        buyZone,
        feePercent: Number(feePercent) || 0,
        otherFeePercent: Number(otherFeePercent) || 0,
        slippagePercent: Number(slippagePercent) || 0,
        minNotionalThb: Number(minNotionalThb) || 0,
        benchmarkCandles,
      });

      if (!backtestResult) {
        alert('ข้อมูลแท่งเทียนไม่เพียงพอสำหรับการทำ Backtest');
        return;
      }

      setResult(backtestResult);
    } catch (err) {
      console.error('Backtest calculation error:', err);
      alert(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดขณะรัน Backtest');
    } finally {
      setIsLoading(false);
    }
  };

  const getMarketUniverseList = (universe: MarketUniverse): string[] => {
    switch (universe) {
      case 'SET50':
        return SET50_STOCKS;
      case 'SET100':
        return SET100_STOCKS;
      case 'SSET':
        return SSET_STOCKS;
      case 'MAI':
        return MAI_STOCKS;
      case 'WATCHLIST': {
        const wl = getStoredWatchlist();
        return wl.length > 0 ? wl : POPULAR_STOCKS;
      }
      case 'ALL_MARKET':
      default:
        return ALL_MARKET_STOCKS;
    }
  };

  const runMarketBacktest = async () => {
    const universe = getMarketUniverseList(marketUniverse);
    if (universe.length === 0) return;

    setIsMarketLoading(true);
    setMarketProgress(0);
    setMarketTotal(universe.length);
    setMarketResults([]);

    const results: BacktestResult[] = [];
    let firstDataError: string | null = null;
    let completed = 0;

    try {
      let benchmarkCandles: KlineData[] = [];
      if (benchmarkSymbol !== 'NONE') {
        try {
          const rawBenchmark = await fetchStockKlines(benchmarkSymbol, timeframe, candleCount);
          benchmarkCandles = stripFormingCandle(rawBenchmark, timeframe);
        } catch (e) {
          console.warn('Failed to fetch benchmark candles for', benchmarkSymbol, e);
        }
      }

      // Parallel batching (chunks of 4) to match the scanner's rate profile
      const chunkSize = 4;
      for (let i = 0; i < universe.length; i += chunkSize) {
        const chunk = universe.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(
          chunk.map(async (sym) => {
            try {
              const rawCandles: KlineData[] = await fetchStockKlines(sym, timeframe, candleCount);
              const closedCandles = stripFormingCandle(rawCandles, timeframe);
              if (closedCandles.length < 30) {
                if (!firstDataError) {
                  firstDataError = closedCandles.length === 0
                    ? `ไม่พบแท่งเทียนของ ${sym}; ตรวจ DASHBOARD_TOKEN และแหล่งข้อมูลหุ้นบน Host`
                    : `${sym} มีเพียง ${closedCandles.length} แท่ง ซึ่งน้อยกว่าขั้นต่ำ 30 แท่ง`;
                }
                return null;
              }
              return runBacktestSimulation(closedCandles, {
                symbol: sym,
                timeframe,
                initialCapital: numInitialCapital,
                stopLossPct: numStopLossPct,
                takeProfitPct: numTakeProfitPct,
                benchmarkName: benchmarkSymbol,
                directionMode: 'LONG_ONLY',
                buyZone,
                feePercent: Number(feePercent) || 0,
                otherFeePercent: Number(otherFeePercent) || 0,
                slippagePercent: Number(slippagePercent) || 0,
                minNotionalThb: Number(minNotionalThb) || 0,
                benchmarkCandles,
              });
            } catch (err) {
              console.error(`Backtest failed for ${sym}:`, err);
              if (!firstDataError && err instanceof Error) firstDataError = err.message;
              return null;
            }
          })
        );

        chunkResults.forEach((r) => {
          if (r) results.push(r);
        });

        completed += chunk.length;
        setMarketProgress(completed);
      }

      setMarketResults(results);
      if (results.length === 0 && firstDataError) {
        alert(`ไม่สามารถดึงข้อมูลหุ้นมาทำ Backtest ได้: ${firstDataError}`);
      }
    } catch (err) {
      console.error('Market backtest error:', err);
      alert(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดขณะรัน Backtest ทั้งตลาด');
    } finally {
      setIsMarketLoading(false);
    }
  };

  const handleMarketSort = (key: 'totalReturnPercent' | 'winRatePercent' | 'profitFactor' | 'totalTrades') => {
    if (marketSortKey === key) {
      setMarketSortAsc((prev) => !prev);
    } else {
      setMarketSortKey(key);
      setMarketSortAsc(false);
    }
  };

  const sortedMarketResults = useMemo(() => {
    return [...marketResults].sort((a, b) => {
      const aValue = a[marketSortKey];
      const bValue = b[marketSortKey];
      if (aValue === null) return bValue === null ? 0 : 1;
      if (bValue === null) return -1;
      const diff = Number(aValue) - Number(bValue);
      return marketSortAsc ? diff : -diff;
    });
  }, [marketResults, marketSortKey, marketSortAsc]);

  const marketSummary = useMemo(() => {
    const total = marketResults.length;
    const profitable = marketResults.filter((r) => r.totalReturnPercent > 0).length;
    const avgReturn = total > 0 ? marketResults.reduce((acc, r) => acc + r.totalReturnPercent, 0) / total : 0;
    const totalTrades = marketResults.reduce((acc, r) => acc + r.totalTrades, 0);
    const totalWins = marketResults.reduce((acc, r) => acc + r.winningTrades, 0);
    const avgWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
    const profitPercent = total > 0 ? (profitable / total) * 100 : 0;
    const best =
      marketResults.length > 0
        ? marketResults.reduce((a, b) => (b.totalReturnPercent > a.totalReturnPercent ? b : a))
        : null;
    const worst =
      marketResults.length > 0
        ? marketResults.reduce((a, b) => (b.totalReturnPercent < a.totalReturnPercent ? b : a))
        : null;

    return { total, profitable, avgReturn, totalTrades, totalWins, avgWinRate, profitPercent, best, worst };
  }, [marketResults]);

  return (
    <div className="space-y-6">
      {/* Backtest Config Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white">ตั้งค่าการทดสอบย้อนหลัง (CDC Strategy Backtest)</h3>
          </div>
          <span className="text-xs text-slate-400">ทดสอบผลตอบแทนและวินัยการเทรดตาม CDC Action Zone</span>
        </div>

        {/* Mode Switcher */}
        <div className="flex bg-slate-950 p-1 rounded-2xl border border-slate-800 w-full sm:w-auto">
          <button
            onClick={() => setMode('SINGLE')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              mode === 'SINGLE' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            🔎 รายตัว (Single Stock)
          </button>
          <button
            onClick={() => setMode('ALL_MARKET')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              mode === 'ALL_MARKET'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            🌏 ทั้งตลาด (All Market)
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          {/* Symbol / Market Universe */}
          {mode === 'SINGLE' ? (
            <div>
              <label className="text-slate-300 font-medium block mb-1">สัญลักษณ์หุ้น (SET)</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:border-emerald-500"
              >
                {getStoredSymbols().map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="text-slate-300 font-medium block mb-1">กลุ่มหุ้นที่ต้องการ Backtest</label>
              <select
                value={marketUniverse}
                onChange={(e) => setMarketUniverse(e.target.value as MarketUniverse)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:border-emerald-500"
              >
                <option value="ALL_MARKET">🌏 ทุกหุ้นในตลาด (All Market)</option>
                <option value="SET50">SET50 (50 หุ้น)</option>
                <option value="SET100">SET100 (100 หุ้น)</option>
                <option value="SSET">sSET (หุ้นเล็ก)</option>
                <option value="MAI">mai (หุ้น mai)</option>
                <option value="WATCHLIST">Watchlist ของฉัน</option>
              </select>
            </div>
          )}

          {/* Timeframe */}
          <div>
            <label className="text-slate-300 font-medium block mb-1">ไทม์เฟรม (Timeframe)</label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as Timeframe)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:border-emerald-500"
            >
              <option value="15m">15m</option>
              <option value="30m">30m</option>
              <option value="45m">45m</option>
              <option value="1h">1H</option>
              <option value="4h">4H</option>
              <option value="1d">1D (แนะนำ)</option>
              <option value="1w">1W</option>
            </select>
          </div>

          {/* Candle Count */}
          <div>
            <label className="text-slate-300 font-medium block mb-1">จำนวนแท่งเทียนย้อนหลัง</label>
            <select
              value={candleCount}
              onChange={(e) => setCandleCount(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:border-emerald-500"
            >
              <option value={300}>300 แท่ง</option>
              <option value={500}>500 แท่ง</option>
              <option value={1000}>1000 แท่ง</option>
            </select>
          </div>

          {/* Initial Capital */}
          <div>
            <label className="text-slate-300 font-medium block mb-1">เงินทุนเริ่มต้น (THB)</label>
            <input
              type="number"
              value={initialCapital}
              onChange={(e) => setInitialCapital(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:border-emerald-500"
            />
          </div>

          {/* Stop Loss % */}
          <div>
            <label className="text-slate-300 font-medium block mb-1">Stop Loss %</label>
            <input
              type="number"
              value={stopLossPct}
              onChange={(e) => setStopLossPct(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:border-emerald-500"
            />
          </div>

          {/* Take Profit % */}
          <div>
            <label className="text-slate-300 font-medium block mb-1">Take Profit Target %</label>
            <input
              type="number"
              value={takeProfitPct}
              onChange={(e) => setTakeProfitPct(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:border-emerald-500"
            />
          </div>

          {/* Per-side execution assumptions */}
          <div>
            <label className="text-slate-300 font-medium block mb-1">ค่าคอมมิชชัน (% ต่อฝั่ง)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={feePercent}
              onChange={(e) => setFeePercent(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:border-emerald-500"
            />
            <span className="mt-1 block text-[10px] text-slate-500">คิด VAT 7% บนค่าบริการ/ค่าคอมฯ แยกให้อัตโนมัติ</span>
          </div>
          <div>
            <label className="text-slate-300 font-medium block mb-1">ค่าบริการอื่นที่เสีย VAT (% ต่อฝั่ง)</label>
            <input
              type="number"
              min="0"
              step="0.001"
              value={otherFeePercent}
              onChange={(e) => setOtherFeePercent(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="text-slate-300 font-medium block mb-1">มูลค่าคำสั่งขั้นต่ำ (฿)</label>
            <input
              type="number"
              min="0"
              step="100"
              value={minNotionalThb}
              onChange={(e) => setMinNotionalThb(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:border-emerald-500"
            />
            <span className="mt-1 block text-[10px] text-slate-500">0 = ไม่กำหนดเพิ่มจาก board lot</span>
          </div>
          <div>
            <label className="text-slate-300 font-medium block mb-1">Slippage (% ต่อฝั่ง)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={slippagePercent}
              onChange={(e) => setSlippagePercent(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:border-emerald-500"
            />
          </div>

          {/* Direction Mode (Locked for Spot) */}

          {/* Benchmark Selection */}
          <div>
            <label className="text-slate-300 font-medium block mb-1">Benchmark ตลาด (ดัชนีชี้วัด)</label>
            <select
              value={benchmarkSymbol}
              onChange={(e) => setBenchmarkSymbol(e.target.value as BenchmarkSymbol)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-amber-400 font-bold font-mono focus:border-amber-500"
            >
              <option value="^SET.BK">^SET.BK (SET Index - ดัชนีตลาดโดยตรง ⭐)</option>
              <option value="TDEX">TDEX (SET50 ETF - Proxy)</option>
              <option value="BSET100">BSET100 (SET100 ETF)</option>
              <option value="NONE">ไม่เปรียบเทียบ Benchmark</option>
            </select>
            <span className="mt-1 block text-[10px] text-slate-500">^SET.BK เป็นดัชนีราคา ไม่รวมปันผลแบบ TRI; TDEX/BSET100 เป็น ETF proxy</span>
          </div>

          {/* Buy Trigger Zone */}
          <div>
            <label className="text-slate-300 font-medium block mb-1">เงื่อนไขเข้าซื้อ Long</label>
            <select
              value={buyZone}
              onChange={(e) => setBuyZone(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:border-emerald-500"
            >
              <option value="GREEN">โซนเขียว (ค่าเริ่มต้น: เขียวซื้อ + Golden Cross สด ⭐)</option>
              <option value="BLUE">โซนฟ้า (สัญญาณเตือนก่อนเขียว — โหมดเชิงรุก)</option>
            </select>
          </div>

          {/* Start Backtest Button */}
          <div className="flex items-end">
            {mode === 'SINGLE' ? (
              <button
                onClick={runBacktest}
                disabled={isLoading}
                className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs shadow-lg transition flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>กำลังคำนวณ...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>เริ่มการทดสอบ Backtest</span>
                  </>
                )}
              </button>
            ) : (
              <div className="w-full space-y-2">
                <button
                  onClick={runMarketBacktest}
                  disabled={isMarketLoading}
                  className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs shadow-lg transition flex items-center justify-center space-x-2 disabled:opacity-50"
                >
                  {isMarketLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>กำลัง Backtest ทั้งตลาด...</span>
                    </>
                  ) : (
                    <>
                      <Layers className="w-4 h-4" />
                      <span>Backtest ทุกหุ้นในตลาด</span>
                    </>
                  )}
                </button>
                {isMarketLoading && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                      <span>
                        กำลังประมวลผล {marketProgress}/{marketTotal} หุ้น
                      </span>
                      <span>{marketTotal > 0 ? Math.round((marketProgress / marketTotal) * 100) : 0}%</span>
                    </div>
                    <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all"
                        style={{ width: `${marketTotal > 0 ? (marketProgress / marketTotal) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <p className="text-[10px] text-slate-500">
          จำลอง Long-only: สัญญาณแท่งปิดเข้าแท่งถัดไปที่ราคาเปิด, ตรวจ Stop/Target จาก OHLC (ถ้าแตะทั้งคู่ใช้ Stop ก่อน), ใช้ board lot 100 หุ้นเป็นค่าปริยายและ 50 หุ้นเมื่อข้อมูลย้อนหลัง 6 เดือนเข้าเงื่อนไข, รวม VAT 7% บนคอมมิชชัน/ค่าบริการ และคิด slippage ต่อฝั่งตามช่องด้านบน
        </p>
      </div>

      {/* All Market Results Section */}
      {mode === 'ALL_MARKET' && marketResults.length > 0 && (
        <div className="space-y-6">
          {/* Market Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">หุ้นที่ทดสอบสำเร็จ</span>
              <div className="text-lg font-extrabold font-mono text-white">{marketSummary.total}</div>
              <span className="text-[10px] text-slate-500 block">จาก {marketTotal} หุ้น</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">ผลตอบแทนเฉลี่ย</span>
              <div className={`text-lg font-extrabold font-mono ${marketSummary.avgReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {marketSummary.avgReturn >= 0 ? '+' : ''}{marketSummary.avgReturn.toFixed(2)}%
              </div>
              <span className="text-[10px] text-slate-500 block">ต่อหุ้น (ถัวเฉลี่ย)</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">หุ้นที่ทำกำไร</span>
              <div className="text-lg font-extrabold font-mono text-emerald-400">
                {marketSummary.profitable} / {marketSummary.total}
              </div>
              <span className="text-[10px] text-slate-500 block">{marketSummary.profitPercent.toFixed(1)}% ของทั้งหมด</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">Win Rate รวม</span>
              <div className="text-lg font-extrabold font-mono text-emerald-400">{marketSummary.avgWinRate.toFixed(2)}%</div>
              <span className="text-[10px] text-slate-500 block">{marketSummary.totalWins} ชนะ / {marketSummary.totalTrades} เทรด</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">หุ้นทำกำไรสูงสุด 🏆</span>
              {marketSummary.best ? (
                <>
                  <div className="text-lg font-extrabold font-mono text-emerald-400">{marketSummary.best.symbol}</div>
                  <span className="text-[10px] text-emerald-500 block font-mono">+{marketSummary.best.totalReturnPercent}%</span>
                </>
              ) : (
                <div className="text-lg font-extrabold font-mono text-slate-600">-</div>
              )}
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">หุ้นขาดทุนสูงสุด</span>
              {marketSummary.worst ? (
                <>
                  <div className="text-lg font-extrabold font-mono text-rose-400">{marketSummary.worst.symbol}</div>
                  <span className="text-[10px] text-rose-500 block font-mono">{marketSummary.worst.totalReturnPercent}%</span>
                </>
              ) : (
                <div className="text-lg font-extrabold font-mono text-slate-600">-</div>
              )}
            </div>
          </div>

          {/* Market Ranking Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                <span>ผล Backtest รายหุ้น (เรียงตามผลตอบแทน)</span>
              </h4>
              <span className="text-xs text-slate-400 font-mono">{marketResults.length} หุ้น</span>
            </div>
            <p className="text-[10px] text-slate-500">โหมดทั้งตลาดรันแยกทีละหุ้นและสรุปค่าเฉลี่ยต่อหุ้น ไม่ใช่พอร์ต equal-weight ที่ซื้อขายพร้อมกัน</p>
            <div className="overflow-x-auto max-h-[28rem] overflow-y-auto scrollbar-thin">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead className="sticky top-0 bg-slate-950">
                  <tr className="text-slate-400 border-b border-slate-800">
                    <th className="p-2.5">หุ้น</th>
                    <th
                      className="p-2.5 cursor-pointer select-none hover:text-white"
                      onClick={() => handleMarketSort('totalReturnPercent')}
                    >
                      กำไรสุทธิ (%) {marketSortKey === 'totalReturnPercent' ? (marketSortAsc ? '↑' : '↓') : ''}
                    </th>
                    <th
                      className="p-2.5 cursor-pointer select-none hover:text-white"
                      onClick={() => handleMarketSort('winRatePercent')}
                    >
                      Win Rate {marketSortKey === 'winRatePercent' ? (marketSortAsc ? '↑' : '↓') : ''}
                    </th>
                    <th
                      className="p-2.5 cursor-pointer select-none hover:text-white"
                      onClick={() => handleMarketSort('profitFactor')}
                    >
                      Profit Factor {marketSortKey === 'profitFactor' ? (marketSortAsc ? '↑' : '↓') : ''}
                    </th>
                    <th
                      className="p-2.5 cursor-pointer select-none hover:text-white"
                      onClick={() => handleMarketSort('totalTrades')}
                    >
                      เทรด {marketSortKey === 'totalTrades' ? (marketSortAsc ? '↑' : '↓') : ''}
                    </th>
                    <th className="p-2.5">Max DD</th>
                    <th className="p-2.5">เงินทุนสุดท้าย</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {sortedMarketResults.map((r) => (
                    <tr key={`mkt_${r.symbol}`} className="hover:bg-slate-800/40">
                      <td className="p-2.5 font-bold text-white">{r.symbol}</td>
                      <td className={`p-2.5 font-bold ${r.totalReturnPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {r.totalReturnPercent >= 0 ? '+' : ''}{r.totalReturnPercent}%
                      </td>
                      <td className="p-2.5">{r.winRatePercent}%</td>
                      <td className="p-2.5">{r.profitFactor === null ? '—' : r.profitFactor}</td>
                      <td className="p-2.5 text-slate-400">{r.totalTrades}</td>
                      <td className="p-2.5 text-rose-400">-{r.maxDrawdownPercent}%</td>
                      <td className="p-2.5 text-slate-400">฿{r.finalCapital.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Backtest Results Section */}
      {mode === 'SINGLE' && result && (
        <div className="space-y-6">
          {/* Performance Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            {/* Total Return Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">กำไรสุทธิ CDC Bot</span>
              <div
                className={`text-lg font-extrabold font-mono ${
                  result.totalReturnPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {result.totalReturnPercent >= 0 ? '+' : ''}
                {result.totalReturnPercent}%
              </div>
              <span className="text-[10px] text-slate-500 block font-mono">
                ฿{result.finalCapital.toLocaleString()} THB
              </span>
            </div>

            {/* Benchmark Return Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">Benchmark ({BENCHMARK_LABELS[result.benchmarkName as BenchmarkSymbol] ?? result.benchmarkName})</span>
              <div
                className={`text-lg font-extrabold font-mono ${
                  result.benchmarkReturnPercent !== null && result.benchmarkReturnPercent >= 0
                    ? 'text-amber-400'
                    : result.benchmarkReturnPercent !== null
                    ? 'text-rose-400'
                    : 'text-slate-500'
                }`}
              >
                {result.benchmarkReturnPercent !== null
                  ? `${result.benchmarkReturnPercent >= 0 ? '+' : ''}${result.benchmarkReturnPercent}%`
                  : '—'}
              </div>
              <span className="text-[10px] text-slate-500 block">
                {result.excessReturnPercent !== null
                  ? `Excess: ${result.excessReturnPercent >= 0 ? '+' : ''}${result.excessReturnPercent}%`
                  : result.benchmarkName === 'NONE' ? 'ปิด benchmark' : 'ข้อมูล benchmark ไม่ครบ/ไม่พบ'}
              </span>
            </div>

            {/* Buy & Hold Stock Return */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">Buy &amp; Hold ({result.symbol})</span>
              <div
                className={`text-lg font-extrabold font-mono ${
                  result.buyAndHoldReturnPercent >= 0 ? 'text-cyan-400' : 'text-rose-400'
                }`}
              >
                {result.buyAndHoldReturnPercent >= 0 ? '+' : ''}
                {result.buyAndHoldReturnPercent}%
              </div>
              <span className="text-[10px] text-slate-500 block">ซื้อและถือราคาปิด</span>
            </div>

            {/* Win Rate */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">อัตราชนะ (Win Rate)</span>
              <div className="text-lg font-extrabold font-mono text-emerald-400">
                {result.winRatePercent}%
              </div>
              <span className="text-[10px] text-slate-500 block">
                ชนะ {result.winningTrades} / แพ้ {result.losingTrades} / เสมอ {result.breakevenTrades}
              </span>
            </div>

            {/* Total Trades */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">จำนวนเทรดทั้งหมด</span>
              <div className="text-lg font-extrabold font-mono text-white">
                {result.totalTrades} ครั้ง
              </div>
              <span className="text-[10px] text-slate-500 block">รอบสัญญาณ</span>
            </div>

            {/* Max Drawdown */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">Max Drawdown</span>
              <div className="text-lg font-extrabold font-mono text-rose-400">
                -{result.maxDrawdownPercent}%
              </div>
              <span className="text-[10px] text-slate-500 block">ความย่อสูงสุด</span>
              <p className="text-[10px] text-slate-500">ความเสี่ยงย่อตัวสูงสุด</p>
            </div>

            {/* Profit Factor */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-1 shadow-md">
              <span className="text-slate-400 block text-[11px]">Profit Factor</span>
              <div className="text-lg font-bold text-purple-400 font-mono">
                {result.profitFactor === null ? '—' : result.profitFactor}
              </div>
              <p className="text-[10px] text-slate-500">อัตราส่วนกำไรต่อขาดทุน</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { label: 'ผลตอบแทนทบต้นต่อปี', value: result.annualizedReturnPercent === null ? '—' : `${result.annualizedReturnPercent}%` },
              { label: 'Sharpe', value: result.sharpeRatio === null ? '—' : result.sharpeRatio.toFixed(3) },
              { label: 'Sortino', value: result.sortinoRatio === null ? '—' : result.sortinoRatio.toFixed(3) },
              { label: 'Calmar', value: result.calmarRatio === null ? '—' : result.calmarRatio.toFixed(3) },
              { label: 'Information Ratio', value: result.informationRatio === null ? 'ไม่มี benchmark' : result.informationRatio.toFixed(3) },
              { label: 'Excess Return', value: result.excessReturnPercent === null ? 'ไม่มี benchmark' : `${result.excessReturnPercent > 0 ? '+' : ''}${result.excessReturnPercent}%` },
              { label: 'Expectancy / trade', value: `฿${result.expectancyThb.toLocaleString()}` },
              { label: 'Expectancy (R)', value: result.expectancyR === null ? '—' : `${result.expectancyR}R` },
              { label: 'กำไรพึ่งพาไม้ใหญ่สุด', value: result.maxSingleWinContributionPercent === null ? '—' : `${result.maxSingleWinContributionPercent}%` },
              { label: 'Turnover / Avg Equity', value: `${result.turnoverPercent}%` },
              { label: 'คำสั่งสูงสุด / ADV20', value: result.maxOrderToAdvPercent === null ? 'ข้อมูลไม่พอ' : `${result.maxOrderToAdvPercent}%` },
              { label: 'ค่าคอมฯ + VAT', value: `฿${result.totalCommissionThb.toLocaleString()} + ฿${result.totalVatThb.toLocaleString()}` },
              { label: 'ค่าบริการอื่น / ค่าธรรมเนียมรวม', value: `฿${result.totalOtherFeesThb.toLocaleString()} / ฿${result.totalFeesThb.toLocaleString()}` },
              { label: 'มูลค่าซื้อขายเฉลี่ย/วัน', value: `฿${result.averageDailyTurnoverThb.toLocaleString()}` },
              { label: 'MC โอกาสขาดทุน', value: result.monteCarlo ? `${result.monteCarlo.probabilityOfLossPercent}%` : 'ข้อมูลไม่พอ' },
              { label: 'MC ผลตอบแทน P5', value: result.monteCarlo ? `${result.monteCarlo.fifthPercentileReturnPercent}%` : 'ข้อมูลไม่พอ' },
              { label: 'MC Max DD P95', value: result.monteCarlo ? `${result.monteCarlo.ninetyFifthPercentileMaxDrawdownPercent}%` : 'ข้อมูลไม่พอ' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-900 border border-slate-800 rounded-2xl p-3 shadow-lg">
                <span className="text-[10px] text-slate-500 block">{label}</span>
                <span className="mt-1 text-sm font-bold font-mono text-slate-200 break-words">{value}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-500">
            Sharpe/Sortino แสดงเฉพาะกราฟ 1D/1W โดยสมมติ risk-free 0%; benchmark และ Information Ratio ต้องส่งข้อมูล benchmark ที่ตรงวัน (แนะนำ SET TRI เพื่อรวมปันผล). Buy &amp; Hold ด้านบนคิดจากราคาปิดอย่างเดียว. ADV20 เป็นตัวแทนสภาพคล่องย้อนหลัง ไม่ใช่ market-impact/capacity model. Monte Carlo เป็น bootstrap ผลตอบแทนต่อไม้แบบสุ่มซ้ำ ไม่รักษาลำดับเวลา/การเกาะกลุ่มของการเทรด จึงเป็นเพียง stress diagnostic.
          </p>

          {/* Equity Chart */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                <BarChart2 className="w-4 h-4 text-emerald-400" />
                <span>กราฟเปรียบเทียบพอร์ต vs Benchmark (Portfolio Equity vs Benchmark)</span>
              </h4>
              <div className="flex items-center space-x-3 text-xs font-mono">
                <span className="text-slate-400">
                  พอร์ตบอท: <strong className="text-emerald-400">฿{result.finalCapital.toLocaleString()}</strong>
                </span>
                {result.excessReturnPercent !== null && (
                  <span className={`px-2 py-0.5 rounded font-bold ${
                    result.excessReturnPercent >= 0 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400 border border-rose-800'
                  }`}>
                    Excess: {result.excessReturnPercent >= 0 ? '+' : ''}{result.excessReturnPercent}%
                  </span>
                )}
              </div>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={result.equityCurve}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="dateStr" stroke="#64748b" tick={{ fontSize: 10 }} />
                  <YAxis
                    stroke="#64748b"
                    tick={{ fontSize: 10 }}
                    domain={['auto', 'auto']}
                    tickFormatter={(v) => `฿${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(val: any, name: any) => [`฿${Number(val).toLocaleString()} THB`, name]}
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                  <Line
                    type="monotone"
                    dataKey="equity"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={false}
                    name={`พอร์ต CDC Bot (${result.totalReturnPercent >= 0 ? '+' : ''}${result.totalReturnPercent}%)`}
                  />
                  {result.equityCurve.some((p) => p.benchmarkEquity !== undefined) && (
                  <Line
                    type="monotone"
                    dataKey="benchmarkEquity"
                      stroke="#f59e0b"
                      strokeWidth={1.75}
                      strokeDasharray="4 4"
                      dot={false}
                    name={`Benchmark ตลาด (${BENCHMARK_LABELS[result.benchmarkName as BenchmarkSymbol] ?? result.benchmarkName}) (${result.benchmarkReturnPercent === null ? 'N/A' : `${result.benchmarkReturnPercent >= 0 ? '+' : ''}${result.benchmarkReturnPercent}%`})`}
                  />
                  )}
                  <Line
                    type="monotone"
                    dataKey="stockBuyAndHoldEquity"
                    stroke="#818cf8"
                    strokeWidth={1.25}
                    strokeDasharray="2 2"
                    dot={false}
                    name={`ซื้อและถือ ${result.symbol} (${result.buyAndHoldReturnPercent >= 0 ? '+' : ''}${result.buyAndHoldReturnPercent}%)`}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Backtest Trades Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
            <h4 className="text-sm font-bold text-white">รายละเอียดออเดอร์ Backtest ทุกรอบ ({result.trades.length} รอบ)</h4>
            <div className="overflow-x-auto max-h-80 overflow-y-auto scrollbar-thin">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <th className="p-2.5">#</th>
                    <th className="p-2.5">ฝั่ง</th>
                    <th className="p-2.5">วันที่เปิด</th>
                    <th className="p-2.5">วันที่ปิด</th>
                    <th className="p-2.5">ราคาเข้า</th>
                    <th className="p-2.5">ราคาออก</th>
                    <th className="p-2.5">กำไร/ขาดทุน (฿)</th>
                    <th className="p-2.5">กำไร (%)</th>
                    <th className="p-2.5">เหตุผลการออก</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {result.trades.map((t, idx) => (
                    <tr key={`bt_trade_${t.id}_${idx}`} className="hover:bg-slate-800/40">
                      <td className="p-2.5 font-bold text-slate-400">{t.id}</td>
                      <td className="p-2.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            t.side === 'BUY'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                          }`}
                        >
                          {t.side === 'BUY' ? 'LONG' : 'SHORT'}
                        </span>
                      </td>
                      <td className="p-2.5">{new Date(t.entryTime).toLocaleDateString('th-TH')}</td>
                      <td className="p-2.5">{new Date(t.exitTime).toLocaleDateString('th-TH')}</td>
                      <td className="p-2.5">{formatStockPrice(t.entryPrice)}</td>
                      <td className="p-2.5">{formatStockPrice(t.exitPrice)}</td>
                      <td
                        className={`p-2.5 font-bold ${
                          t.pnlUsdt >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {t.pnlUsdt >= 0 ? '+' : ''}฿{t.pnlUsdt}
                      </td>
                      <td
                        className={`p-2.5 font-bold ${
                          t.pnlPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {t.pnlPercent >= 0 ? '+' : ''}{t.pnlPercent}%
                      </td>
                      <td className="p-2.5 font-sans text-slate-400">{t.exitReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
