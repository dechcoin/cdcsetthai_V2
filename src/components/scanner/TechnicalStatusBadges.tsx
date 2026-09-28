import React from 'react';

interface TechnicalStatusBadgesProps {
  isBullish?: boolean;
  isBreakout?: boolean;
  isDivergence?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}

export const TechnicalStatusBadges: React.FC<TechnicalStatusBadgesProps> = ({
  isBullish,
  isBreakout,
  isDivergence,
  className = '',
  size = 'md',
}) => {
  if (!isBullish && !isBreakout && !isDivergence) return null;

  const isSmall = size === 'sm';
  const padClass = isSmall ? 'px-1.5 py-0.5 text-[9px]' : 'px-2.5 py-0.5 text-[10px] sm:text-[11px]';
  const iconSize = isSmall ? 'text-[10px]' : 'text-xs';

  return (
    <div className={`flex flex-wrap gap-1.5 items-center ${className}`}>
      {isBullish && (
        <span
          className={`inline-flex items-center space-x-1.5 rounded-lg font-black uppercase tracking-wider bg-[#022c22]/90 border border-emerald-500/50 text-emerald-400 shadow-sm transition hover:border-emerald-400 ${padClass}`}
          title="แนวโน้มขาขึ้น (Bullish Trend / CDC Green-Blue Zone)"
        >
          <span className={iconSize}>📈</span>
          <span>BULLISH</span>
        </span>
      )}
      {isBreakout && (
        <span
          className={`inline-flex items-center space-x-1.5 rounded-lg font-black uppercase tracking-wider bg-[#082f49]/90 border border-cyan-500/50 text-cyan-400 shadow-sm transition hover:border-cyan-400 ${padClass}`}
          title="ราคาทะลุกรอบต้าน 20 วัน (20-Period High Breakout Setup)"
        >
          <span className={iconSize}>⚡</span>
          <span>BREAKOUT</span>
        </span>
      )}
      {isDivergence && (
        <span
          className={`inline-flex items-center space-x-1.5 rounded-lg font-black uppercase tracking-wider bg-[#2e1065]/90 border border-purple-500/50 text-purple-300 shadow-sm transition hover:border-purple-400 ${padClass}`}
          title="สัญญาณขัดแย้งเชิงบวก (Bullish RSI Divergence: ราคาทำจุดต่ำแต่ RSI ยกสูงขึ้น)"
        >
          <span className={iconSize}>✨</span>
          <span>DIVERGENCE</span>
        </span>
      )}
    </div>
  );
};
