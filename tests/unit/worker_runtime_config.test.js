// tests/unit/worker_runtime_config.test.js
// A production Worker without a valid JWT_SECRET must not start serving: every request gets a JSON 503 CONFIG_ERROR
// (Node refuses to boot in the same situation) and the reason is logged, not returned. Own file = own process,
// because the configuration module is evaluated once per process.

process.env.NODE_ENV = 'production';
delete process.env.JWT_SECRET;

const { it } = require('node:test');
const assert = require('node:assert');
const { D1SqliteShim } = require('../helpers/d1-sqlite-shim');
const runtime = require('../../backend/cloudflare/runtime');

it('returns 503 CONFIG_ERROR without leaking which secret is missing', async () => {
  const originalError = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const res = await runtime.handle(new Request('https://sigma-car.pages.dev/api/v1/vehicles'), { DB: new D1SqliteShim(), NODE_ENV: 'production' });
    assert.strictEqual(res.status, 503);
    const text = await res.text();
    assert.strictEqual(JSON.parse(text).error.code, 'CONFIG_ERROR');
    assert.doesNotMatch(text, /JWT_SECRET/);
    assert.ok(logged.some(l => /JWT_SECRET/.test(l)), 'the reason is in the Worker log');
  } finally {
    console.error = originalError;
  }
});
