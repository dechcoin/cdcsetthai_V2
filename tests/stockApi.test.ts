import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchStockKlines, toStockSymbol } from '../src/lib/stockApi';

test('preserves Yahoo index prefix while normalizing the SET ticker suffix', () => {
  assert.equal(toStockSymbol('^SET.BK'), '^SET');
  assert.equal(toStockSymbol('^SET'), '^SET');
});

test('normalizes ordinary Thai share and ETF tickers without the Yahoo suffix', () => {
  assert.equal(toStockSymbol('PTT'), 'PTT');
  assert.equal(toStockSymbol('PTT.BK'), 'PTT');
  assert.equal(toStockSymbol('TDEX'), 'TDEX');
});

test('URL-encodes the preserved caret when requesting Yahoo SET index candles', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ s: 'ok', t: [], o: [], h: [], l: [], c: [], v: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const candles = await fetchStockKlines('^SET.BK', '1d', 20);
    assert.deepEqual(candles, []);
    assert.match(requestedUrl, /symbol=%5ESET(?:&|$)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
