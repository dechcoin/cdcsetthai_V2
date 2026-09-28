import React from 'react';
import type { ScannerStockResult } from '../../types';
import { TechnicalStatusBadges } from './TechnicalStatusBadges';
import { Award, X, Zap } from 'lucide-react';

interface StockQualityBreakdownModalProps {
  stock: ScannerStockResult;
  onClose: () => void;
  onOpenChart: (symbol: string) => void;
}

/**
 * Modal explaining the 0–100 CDC quality score for one symbol.
 *
 * The five factors all share the same shape (`QualityFactorDetail`), so they are
 * rendered from an array instead of five near-identical JSX blocks.
 */
export const StockQualityBreakdownModal: React.FC<StockQualityBreakdownModalProps> = ({
  stock,
  onClose,
  onOpenChart,
}) => {
  const { qualityBreakdown: bd } = stock;

  const factors = [
    { title: 'Recency & Golden Cross Timing', detail: bd.recency },
    { title: 'CDC Action Zone', detail: bd.zone },
    { title: 'Trend Strength (EMA Spread)', detail: bd.trendStrength },
    { title: '24h Volume', detail: bd.volume24h },
    { title: 'Price Change', detail: bd.priceChange },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-black text-white font-mono">
                  {stock.symbol}
                </h3>
                <span className="text-xs text-slate-400">วิเคราะห์ 5 ปัจจัย (ทฤษฎีเขียวซื้อ แดงขาย)</span>
              </div>
              <p className="text-xs text-emerald-400 font-bold">
                {bd.gradeLabel}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Total Score Meter Card */}
        <div className="bg-slate-950 rounded-2xl p-4 border border-slate-800/90 text-center space-y-2">
          <span className="text-xs text-slate-400 font-bold">คะแนนคุณภาพจุดเข้าซื้อ (Total Quality Score)</span>
          <div className="text-4xl font-black font-mono text-white">
            {stock.qualityScore}{' '}
            <span className="text-lg text-slate-500">/ 100</span>
          </div>
          <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 rounded-full"
              style={{ width: `${stock.qualityScore}%` }}
            />
          </div>
        </div>

        {/* Technical Status Badges */}
        {(stock.isBullish || stock.isBreakout || stock.isDivergence) && (
          <div className="flex items-center justify-between bg-slate-950/60 p-3 rounded-xl border border-slate-800/70">
            <span className="text-xs text-slate-400 font-bold">สถานะสัญญาณพิเศษ:</span>
            <TechnicalStatusBadges
              isBullish={stock.isBullish}
              isBreakout={stock.isBreakout}
              isDivergence={stock.isDivergence}
            />
          </div>
        )}

        {/* 5 Factors Breakdown List */}
        <div className="space-y-3 text-xs">
          {factors.map((factor, index) => (
            <div
              key={factor.title}
              className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/70 space-y-1"
            >
              <div className="flex justify-between font-bold">
                <span className="text-slate-300">
                  {index + 1}. {factor.detail.label}
                </span>
                <span className="text-emerald-400 font-mono">
                  {factor.detail.score} / {factor.detail.maxScore}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">{factor.detail.detail}</p>
            </div>
          ))}
        </div>

        {/* Modal Actions */}
        <div className="flex items-center space-x-2 pt-2">
          <button
            onClick={() => onOpenChart(stock.symbol)}
            className="flex-1 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black rounded-xl text-xs transition shadow-lg flex items-center justify-center space-x-1.5 cursor-pointer"
          >
            <Zap className="w-4 h-4" />
            <span>เปิดดูกราฟ {stock.symbol}</span>
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs transition cursor-pointer"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
};