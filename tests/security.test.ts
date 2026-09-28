import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dashboardAuth } from '../server/middleware/dashboardAuth';
import { decryptSecret, encryptSecret, hasSecretEncryptionKey } from '../server/utils/secretVault';

function invokeAuth(path: string, headers: Record<string, string> = {}) {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  let calledNext = false;
  dashboardAuth({ path, headers } as any, response as any, () => { calledNext = true; });
  return { ...response, calledNext };
}

test('requires a token for production API requests but leaves health public', () => {
  const previousMode = process.env.NODE_ENV;
  const previousToken = process.env.DASHBOARD_TOKEN;
  process.env.NODE_ENV = 'production';
  delete process.env.DASHBOARD_TOKEN;
  try {
    assert.equal(invokeAuth('/state').statusCode, 503);
    assert.equal(invokeAuth('/health').calledNext, true);
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
    if (previousToken === undefined) delete process.env.DASHBOARD_TOKEN;
    else process.env.DASHBOARD_TOKEN = previousToken;
  }
});

test('accepts the configured dashboard token and rejects a wrong one', () => {
  const previousMode = process.env.NODE_ENV;
  const previousToken = process.env.DASHBOARD_TOKEN;
  process.env.NODE_ENV = 'production';
  process.env.DASHBOARD_TOKEN = 'test-dashboard-token';
  try {
    assert.equal(invokeAuth('/state', { 'x-dashboard-token': 'test-dashboard-token' }).calledNext, true);
    assert.equal(invokeAuth('/state', { 'x-dashboard-token': 'wrong' }).statusCode, 401);
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
    if (previousToken === undefined) delete process.env.DASHBOARD_TOKEN;
    else process.env.DASHBOARD_TOKEN = previousToken;
  }
});

test('AES-GCM vault round-trips secrets with fresh IVs and detects tampering', () => {
  const previousKey = process.env.LIVE_KEYS_ENCRYPTION_KEY;
  process.env.LIVE_KEYS_ENCRYPTION_KEY = 'a-random-test-vault-key-with-32-plus-characters';
  try {
    assert.equal(hasSecretEncryptionKey(), true);
    const first = encryptSecret('broker-secret');
    const second = encryptSecret('broker-secret');
    assert.equal(decryptSecret(first), 'broker-secret');
    assert.notEqual(first.iv, second.iv);
    assert.throws(() => decryptSecret({ ...first, ciphertext: `${first.ciphertext.slice(0, -2)}AA` }));
  } finally {
    if (previousKey === undefined) delete process.env.LIVE_KEYS_ENCRYPTION_KEY;
    else process.env.LIVE_KEYS_ENCRYPTION_KEY = previousKey;
  }
});
