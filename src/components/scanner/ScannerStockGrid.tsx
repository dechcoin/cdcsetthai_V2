import React from 'react';
import type { ScannerStockResult, Timeframe } from '../../types';
import { formatStockPrice } from '../../lib/stockApi';
import { getZoneColorHex, getZoneNameTh } from '../../lib/cdcIndicator';
import { getQualityScoreTheme } from '../../lib/scannerEngine';
import { ArrowDownRight, ArrowUpRight, Award, Info, Sparkles, Star, TrendingUp, Zap } from 'lucide-react';

interface ScannerStockGridProps {
  stocks: ScannerStockResult[];
  timeframe: Timeframe;
  /** When true and the list is empty we do not show the "no results" state. */
  isScanning: boolean;
  onToggleWatchlist: (e: React.MouseEvent, symbol: string) => void;
  onSelect: (symbol: string) => void;
  onShowBreakdown: (stock: ScannerStockResult) => void;
}

/**
 * Card ("grid") layout of the scanner results.
 * Each card renders the CDC zone badge, the 0–100 quality score meter and a
 * price / EMA-spread summary.
 */
export const ScannerStockGrid: React.FC<ScannerStockGridProps> = ({
  stocks,
  timeframe,
  isScanning,
  onToggleWatchlist,
  onSelect,
  onShowBreakdown,
}) => {
  if (stocks.length === 0 && !isScanning) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <div className="col-span-full bg-slate-900 border border-slate-800 rounded-3xl p-14 text-center text-slate-400 space-y-3 shadow-xl">
          <TrendingUp className="w-10 h-10 mx-auto text-slate-600" />
          <p className="text-sm font-bold text-slate-300">ไม่พบหุ้นที่ตรงกับเงื่อนไขการกรอง</p>
          <p className="text-xs text-slate-500">
            ลองคลิกเลือกแถบป้ายกรองสัญญาณอื่น หรือเปลี่ยนคำค้นหา
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {stocks.map((stock) => {
        const theme = getQualityScoreTheme(stock.qualityScore);

        return (
          <div
            key={stock.symbol}
            className="bg-slate-900/90 border border-slate-800/90 hover:border-slate-700 hover:shadow-2xl rounded-3xl p-4.5 flex flex-col justify-between space-y-3.5 transition group relative"
          >
            {/* Top Bar: Symbol, Watchlist Star, and CDC Zone Badge */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => onToggleWatchlist(e, stock.symbol)}
                  className={`p-1 rounded-lg transition cursor-pointer ${
                    stock.isWatchlist
                      ? 'text-amber-400 hover:text-amber-300'
                      : 'text-slate-600 hover:text-slate-400'
                  }`}
                  title={stock.isWatchlist ? 'ถอดออกจาก Watchlist' : 'เพิ่มใน Watchlist'}
                >
                  <Star className={`w-4 h-4 ${stock.isWatchlist ? 'fill-amber-400' : ''}`} />
                </button>
                <span className="font-black text-white text-base font-mono tracking-tight">
                  {stock.symbol}
                </span>
                <span className="text-[10px] text-slate-400 font-semibold">
                  {timeframe.toUpperCase()}
                </span>
              </div>

              <span
                className="text-[11px] px-2.5 py-0.5 rounded-full font-bold text-slate-950 shadow"
                style={{ backgroundColor: getZoneColorHex(stock.zone) }}
              >
                {getZoneNameTh(stock.zone)}
              </span>
            </div>

            {/* CDC QUALITY SCORE CARD METER */}
            <div
              onClick={() => onShowBreakdown(stock)}
              className={`rounded-2xl p-2.5 border transition cursor-pointer hover:scale-[1.01] ${theme.bg}`}
              title="คลิกเพื่อดูรายละเอียดการวิเคราะห์ 5 ปัจจัย"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center space-x-1.5">
                  <Award className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold">CDC Quality Score</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className={`text-[10px] px-2 py-0.2 rounded-md ${theme.badge}`}>
                    Grade {stock.qualityGrade}
                  </span>
                  <span className="text-xs font-black font-mono">
                    {stock.qualityScore}/100
                  </span>
                </div>
              </div>

              {/* Progress Score Bar */}
              <div className="w-full h-2 bg-slate-950/80 rounded-full overflow-hidden shadow-inner">
                <div
                  className={`h-full bg-gradient-to-r ${theme.bar} transition-all duration-500 rounded-full`}
                  style={{ width: `${stock.qualityScore}%` }}
                />
              </div>

              {/* Sub info: Entry Timing Badge & Golden Cross Info */}
              <div className="flex items-center justify-between text-[10px] text-slate-300 mt-2 pt-1 border-t border-slate-800/40">
                <span className="font-semibold">{stock.entryTimingLabel}</span>
                {stock.barsSinceGoldenCross <= 1 && (stock.zone === 'BLUE' || stock.zone === 'GREEN') ? (
                  <span className="text-emerald-300 font-extrabold flex items-center bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-500/40 shadow-sm animate-pulse">
                    <Sparkles className="w-3 h-3 mr-0.5" /> จุดเข้าแรก!
                  </span>
                ) : (
                  <span className="text-slate-500 font-mono">GC: {stock.barsSinceGoldenCross} แท่ง</span>
                )}
              </div>
            </div>

            {/* Price & 24h Change */}
            <div className="flex items-baseline justify-between font-mono bg-slate-950/50 p-2 rounded-xl border border-slate-800/60">
              <div>
                <span className="text-[10px] text-slate-500 block">ราคาล่าสุด</span>
                <span className="text-base font-bold text-white">
                  {formatStockPrice(stock.currentPrice)}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-500 block">24h Change</span>
                <span
                  className={`text-xs font-bold flex items-center justify-end ${
                    stock.priceChange24h >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {stock.priceChange24h >= 0 ? (
                    <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />
                  ) : (
                    <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />
                  )}
                  {stock.priceChange24h >= 0 ? '+' : ''}
                  {stock.priceChange24h.toFixed(2)}%
                </span>
              </div>
            </div>

            {/* EMA Spread & 24h Volume */}
            <div className="bg-slate-950 rounded-xl p-2 border border-slate-800/80 text-[11px] font-mono grid grid-cols-2 gap-2">
              <div>
                <span className="text-slate-500 block text-[9px]">EMA Spread</span>
                <span
                  className={stock.trendStrength >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                >
                  {stock.trendStrength >= 0 ? '+' : ''}
                  {stock.trendStrength.toFixed(2)}%
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[9px]">วอลุ่ม 24 ชม.</span>
                <span className="text-slate-300">
                  ฿{(stock.volume24h / 1_000_000).toFixed(1)}M
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center space-x-2 pt-1">
              <button
                onClick={() => onSelect(stock.symbol)}
                className="flex-1 py-2 bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-slate-950 rounded-xl text-xs font-black transition flex items-center justify-center space-x-1.5 shadow cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>เปิดดูกราฟ & เทรด</span>
              </button>
              <button
                onClick={() => onShowBreakdown(stock)}
                className="p-2 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 rounded-xl transition cursor-pointer"
                title="วิเคราะห์ 5 ปัจจัย"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
