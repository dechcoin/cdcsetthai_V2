import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { test } from 'node:test';
import { marketRouter } from '../server/routes/market.routes';
import { botRouter } from '../server/routes/bot.routes';
import { getServerState } from '../server/repositories/stateRepository';

async function withServer(run: (baseUrl: string) => Promise<void>, mountBot = false): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/stock', marketRouter);
  if (mountBot) app.use('/api/bot', botRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not open test server');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
}

test('unsupported order book and broker endpoints return explicit 501, never fake success', async () => {
  await withServer(async (baseUrl) => {
    const depth = await fetch(`${baseUrl}/api/stock/depth?symbol=PTT`);
    const balances = await fetch(`${baseUrl}/api/stock/balances`, { method: 'POST' });
    const order = await fetch(`${baseUrl}/api/stock/order`, { method: 'POST' });
    assert.equal(depth.status, 501);
    assert.equal(balances.status, 501);
    assert.equal(order.status, 501);
    assert.equal((await order.json()).success, undefined);
  });
});

test('market data route preserves ^SET.BK when requesting Yahoo index candles', async () => {
  const originalFetch = globalThis.fetch;
  let yahooUrl = '';
  await withServer(async (baseUrl) => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestedUrl = String(input);
      if (requestedUrl.startsWith(baseUrl)) return originalFetch(input, init);
      yahooUrl = requestedUrl;
      return new Response(JSON.stringify({
        chart: {
          result: [{
            timestamp: [1_735_689_600],
            indicators: { quote: [{ open: [1_400], high: [1_410], low: [1_390], close: [1_405], volume: [0] }] },
          }],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    try {
      const response = await originalFetch(
        `${baseUrl}/api/stock/klines?symbol=%5ESET&resolution=1D&from=1735603200&to=1735776000`
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).s, 'ok');
      assert.match(yahooUrl, /chart\/%5ESET\.BK\?interval=1d/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('manual order in a persisted Live mode is rejected instead of mutating Paper balances', async () => {
  const state = getServerState();
  const previousMode = state.botConfig.mode;
  const previousBalance = state.paperAccount.usdtBalance;
  state.botConfig.mode = 'SETTRADE_LIVE';
  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/bot/manual-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: 'PTT', side: 'LONG', amountUsdt: 10_000, currentPrice: 35 }),
      });
      assert.equal(response.status, 501);
      assert.equal(state.paperAccount.usdtBalance, previousBalance);
    }, true);
  } finally {
    state.botConfig.mode = previousMode;
  }
});
