import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateCDCActionZone, calculateCdcQualityScore, getCrossoverInfo, isLongEntrySignal } from '../src/lib/cdcIndicator';
import { assessBuySetup, assessDailyPricePosition } from '../src/lib/quantEngine';
import type { KlineData } from '../src/types';

function createMockCandles(length: number, trend: 'bullish' | 'bearish' | 'rebound'): KlineData[] {
  const candles: KlineData[] = [];
  let price = 50;

  for (let i = 0; i < length; i++) {
    if (trend === 'bullish') {
      price += 0.5;
    } else if (trend === 'bearish') {
      price -= 0.5;
    } else {
      // Rebound after long downtrend
      if (i < 40) price -= 0.5;
      else price += 0.8;
    }

    candles.push({
      time: 1700000000 + i * 86400,
      open: price - 0.2,
      high: price + 0.5,
      low: price - 0.5,
      close: price,
      volume: 1000000,
    });
  }
  return candles;
}

describe('Strict CDC Action Zone V3 Golden Cross', () => {
  it('rejects mid-trend buy entry when golden cross is older than maxBarsSinceCrossover', () => {
    // 60 candles where an uptrend has a 1-day dip (yellow) followed by a bounce (green)
    const candles = createMockCandles(60, 'bullish');
    // Force candle 58 to dip below EMA12 so it becomes YELLOW, and candle 59 to bounce back to GREEN
    candles[58].close = candles[58].open - 4;
    candles[59].close = candles[58].close + 6;

    const cdcCandles = calculateCDCActionZone(candles);
    const crossover = getCrossoverInfo(cdcCandles);

    assert.ok(crossover.barsSinceGoldenCross > 2);

    // Permissive mode accepts the yellow-to-blue/green bounce
    const isSignalPermissive = isLongEntrySignal(cdcCandles, ['BLUE', 'GREEN'], {
      strictGoldenCross: false,
    });
    assert.equal(isSignalPermissive, true);

    // Strict mode rejects because Golden Cross was more than 2 bars ago!
    const isSignalStrict = isLongEntrySignal(cdcCandles, ['BLUE', 'GREEN'], {
      strictGoldenCross: true,
      maxBarsSinceCrossover: 2,
    });
    assert.equal(isSignalStrict, false);
  });

  it('accepts fresh golden cross on bar 1 and 2', () => {
    // Rebound scenario where golden cross happens near the end
    const candles = createMockCandles(50, 'rebound');
    const cdcCandles = calculateCDCActionZone(candles);
    const crossover = getCrossoverInfo(cdcCandles);

    if (crossover.barsSinceGoldenCross <= 2) {
      const isSignal = isLongEntrySignal(cdcCandles, ['GREEN', 'BLUE'], {
        strictGoldenCross: true,
        maxBarsSinceCrossover: 2,
      });
      assert.equal(isSignal, true);
    }
  });

  it('uses GREEN as the confirmed buy and treats BLUE as a wait-for-confirmation alert', () => {
    const candles: KlineData[] = [
      { time: 1, open: 10, high: 10.5, low: 9.5, close: 10, volume: 100, emaFast: 9, emaSlow: 10, zone: 'BLUE' },
      { time: 2, open: 10.1, high: 11, low: 10, close: 10.8, volume: 120, emaFast: 10.2, emaSlow: 10, zone: 'GREEN' },
    ];

    assert.equal(isLongEntrySignal(candles, ['GREEN'], { strictGoldenCross: true, maxBarsSinceCrossover: 2 }), true);
    assert.equal(isLongEntrySignal(candles, ['BLUE'], { strictGoldenCross: true, maxBarsSinceCrossover: 2 }), false);
  });

  it('ranks a fresh GREEN signal above BLUE and forces RED into avoid/cash territory', () => {
    const score = (zone: 'GREEN' | 'BLUE' | 'RED') => calculateCdcQualityScore({
      zone,
      barsSinceZoneChange: 0,
      barsSinceGoldenCross: 1,
      isFreshGoldenCross: true,
      trendStrength: 2,
      volume24h: 50_000_000,
      priceChange24h: 1,
    });

    const green = score('GREEN');
    const blue = score('BLUE');
    const red = score('RED');
    assert.ok(green.totalScore > blue.totalScore);
    assert.equal(green.entryTimingCategory, 'PRIME_ENTRY');
    assert.ok(blue.entryTimingLabel.includes('รอเขียวยืนยัน'));
    assert.equal(red.entryTimingCategory, 'BEAR_AVOID');
    assert.equal(red.grade, 'D');
    assert.ok(red.totalScore < 40);
  });

  it('gives fewer 24h momentum points to a sharp rise than to early contained movement', () => {
    const priceScore = (priceChange24h: number) => calculateCdcQualityScore({
      zone: 'GREEN', barsSinceZoneChange: 0, barsSinceGoldenCross: 1,
      isFreshGoldenCross: true, trendStrength: 1, volume24h: 5_000_000, priceChange24h,
    }).priceChange.score;

    assert.ok(priceScore(1) > priceScore(6));
    assert.ok(priceScore(6) > priceScore(10));
  });

  it('gives the bot Quant gate a stronger entry factor for fresh GREEN than BLUE', () => {
    const reversal = (upBars: number): KlineData[] => {
      const candles: KlineData[] = [];
      let price = 150;
      for (let i = 0; i < 100; i++) {
        price -= 0.5;
        candles.push({ time: i, open: price - 0.2, high: price + 0.3, low: price - 0.3, close: price, volume: 1_000_000 });
      }
      for (let i = 0; i < upBars; i++) {
        price += 2;
        candles.push({ time: 100 + i, open: price - 0.4, high: price + 0.3, low: price - 0.3, close: price, volume: 3_000_000 });
      }
      return candles;
    };

    const blue = assessBuySetup(reversal(7));
    const green = assessBuySetup(reversal(8));
    assert.ok(blue);
    assert.ok(green);
    assert.equal(blue.entryFactor, 0.55);
    assert.equal(green.entryFactor, 1.05);
  });

  it('detects EXTENDED price position when price is far above 60D base', () => {
    // 70 candles where price exploded in the last 15 candles
    const candles: KlineData[] = [];
    let p = 20;
    for (let i = 0; i < 70; i++) {
      if (i > 50) p += 2.0; // explosive run
      candles.push({
        time: 1700000000 + i * 86400,
        open: p - 0.1,
        high: p + 0.3,
        low: p - 0.1,
        close: p,
        volume: 2000000,
      });
    }

    const pos = assessDailyPricePosition(candles);
    assert.notEqual(pos, null);
    if (pos) {
      assert.equal(pos.zone, 'EXTENDED');
      assert.ok(pos.distanceToBaseAtr >= 4);
    }
  });

  it('widens NEAR_BASE to the lower 35% of the prior 60-session range', () => {
    const candles: KlineData[] = Array.from({ length: 70 }, (_, i) => {
      const close = 100 + i * 0.15;
      return {
        time: 1700000000 + i * 86400,
        open: close - 0.05,
        high: close + 0.2,
        low: close - 0.2,
        close,
        volume: 1_000_000,
      };
    });
    candles[40].low = 100; // Confirmed swing low used as support.
    candles[60].high = 120; // Prior 60-session resistance.
    candles[69] = {
      ...candles[69], open: 107.1, high: 108, low: 106.5, close: 107,
    };

    const position = assessDailyPricePosition(candles);
    assert.notEqual(position, null);
    if (position) {
      assert.ok(Math.abs(position.rangePosition - 0.35) < 0.005);
      assert.ok(position.distanceToBaseAtr > 2);
      assert.equal(position.zone, 'NEAR_BASE');
      assert.equal(position.entryReady, false);
    }
  });
});
