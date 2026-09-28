import React from 'react';
import type { ScannerStockResult } from '../../types';
import { formatStockPrice } from '../../lib/stockApi';
import { getZoneColorHex, getZoneNameTh } from '../../lib/cdcIndicator';
import { getQualityScoreTheme } from '../../lib/scannerEngine';
import { TechnicalStatusBadges } from './TechnicalStatusBadges';
import { Star } from 'lucide-react';

interface ScannerStockTableProps {
  stocks: ScannerStockResult[];
  onToggleWatchlist: (e: React.MouseEvent, symbol: string) => void;
  onSelect: (symbol: string) => void;
  onShowBreakdown: (stock: ScannerStockResult) => void;
}

/**
 * Dense table layout of the scanner results — the same data as
 * `ScannerStockGrid` but optimised for comparing many symbols at once.
 * Clicking anywhere on a row selects the symbol.
 */
export const ScannerStockTable: React.FC<ScannerStockTableProps> = ({
  stocks,
  onToggleWatchlist,
  onSelect,
  onShowBreakdown,
}) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase text-[10px] tracking-wider">
            <tr>
              <th className="py-3 px-4">Watch</th>
              <th className="py-3 px-4">ชื่อหุ้น</th>
              <th className="py-3 px-4">ราคาล่าสุด</th>
              <th className="py-3 px-4">24h Change</th>
              <th className="py-3 px-4">CDC Action Zone</th>
              <th className="py-3 px-4">CDC Quality Score</th>
              <th className="py-3 px-4">ความสดใหม่</th>
              <th className="py-3 px-4">EMA Spread</th>
              <th className="py-3 px-4">วอลุ่ม 24h</th>
              <th className="py-3 px-4 text-right">การกระทำ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {stocks.map((stock) => {
              const theme = getQualityScoreTheme(stock.qualityScore);

              return (
                <tr
                  key={stock.symbol}
                  className="hover:bg-slate-800/40 transition cursor-pointer"
                  onClick={() => onSelect(stock.symbol)}
                >
                  {/* Watchlist Star */}
                  <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => onToggleWatchlist(e, stock.symbol)}
                      className={stock.isWatchlist ? 'text-amber-400 cursor-pointer' : 'text-slate-600 hover:text-slate-400 cursor-pointer'}
                    >
                      <Star className={`w-4 h-4 ${stock.isWatchlist ? 'fill-amber-400' : ''}`} />
                    </button>
                  </td>

                  {/* Symbol & Technical Badges */}
                  <td className="py-3 px-4 font-black text-white text-sm">
                    <div className="flex flex-col space-y-1">
                      <span>{stock.symbol}</span>
                      <TechnicalStatusBadges
                        isBullish={stock.isBullish}
                        isBreakout={stock.isBreakout}
                        isDivergence={stock.isDivergence}
                        size="sm"
                      />
                    </div>
                  </td>

                  {/* Price */}
                  <td className="py-3 px-4 text-white font-bold">
                    {formatStockPrice(stock.currentPrice)}
                  </td>

                  {/* 24h Change */}
                  <td
                    className={`py-3 px-4 font-bold ${
                      stock.priceChange24h >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {stock.priceChange24h >= 0 ? '+' : ''}
                    {stock.priceChange24h.toFixed(2)}%
                  </td>

                  {/* Zone */}
                  <td className="py-3 px-4">
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full font-bold text-slate-950 shadow"
                      style={{ backgroundColor: getZoneColorHex(stock.zone) }}
                    >
                      {getZoneNameTh(stock.zone)}
                    </span>
                  </td>

                  {/* CDC Quality Score */}
                  <td className="py-3 px-4">
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        onShowBreakdown(stock);
                      }}
                      className="flex items-center space-x-2"
                    >
                      <span className={`text-[10px] px-2 py-0.2 rounded-md ${theme.badge}`}>
                        {stock.qualityGrade}
                      </span>
                      <span className="font-bold text-white">{stock.qualityScore}</span>
                      <div className="w-16 h-1.5 bg-slate-950 rounded-full overflow-hidden hidden sm:block">
                        <div
                          className={`h-full bg-gradient-to-r ${theme.bar}`}
                          style={{ width: `${stock.qualityScore}%` }}
                        />
                      </div>
                    </div>
                  </td>

                  {/* Recency & Entry Timing */}
                  <td className="py-3 px-4 text-slate-300">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-xs text-white">
                        {stock.entryTimingLabel}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        GC: {stock.barsSinceGoldenCross} แท่ง ({stock.barsSinceSignal} แท่งในโซน)
                      </div>
                    </div>
                  </td>

                  {/* EMA Spread */}
                  <td
                    className={`py-3 px-4 ${
                      stock.trendStrength >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {stock.trendStrength >= 0 ? '+' : ''}
                    {stock.trendStrength.toFixed(2)}%
                  </td>

                  {/* Volume */}
                  <td className="py-3 px-4 text-slate-400 font-mono">
                    ฿{(stock.volume24h / 1_000_000).toFixed(1)}M
                  </td>

                  {/* Action */}
                  <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => onSelect(stock.symbol)}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black rounded-lg text-xs transition cursor-pointer"
                    >
                      เปิดกราฟ
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};