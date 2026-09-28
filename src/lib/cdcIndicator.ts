import { KlineData, CDCZoneColor, CDCSignalType } from '../types';

/**
 * Calculates Exponential Moving Average (EMA) for an array of prices
 */
export function calculateEMA(prices: number[], period: number): number[] {
  const ema: number[] = new Array(prices.length).fill(0);
  if (prices.length < period) return ema;

  // Initial SMA as first EMA value
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  ema[period - 1] = sum / period;

  const k = 2 / (period + 1);

  for (let i = period; i < prices.length; i++) {
    ema[i] = prices[i] * k + ema[i - 1] * (1 - k);
  }

  // Backfill earlier indices with SMA approximations
  let cumulative = 0;
  for (let i = 0; i < period - 1; i++) {
    cumulative += prices[i];
    ema[i] = cumulative / (i + 1);
  }

  return ema;
}

/**
 * Calculates CDC Action Zone V3 indicators for a series of candlestick data.
 */
export function calculateCDCActionZone(
  rawCandles: KlineData[],
  fastPeriod = 12,
  slowPeriod = 26
): KlineData[] {
  if (!rawCandles || rawCandles.length === 0) return [];

  const closePrices = rawCandles.map((c) => c.close);
  const emaFastList = calculateEMA(closePrices, fastPeriod);
  const emaSlowList = calculateEMA(closePrices, slowPeriod);

  const result: KlineData[] = [];

  for (let i = 0; i < rawCandles.length; i++) {
    const candle = rawCandles[i];
    const close = candle.close;
    const fast = emaFastList[i];
    const slow = emaSlowList[i];

    const prevCandle = i > 0 ? result[i - 1] : null;
    const prevFast = prevCandle?.emaFast ?? fast;
    const prevSlow = prevCandle?.emaSlow ?? slow;
    const prevClose = prevCandle?.close ?? close;

    let zone: CDCZoneColor = 'CYAN';
    let signal: CDCSignalType = 'NEUTRAL';
    let colorNameTh = 'โซนสถิตย์';
    let actionRecommendation = 'รอสัญญาณ';

    const isBullishCross = prevFast <= prevSlow && fast > slow;
    const isBearishCross = prevFast >= prevSlow && fast < slow;

    // CDC Action Zone V3 Logic
    if (fast > slow) {
      // Bullish Regime
      if (close >= fast) {
        // Above Fast EMA
        if (isBullishCross || (prevCandle && (prevCandle.zone === 'YELLOW' || prevCandle.zone === 'RED' || prevCandle.zone === 'ORANGE'))) {
          zone = 'BLUE';
          signal = 'BUY';
          colorNameTh = 'โซนฟ้า (รอสัญญาณเขียว)';
          actionRecommendation = 'รอยืนยันแท่งเขียว / Pre-signal';
        } else {
          zone = 'GREEN';
          signal = 'HOLD_BULL';
          colorNameTh = 'โซนเขียว (ขาขึ้นรุนแรง)';
          actionRecommendation = 'ถือครอง / Hold Long';
        }
      } else {
        // Close < Fast EMA while Fast > Slow EMA
        zone = 'YELLOW';
        signal = 'WARNING';
        colorNameTh = 'โซนเหลือง (เตือนระวัง)';
        actionRecommendation = 'เตรียมขาย / Take Profit Warning';
      }
    } else if (fast < slow) {
      // Bearish Regime
      if (close <= fast) {
        // Below Fast EMA
        if (isBearishCross) {
          signal = 'SELL';
        } else {
          signal = 'HOLD_BEAR';
        }
        zone = 'RED';
        colorNameTh = 'โซนแดง (ขาลง / ถือเงินสด)';
        actionRecommendation = 'ขายออก / Hold Cash / Short';
      } else {
        // Close > Fast EMA while Fast < Slow EMA
        zone = 'ORANGE';
        signal = 'NEUTRAL';
        colorNameTh = 'โซนส้ม (รีบาวด์หลอก)';
        actionRecommendation = 'อย่าเพิ่งซื้อ / Bearish Bounce';
      }
    } else {
      zone = 'CYAN';
      signal = 'NEUTRAL';
      colorNameTh = 'โซนไซแอน (ไซด์เวย์)';
      actionRecommendation = 'เฝ้าระวัง';
    }

    result.push({
      ...candle,
      emaFast: fast,
      emaSlow: slow,
      zone,
      signal,
      colorNameTh,
      actionRecommendation,
    });
  }

  return result;
}

/**
 * Returns hex color code for CDC Action Zone
 */
export function getZoneColorHex(zone?: CDCZoneColor): string {
  switch (zone) {
    case 'GREEN':
      return '#22c55e'; // Green 500
    case 'BLUE':
      return '#3b82f6'; // Blue 500
    case 'YELLOW':
      return '#eab308'; // Yellow 500
    case 'RED':
      return '#ef4444'; // Red 500
    case 'ORANGE':
      return '#f97316'; // Orange 500
    case 'CYAN':
    default:
      return '#06b6d4'; // Cyan 500
  }
}

/**
 * Returns Thai name for CDC Zone
 */
export function getZoneNameTh(zone?: CDCZoneColor): string {
  switch (zone) {
    case 'GREEN':
      return 'โซนเขียว (Buy & Hold)';
    case 'BLUE':
      return 'โซนฟ้า (สัญญาณเตือนก่อนเขียว)';
    case 'YELLOW':
      return 'โซนเหลือง (Take Profit)';
    case 'RED':
      return 'โซนแดง (Sell / Hold Cash)';
    case 'ORANGE':
      return 'โซนส้ม (Bearish Bounce)';
    case 'CYAN':
    default:
      return 'โซนไซแอน (Sideways)';
  }
}

export interface CrossoverInfo {
  lastGoldenCrossBarIndex: number;
  lastDeadCrossBarIndex: number;
  barsSinceGoldenCross: number;
  barsSinceDeadCross: number;
  isFreshGoldenCross: boolean; // True ONLY if Golden Cross occurred on bar 0 (crossover) or bar 1 (next confirmation bar)
  isFreshDeadCross: boolean;   // True ONLY if Dead Cross occurred on bar 0 (crossunder) or bar 1 (next confirmation bar)
}

/**
 * Calculates exact bars since the last true EMA 12 / EMA 26 Crossover.
 * This guarantees the bot NEVER enters late into an old trend (preventing buying tops or shorting bottoms).
 */
export function getCrossoverInfo(candles: KlineData[]): CrossoverInfo {
  let lastGoldenCross = -1;
  let lastDeadCross = -1;

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    if (
      prev.emaFast !== undefined &&
      prev.emaSlow !== undefined &&
      curr.emaFast !== undefined &&
      curr.emaSlow !== undefined
    ) {
      if (prev.emaFast <= prev.emaSlow && curr.emaFast > curr.emaSlow) {
        lastGoldenCross = i;
      } else if (prev.emaFast >= prev.emaSlow && curr.emaFast < curr.emaSlow) {
        lastDeadCross = i;
      }
    }
  }

  const n = candles.length;
  const barsSinceGoldenCross = lastGoldenCross >= 0 ? n - 1 - lastGoldenCross : 999;
  const barsSinceDeadCross = lastDeadCross >= 0 ? n - 1 - lastDeadCross : 999;

  return {
    lastGoldenCrossBarIndex: lastGoldenCross,
    lastDeadCrossBarIndex: lastDeadCross,
    barsSinceGoldenCross,
    barsSinceDeadCross,
    // 🎯 Only within 0 (crossover bar) or 1 (next confirmation bar) according to Uncle Chaloke's rule:
    isFreshGoldenCross: barsSinceGoldenCross <= 1,
    isFreshDeadCross: barsSinceDeadCross <= 1,
  };
}

/**
 * "เขียวซื้อ" — Long entry per Uncle Chaloke's Confirmed Next-Bar Rule.
 * Matches the backtester so live trading and backtest stay consistent:
 *  - First BLUE candle only when an explicitly aggressive config includes BLUE, or
 *  - First GREEN candle that follows a BLUE/YELLOW/RED candle when GREEN is in `buyZones`.
 * The standard SET strategy config selects GREEN only; BLUE is a pre-signal there.
 */
export function isLongEntrySignal(
  candles: KlineData[],
  buyZones: ('BLUE' | 'GREEN')[],
  options?: { strictGoldenCross?: boolean; maxBarsSinceCrossover?: number }
): boolean {
  if (!candles || candles.length < 1) return false;
  const latest = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2] : undefined;
  const zone = latest.zone;
  const prevZone = prev?.zone;

  const isFirstBlue = buyZones.includes('BLUE') && zone === 'BLUE' && prevZone !== 'BLUE';
  const isFirstConfirmedGreen =
    buyZones.includes('GREEN') &&
    zone === 'GREEN' &&
    !!prevZone &&
    (prevZone === 'BLUE' || prevZone === 'YELLOW' || prevZone === 'RED');

  const hasTrigger = isFirstBlue || isFirstConfirmedGreen;
  if (!hasTrigger) return false;

  // Strict Golden Cross: In true CDC strategy, entry must be at the fresh Golden Cross
  // (within first 2 bars of EMA12 crossing above EMA26). If the Golden Cross occurred
  // long ago, a yellow-to-green pullback bounce is NOT a valid entry.
  if (options?.strictGoldenCross !== false) {
    const crossover = getCrossoverInfo(candles);
    const maxBars = options?.maxBarsSinceCrossover ?? 2;
    if (crossover.barsSinceGoldenCross > maxBars) {
      return false;
    }
  }

  return true;
}

/**
 * "แดงขาย" — Bearish entry per the same Confirmed Next-Bar Rule:
 * the first RED candle after a non-RED candle.
 */
export function isShortEntrySignal(candles: KlineData[], sellZones: ('YELLOW' | 'RED')[]): boolean {
  if (!candles || candles.length < 1) return false;
  const latest = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2] : undefined;
  const zone = latest.zone;
  const prevZone = prev?.zone;

  return sellZones.includes('RED') && zone === 'RED' && prevZone !== 'RED';
}


/**
 * Calculates bars since the current CDC Action Zone started
 */
export function getBarsSinceZoneChange(candles: KlineData[]): number {
  if (!candles || candles.length === 0) return 999;
  const latestZone = candles[candles.length - 1].zone;
  let count = 0;
  for (let i = candles.length - 2; i >= 0; i--) {
    if (candles[i].zone === latestZone) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * 5-Factor CDC Quality Score Algorithm (0-100 Points)
 * Based strictly on Uncle Chaloke's "เขียวซื้อ แดงขาย" Strategy:
 * 1. Golden Cross Entry Timing (0-35 pts): True Golden Cross Bar 0 and Bar 1 (Green 1) gets full 35 pts!
 * 2. Zone State (0-25 pts): True Blue/Green Golden Cross vs Old Trend Bounce
 * 3. Trend Strength (0-20 pts): Fast vs Slow EMA spread & divergence
 * 4. Volume 24h (0-10 pts): Turnover liquidity backing
 * 5. Price Change % (0-10 pts): Balanced momentum without extreme overbought
 */
export function calculateCdcQualityScore(params: {
  zone: CDCZoneColor;
  barsSinceZoneChange: number;
  barsSinceGoldenCross: number;
  isFreshGoldenCross: boolean;
  trendStrength: number;
  volume24h: number;
  priceChange24h: number;
}): import('../types').QualityScoreBreakdown {
  const {
    zone,
    barsSinceZoneChange,
    barsSinceGoldenCross,
    isFreshGoldenCross,
    trendStrength,
    volume24h,
    priceChange24h,
  } = params;

  // 1. Golden Cross Entry Timing (0-35). Full recency points are reserved for
  // a confirmed GREEN buy; BLUE is an alert to wait for that confirmation.
  let recencyScore = 2;
  let recencyDetail = `ผ่านจุดตัด Golden Cross มานานแล้ว (${barsSinceGoldenCross} แท่ง) ไม่ใช่จุดเข้าซื้อต้นรอบ`;
  let entryTimingCategory: 'PRIME_ENTRY' | 'EARLY_TREND' | 'MID_TREND' | 'LATE_STAGE' | 'BEAR_AVOID' = 'LATE_STAGE';
  let entryTimingLabel = '⚠️ ปลายรอบ (เสี่ยงติดดอย)';

  if (zone === 'RED') {
    entryTimingCategory = 'BEAR_AVOID';
    entryTimingLabel = '🟥 ขาลง / ถือเงินสด (ห้ามซื้อ)';
    recencyScore = 0;
    recencyDetail = 'โซนแดง ขาลงตามทฤษฎีแดงขาย ควรถือเงินสด';
  } else if (barsSinceGoldenCross === 0) {
    if (zone === 'GREEN') {
      recencyScore = 35;
      recencyDetail = '🌟 Golden Cross สดใหม่และ CDC ยืนยันโซนเขียว';
      entryTimingCategory = 'PRIME_ENTRY';
      entryTimingLabel = '🌟 เขียวซื้อ (Golden Cross สดใหม่)';
    } else {
      recencyScore = 15;
      recencyDetail = 'Golden Cross เพิ่งเกิด แต่ยังรอยืนยันโซนเขียวก่อนเข้า';
      entryTimingCategory = 'EARLY_TREND';
      entryTimingLabel = '🔵 สัญญาณเตือน — รอเขียวยืนยัน';
    }
  } else if (barsSinceGoldenCross === 1) {
    if (zone === 'GREEN') {
      recencyScore = 35;
      recencyDetail = '🌟 เขียวแรกยืนยัน Golden Cross — จุดเข้าต้นรอบ';
      entryTimingCategory = 'PRIME_ENTRY';
      entryTimingLabel = '🌟 เขียวซื้อ (แท่งยืนยันแรก)';
    } else {
      recencyScore = 15;
      recencyDetail = 'Golden Cross เพิ่งเกิด แต่ยังรอยืนยันโซนเขียวก่อนเข้า';
      entryTimingCategory = 'EARLY_TREND';
      entryTimingLabel = '🔵 สัญญาณเตือน — รอเขียวยืนยัน';
    }
  } else if (barsSinceGoldenCross <= 3) {
    recencyScore = zone === 'GREEN' ? 25 : 12;
    recencyDetail = zone === 'GREEN'
      ? `🌱 โซนเขียวในช่วงต้นรอบ (${barsSinceGoldenCross} แท่งหลังจุดตัด)`
      : `Golden Cross ยังใหม่ แต่ยังไม่มีโซนเขียวยืนยัน (${barsSinceGoldenCross} แท่ง)`;
    entryTimingCategory = 'EARLY_TREND';
    entryTimingLabel = zone === 'GREEN' ? `🌱 ต้นรอบ (${barsSinceGoldenCross} แท่ง)` : '🔵 สัญญาณเตือน — รอเขียวยืนยัน';
  } else if (barsSinceGoldenCross <= 7) {
    recencyScore = zone === 'GREEN' ? 15 : 8;
    recencyDetail = `📈 เทรนด์กำลังดำเนินระดับกลาง (${barsSinceGoldenCross} แท่งหลังจุดตัด)`;
    entryTimingCategory = 'MID_TREND';
    entryTimingLabel = zone === 'GREEN' ? `📈 กลางเทรนด์ (${barsSinceGoldenCross} แท่ง)` : 'รอสัญญาณ CDC เขียว';
  } else if (barsSinceGoldenCross <= 15) {
    recencyScore = zone === 'GREEN' ? 8 : 4;
    recencyDetail = `เทรนด์ดำเนินมาระยะหนึ่ง (${barsSinceGoldenCross} แท่งหลังจุดตัด)`;
    entryTimingCategory = 'MID_TREND';
    entryTimingLabel = zone === 'GREEN' ? `เทรนด์ต่อเนื่อง (${barsSinceGoldenCross} แท่ง)` : 'รอสัญญาณ CDC เขียว';
  }

  // 2. Zone (0-25)
  let zoneScore = 0;
  let zoneDetail = 'โซนแดง ขาลง / ควรถือเงินสด';
  if (zone === 'GREEN' && barsSinceGoldenCross <= 1) {
    zoneScore = 25;
    zoneDetail = 'โซนเขียวและ Golden Cross สด — ผ่านเงื่อนไขเขียวซื้อ';
  } else if (zone === 'GREEN' && barsSinceGoldenCross <= 5) {
    zoneScore = 22;
    zoneDetail = 'โซนเขียวในช่วงต้นรอบ (Strong Bull)';
  } else if (zone === 'GREEN') {
    zoneScore = 16;
    zoneDetail = 'โซนเขียว รันเทรนด์ขาขึ้นต่อเนื่อง (Bull Trend)';
  } else if (zone === 'BLUE') {
    zoneScore = 8;
    zoneDetail = 'โซนฟ้าเป็นสัญญาณเตือน — รอแท่งเขียวยืนยันก่อนซื้อ';
  } else if (zone === 'CYAN') {
    zoneScore = 5;
    zoneDetail = 'โซนไซแอน ไซด์เวย์ พักตัวรอทิศทาง';
  } else if (zone === 'ORANGE') {
    zoneScore = 2;
    zoneDetail = 'โซนส้ม รีบาวด์ระยะสั้นในขาลง';
  } else if (zone === 'YELLOW') {
    zoneScore = 2;
    zoneDetail = 'โซนเหลือง เตือนระวังเริ่มชะลอตัว / เตรียมขายทำกำไร';
  }

  // 3. Trend Strength (0-20)
  let trendScore = 0;
  let trendDetail = `แนวโน้มอ่อนแอ / ตัดลง (${trendStrength >= 0 ? '+' : ''}${trendStrength.toFixed(2)}%)`;
  if (trendStrength >= 3.0) {
    trendScore = 20;
    trendDetail = `เส้น EMA กางกว้างแข็งแกร่งมาก (+${trendStrength.toFixed(2)}%)`;
  } else if (trendStrength >= 1.5) {
    trendScore = 16;
    trendDetail = `แนวโน้มขาขึ้นแข็งแรง (+${trendStrength.toFixed(2)}%)`;
  } else if (trendStrength >= 0.5) {
    trendScore = 12;
    trendDetail = `เริ่มกางออกเป็นบวก (+${trendStrength.toFixed(2)}%)`;
  } else if (trendStrength >= 0.0) {
    trendScore = 8;
    trendDetail = `กางเล็กน้อย (+${trendStrength.toFixed(2)}%)`;
  } else if (trendStrength >= -1.0) {
    trendScore = 4;
    trendDetail = `บีบตัวใกล้จุดเปลี่ยน (${trendStrength.toFixed(2)}%)`;
  }

  // 4. Volume 24h (0-10)
  let volumeScore = 1;
  const volMil = volume24h / 1_000_000;
  let volumeDetail = `วอลุ่มเบาบาง (฿${volMil.toFixed(2)}M)`;
  if (volume24h >= 50_000_000) {
    volumeScore = 10;
    volumeDetail = `วอลุ่มหนาแน่นสูงมาก (฿${volMil.toFixed(1)}M)`;
  } else if (volume24h >= 20_000_000) {
    volumeScore = 8;
    volumeDetail = `วอลุ่มหนาแน่นปานกลางค่อนข้างสูง (฿${volMil.toFixed(1)}M)`;
  } else if (volume24h >= 5_000_000) {
    volumeScore = 6;
    volumeDetail = `วอลุ่มปานกลาง (฿${volMil.toFixed(1)}M)`;
  } else if (volume24h >= 1_000_000) {
    volumeScore = 4;
    volumeDetail = `วอลุ่มระดับพอใช้ (฿${volMil.toFixed(1)}M)`;
  }

  // 5. Price Change 24h % (0-10): favor early/contained movement, not chasing.
  let priceScore = 0;
  let priceDetail = `ราคาลบแรง — ไม่ให้แต้มโมเมนตัม (${priceChange24h.toFixed(2)}%)`;
  if (zone === 'RED') {
    priceDetail = `โซนแดงมีลำดับเหนือกว่าโมเมนตัม — งดซื้อ (${priceChange24h.toFixed(2)}%)`;
  } else if (priceChange24h < -5) {
    priceScore = 0;
    priceDetail = `ราคาลบแรง ระวังฐานเสีย (${priceChange24h.toFixed(2)}%)`;
  } else if (priceChange24h < -2) {
    priceScore = 2;
    priceDetail = `ราคาย่อลึก ต้องรอสัญญาณเขียวที่ชัด (${priceChange24h.toFixed(2)}%)`;
  } else if (priceChange24h < -0.5) {
    priceScore = 5;
    priceDetail = `ราคาย่อปานกลาง (${priceChange24h.toFixed(2)}%)`;
  } else if (priceChange24h <= 0.5) {
    priceScore = 9;
    priceDetail = `ราคาแกว่งแคบ เหมาะกับการรอจังหวะต้นรอบ (${priceChange24h >= 0 ? '+' : ''}${priceChange24h.toFixed(2)}%)`;
  } else if (priceChange24h <= 2) {
    priceScore = 10;
    priceDetail = `โมเมนตัมบวกพอดี ไม่ไล่ราคามากเกินไป (+${priceChange24h.toFixed(2)}%)`;
  } else if (priceChange24h <= 4) {
    priceScore = 8;
    priceDetail = `โมเมนตัมบวก แต่เริ่มยืดตัว (+${priceChange24h.toFixed(2)}%)`;
  } else if (priceChange24h <= 7) {
    priceScore = 5;
    priceDetail = `ราคาขึ้นแรง ลดแต้มเพื่อเลี่ยงการไล่ราคา (+${priceChange24h.toFixed(2)}%)`;
  } else {
    priceScore = 2;
    priceDetail = `ราคาพุ่งแรงมาก — เสี่ยงไล่ราคา (+${priceChange24h.toFixed(2)}%)`;
  }

  const totalScore = Math.min(100, Math.max(0, recencyScore + zoneScore + trendScore + volumeScore + priceScore));

  let grade: 'S' | 'A' | 'B' | 'C' | 'D' = 'D';
  let gradeLabel = '🚫 ไม่แนะนำ (D)';
  if (totalScore >= 85) {
    grade = 'S';
    gradeLabel = '🌟 จุดเข้าซื้อคุณภาพพรีเมียม (Grade S)';
  } else if (totalScore >= 70) {
    grade = 'A';
    gradeLabel = '💎 คุณภาพสูง (Grade A)';
  } else if (totalScore >= 55) {
    grade = 'B';
    gradeLabel = '⚡ คุณภาพปานกลาง (Grade B)';
  } else if (totalScore >= 40) {
    grade = 'C';
    gradeLabel = '⚠️ สัญญาณเฝ้าระวัง / ปลายรอบ (Grade C)';
  }

  return {
    totalScore,
    grade,
    gradeLabel,
    entryTimingCategory,
    entryTimingLabel,
    recency: { score: recencyScore, maxScore: 35, label: 'ความสดใหม่ของจุดตัด (Golden Cross Timing)', detail: recencyDetail },
    zone: { score: zoneScore, maxScore: 25, label: 'โซนสี CDC (Zone)', detail: zoneDetail },
    trendStrength: { score: trendScore, maxScore: 20, label: 'ความแข็งแกร่ง (Trend)', detail: trendDetail },
    volume24h: { score: volumeScore, maxScore: 10, label: 'วอลุ่ม 24 ชม. (Volume)', detail: volumeDetail },
    priceChange: { score: priceScore, maxScore: 10, label: 'การเปลี่ยนแปลงราคา (Price %)', detail: priceDetail },
  };
}
