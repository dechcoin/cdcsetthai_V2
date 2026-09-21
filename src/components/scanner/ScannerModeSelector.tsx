import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Crown, Globe, Layers, Sparkles, SlidersHorizontal, Star, Zap } from 'lucide-react';
import type { MarketScanMode } from './scanner.types';
import { ALL_MARKET_STOCKS, MAI_STOCKS, SET100_STOCKS, SET50_STOCKS, SSET_STOCKS } from '../../lib/stockApi';

interface ScannerModeSelectorProps {
  active: MarketScanMode;
  onChange: (mode: MarketScanMode) => void;
  /** Number of symbols currently in the user's watchlist. */
  watchlistCount: number;
  /** Number of symbols currently in the user's custom list. */
  customCount: number;
}

interface ScanModeCardConfig {
  id: MarketScanMode;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  /** Classes applied when this card is the active scan scope. */
  activeClass: string;
  /** Icon colour when active. */
  iconActiveClass: string;
  /** Classes for the count pill. */
  countClass: string;
  /** Resolves the count shown in the pill (list sizes are passed in as props). */
  count: (ctx: { watchlistCount: number; customCount: number }) => number;
}

/**
 * The seven scan-scope cards (All Market / SET100 / SET50 / sSET / mai /
 * Watchlist / Custom).
 *
 * Declared as data because every card shares one markup shape; the stock-list
 * lengths are read lazily through `count` so importing the static lists happens
 * in one place.
 */
function buildCards(): ScanModeCardConfig[] {
  return [
    {
      id: 'ALL_MARKET',
      title: 'All Market',
      subtitle: 'SET + mai',
      icon: Globe,
      activeClass: 'bg-gradient-to-br from-emerald-950/80 to-slate-900 border-emerald-500/70 shadow-md shadow-emerald-950/40',
      iconActiveClass: 'text-emerald-400',
      countClass: 'bg-emerald-500/20 text-emerald-400',
      count: () => ALL_MARKET_STOCKS.length,
    },
    {
      id: 'SET100',
      title: 'SET100',
      subtitle: '100 หุ้นใหญ่',
      icon: Layers,
      activeClass: 'bg-gradient-to-br from-blue-950/80 to-slate-900 border-blue-500/70 shadow-md shadow-blue-950/40',
      iconActiveClass: 'text-blue-400',
      countClass: 'bg-blue-500/20 text-blue-400',
      count: () => SET100_STOCKS.length,
    },
    {
      id: 'SET50',
      title: 'SET50',
      subtitle: 'Blue-Chip',
      icon: Crown,
      activeClass: 'bg-gradient-to-br from-amber-950/80 to-slate-900 border-amber-500/70 shadow-md shadow-amber-950/40',
      iconActiveClass: 'text-amber-400',
      countClass: 'bg-amber-500/20 text-amber-400',
      count: () => SET50_STOCKS.length,
    },
    {
      id: 'SSET',
      title: 'sSET',
      subtitle: 'Small-Cap',
      icon: Sparkles,
      activeClass: 'bg-gradient-to-br from-purple-950/80 to-slate-900 border-purple-500/70 shadow-md shadow-purple-950/40',
      iconActiveClass: 'text-purple-400',
      countClass: 'bg-purple-500/20 text-purple-400',
      count: () => SSET_STOCKS.length,
    },
    {
      id: 'MAI',
      title: 'mai',
      subtitle: 'Growth Stocks',
      icon: Zap,
      activeClass: 'bg-gradient-to-br from-rose-950/80 to-slate-900 border-rose-500/70 shadow-md shadow-rose-950/40',
      iconActiveClass: 'text-rose-400',
      countClass: 'bg-rose-500/20 text-rose-400',
      count: () => MAI_STOCKS.length,
    },
    {
      id: 'WATCHLIST',
      title: 'Watchlist',
      subtitle: 'ติดดาวไว้',
      icon: Star,
      activeClass: 'bg-gradient-to-br from-yellow-950/80 to-slate-900 border-yellow-500/70 shadow-md shadow-yellow-950/40',
      iconActiveClass: 'text-yellow-400',
      countClass: 'bg-yellow-500/20 text-yellow-400',
      count: ({ watchlistCount }) => watchlistCount,
    },
    {
      id: 'CUSTOM',
      title: 'Custom',
      subtitle: 'กำหนดเอง',
      icon: SlidersHorizontal,
      activeClass: 'bg-gradient-to-br from-cyan-950/80 to-slate-900 border-cyan-500/70 shadow-md shadow-cyan-950/40',
      iconActiveClass: 'text-cyan-400',
      countClass: 'bg-cyan-500/20 text-cyan-400',
      count: ({ customCount }) => customCount,
    },
  ];
}

export const ScannerModeSelector: React.FC<ScannerModeSelectorProps> = ({
  active,
  onChange,
  watchlistCount,
  customCount,
}) => {
  const cards = buildCards();

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2.5">
      {cards.map((card) => {
        const Icon = card.icon;
        const isActive = active === card.id;

        return (
          <button
            key={card.id}
            onClick={() => onChange(card.id)}
            className={`p-3 rounded-2xl border transition text-left flex flex-col justify-between cursor-pointer ${
              isActive ? card.activeClass : 'bg-slate-950/60 hover:bg-slate-800/40 border-slate-800/80 text-slate-400'
            }`}
          >
            <div className="flex items-center justify-between w-full mb-1">
              <Icon className={`w-4 h-4 ${isActive ? card.iconActiveClass : 'text-slate-400'}`} />
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono font-bold ${card.countClass}`}>
                {card.count({ watchlistCount, customCount })}
              </span>
            </div>
            <div>
              <span className="text-xs font-bold text-white block">{card.title}</span>
              <span className="text-[9px] text-slate-400">{card.subtitle}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
};