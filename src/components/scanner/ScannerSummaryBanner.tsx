import React from 'react';
import { Activity, Award, Sparkles } from 'lucide-react';
import type { ScannerSummaryMetrics } from '../../lib/scannerEngine';

interface ScannerSummaryBannerProps {
  metrics: ScannerSummaryMetrics;
}

/**
 * Aggregate metrics banner shown under the scan-scope selector:
 * scanned count, prime entries, high-quality count and market average score.
 */
export const ScannerSummaryBanner: React.FC<ScannerSummaryBannerProps> = ({ metrics }) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950/80 border border-slate-800/90 rounded-2xl p-4">
      <div className="space-y-0.5">
        <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
          สแกนทั้งหมด
        </span>
        <div className="flex items-baseline space-x-1">
          <span className="text-xl font-black text-white font-mono">{metrics.total}</span>
          <span className="text-[11px] text-slate-500">หุ้น</span>
        </div>
      </div>

      <div className="space-y-0.5">
        <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider flex items-center">
          <Sparkles className="w-3 h-3 mr-1 text-emerald-300" /> เขียวซื้อ + Golden Cross สด (≤2 แท่ง)
        </span>
        <div className="flex items-baseline space-x-1">
          <span className="text-xl font-black text-emerald-400 font-mono">
            {metrics.primeEntries}
          </span>
          <span className="text-[11px] text-emerald-500/70">
          (โซนเขียว {metrics.buySignals})
          </span>
        </div>
      </div>

      <div className="space-y-0.5">
        <span className="text-[10px] text-cyan-400 font-semibold uppercase tracking-wider flex items-center">
          <Award className="w-3 h-3 mr-1" /> คุณภาพสูง (Score ≥70)
        </span>
        <div className="flex items-baseline space-x-1">
          <span className="text-xl font-black text-cyan-400 font-mono">
            {metrics.topQuality}
          </span>
          <span className="text-[11px] text-cyan-500/70">ตัว (Grade S/A)</span>
        </div>
      </div>

      <div className="space-y-0.5">
        <span className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider flex items-center">
          <Activity className="w-3 h-3 mr-1" /> คะแนนเฉลี่ยตลาด
        </span>
        <div className="flex items-baseline space-x-1">
          <span className="text-xl font-black text-amber-400 font-mono">
            {metrics.avgScore}
          </span>
          <span className="text-[11px] text-amber-500/70">/ 100 คะแนน</span>
        </div>
      </div>
    </div>
  );
};
