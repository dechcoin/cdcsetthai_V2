import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KlineData } from '../src/types';
import { stripFormingCandle } from '../src/lib/marketTime';

function candles(lastTime: number): KlineData[] {
  return [
    { time: lastTime - 60_000, open: 10, high: 11, low: 9, close: 10, volume: 1 },
    { time: lastTime, open: 10, high: 11, low: 9, close: 10, volume: 1 },
  ];
}

test('drops an intraday bar until its interval has elapsed (millisecond timestamps)', () => {
  const start = Date.UTC(2026, 0, 5, 3, 0); // 10:00 Bangkok
  assert.equal(stripFormingCandle(candles(start), '15m', new Date(start + 14 * 60_000)).length, 1);
  assert.equal(stripFormingCandle(candles(start), '15m', new Date(start + 15 * 60_000)).length, 2);
});

test('normalizes Yahoo server timestamps in seconds before testing bar completion', () => {
  const startMs = Date.UTC(2026, 0, 5, 3, 0);
  const serverCandles = candles(startMs / 1000);
  assert.equal(stripFormingCandle(serverCandles, '1h', new Date(startMs + 30 * 60_000)).length, 1);
  assert.equal(stripFormingCandle(serverCandles, '1h', new Date(startMs + 60 * 60_000)).length, 2);
});

test('keeps the current daily bar unconfirmed through the lunch break until SET close', () => {
  const dayStart = Date.UTC(2026, 0, 5, 0, 0); // Monday 07:00 Bangkok
  assert.equal(stripFormingCandle(candles(dayStart), '1d', new Date(Date.UTC(2026, 0, 5, 4, 0))).length, 1);
  assert.equal(stripFormingCandle(candles(dayStart), '1d', new Date(Date.UTC(2026, 0, 5, 6, 0))).length, 1);
  assert.equal(stripFormingCandle(candles(dayStart), '1d', new Date(Date.UTC(2026, 0, 5, 10, 0))).length, 2);
});

test('keeps a weekly bar during the week but accepts it after Friday close/weekend', () => {
  const monday = Date.UTC(2026, 0, 5, 0, 0);
  assert.equal(stripFormingCandle(candles(monday), '1w', new Date(Date.UTC(2026, 0, 7, 12, 0))).length, 1);
  assert.equal(stripFormingCandle(candles(monday), '1w', new Date(Date.UTC(2026, 0, 10, 4, 0))).length, 2);
});
