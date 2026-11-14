// js/api-client.js connectivity behaviour: base URL, proxy-outage degradation, health classification.

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadClient(fetchImpl, { apiBaseOverride } = {}) {
  const storage = new Map();
  const ls = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  };
  const events = [];
  const sandbox = {
    console, Date, Math, JSON, URL, URLSearchParams, Error, Number, String, Boolean, Array, Object, Set, Map, Promise,
    setTimeout, clearTimeout, AbortController,
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    localStorage: ls,
    sessionStorage: ls,
    fetch: fetchImpl
  };
  sandbox.window = {
    location: { hostname: 'sigma-car.pages.dev', hash: '' },
    dispatchEvent: (e) => { events.push(e); return true; },
    SIGMACAR_API_BASE: apiBaseOverride
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const root = path.resolve(__dirname, '..', '..');
  for (const rel of ['js/data.js', 'js/static-sandbox.js', 'js/api-client.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
  }
  return { ApiClient: vm.runInContext('ApiClient', sandbox), events };
}

// Objects created inside the vm context have a different Object.prototype; compare plain copies.
const plain = (o) => JSON.parse(JSON.stringify(o));
const headers = (map) => ({ get: (n) => map[String(n).toLowerCase()] ?? null });
const res = (status, body, h = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: headers({ 'content-type': 'application/json; charset=utf-8', ...h }),
  text: async () => JSON.stringify(body),
  json: async () => body
});

describe('ApiClient connectivity', () => {
  it('uses same-origin /api/v1 by default and honours window.SIGMACAR_API_BASE', () => {
    assert.strictEqual(loadClient(async () => res(200, {})).ApiClient.getApiBase(), '/api/v1');
    assert.strictEqual(loadClient(async () => res(200, {}), { apiBaseOverride: 'https://api.example.test/api/v1' }).ApiClient.getApiBase(), 'https://api.example.test/api/v1');
  });

  it('returns live JSON when the backend answers through the proxy', async () => {
    const urls = [];
    const { ApiClient } = loadClient(async (url) => {
      urls.push(url);
      return res(200, { success: true, data: [{ id: 'live-car' }] }, { 'x-sigma-proxy': '1' });
    });
    const list = await ApiClient.vehicles.getAll();
    assert.deepStrictEqual(Array.from(list, v => v.id), ['live-car']);
    assert.ok(urls[0].startsWith('/api/v1/vehicles'));
    assert.strictEqual(ApiClient.staticHostDetected, false);
  });

  it('degrades public reads to the bundled catalog when the proxy reports BACKEND_UNREACHABLE', async () => {
    const { ApiClient, events } = loadClient(async () => res(502, { success: false, error: { code: 'BACKEND_UNREACHABLE' } }, { 'x-sigma-proxy-error': 'BACKEND_UNREACHABLE' }));
    const list = await ApiClient.vehicles.getAll();
    assert.ok(list.length > 0, 'static catalog must be served read-only');
    assert.strictEqual(ApiClient.lastBackendIssue.code, 'BACKEND_UNREACHABLE');
    assert.ok(events.some(e => e.type === 'sigmacar:static-host-detected'));

    await assert.rejects(
      () => ApiClient.auth.login({ email: 'a@b.c', password: 'x' }),
      (err) => err.code === 'BACKEND_UNAVAILABLE' && err.status === 503,
      'writes must fail loudly, never fake success outside Demo Sandbox'
    );
  });

  it('does NOT mask real API errors (e.g. 401/409 from the live backend) as outages', async () => {
    const { ApiClient } = loadClient(async () => res(409, { success: false, error: { code: 'CART_VERSION_CONFLICT', message: 'conflict' } }));
    await assert.rejects(() => ApiClient.request('/cart', { method: 'PATCH', body: '{}' }), (err) => err.status === 409 && err.code === 'CART_VERSION_CONFLICT');
    assert.strictEqual(ApiClient.staticHostDetected, false);
  });

  it('checkHealth classifies online / static-host / proxy-outage / offline', async () => {
    const online = loadClient(async () => res(200, { success: true, data: { status: 'ok', vehiclesCount: 24 } })).ApiClient;
    assert.strictEqual((await online.checkHealth()).status, 'online');

    const staticHost = loadClient(async () => ({ ok: true, status: 200, headers: headers({ 'content-type': 'text/html' }), json: async () => { throw new Error('html'); } })).ApiClient;
    assert.deepStrictEqual(plain(await staticHost.checkHealth()), { status: 'static-host', code: 'STATIC_HOST_NO_API', httpStatus: 200 });

    const outage = loadClient(async () => res(503, {}, { 'x-sigma-proxy-error': 'BACKEND_NOT_CONFIGURED' })).ApiClient;
    assert.deepStrictEqual(plain(await outage.checkHealth()), { status: 'proxy-outage', code: 'BACKEND_NOT_CONFIGURED', httpStatus: 503 });

    const offline = loadClient(async () => { throw new TypeError('Failed to fetch'); }).ApiClient;
    assert.strictEqual((await offline.checkHealth()).status, 'offline');
  });
});
