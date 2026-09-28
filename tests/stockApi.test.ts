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

test('reports a missing production dashboard token instead of returning an empty candle list', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: 'Dashboard API is locked: configure DASHBOARD_TOKEN on the server.',
  }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });

  try {
    await assert.rejects(
      fetchStockKlines('PTT', '1d', 100),
      /เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า DASHBOARD_TOKEN/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reports an invalid dashboard token clearly', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

  try {
    await assert.rejects(
      fetchStockKlines('PTT', '1d', 100),
      /DASHBOARD_TOKEN ไม่ถูกต้อง/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('explains app rate limits when a candle request receives HTTP 429', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: 'Too many requests. Please try again later.',
  }), {
    status: 429,
    headers: { 'content-type': 'application/json' },
  });

  try {
    await assert.rejects(
      fetchStockKlines('PTT', '1d', 100),
      /คำขอ API หุ้นเกิน rate limit ของแอป/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
