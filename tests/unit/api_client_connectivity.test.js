// js/api-client.js connectivity behaviour: base URL, proxy-outage degradation, health classification.

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadClient(fetchImpl, { apiBaseOverride, timers = null, browserEvents = null } = {}) {
  const storage = new Map();
  const ls = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  };
  const events = [];
  const sandbox = {
    console, Date, Math, JSON, URL, URLSearchParams, Error, Number, String, Boolean, Array, Object, Set, Map, Promise,
    setTimeout: timers ? timers.setTimeout : setTimeout,
    clearTimeout: timers ? timers.clearTimeout : clearTimeout,
    AbortController,
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    localStorage: ls,
    sessionStorage: ls,
    fetch: fetchImpl
  };
  sandbox.window = {
    location: { hostname: 'sigma-car.pages.dev', hash: '' },
    dispatchEvent: (e) => { events.push(e); return true; },
    ...(browserEvents ? { addEventListener: (type, fn) => { (browserEvents[type] = browserEvents[type] || []).push(fn); } } : {}),
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
    const online = loadClient(async () => res(200, { success: true, data: { status: 'ok', vehiclesCount: 24 } }, { 'x-request-id': 'req_0123abcd' })).ApiClient;
    assert.strictEqual((await online.checkHealth()).status, 'online');

    const staticHost = loadClient(async () => ({ ok: true, status: 200, headers: headers({ 'content-type': 'text/html' }), json: async () => { throw new Error('html'); } })).ApiClient;
    assert.deepStrictEqual(plain(await staticHost.checkHealth()), { status: 'static-host', code: 'STATIC_HOST_NO_API', httpStatus: 200 });

    const outage = loadClient(async () => res(503, {}, { 'x-sigma-proxy-error': 'BACKEND_NOT_CONFIGURED' })).ApiClient;
    assert.deepStrictEqual(plain(await outage.checkHealth()), { status: 'proxy-outage', code: 'BACKEND_NOT_CONFIGURED', httpStatus: 503 });

    const offline = loadClient(async () => { throw new TypeError('Failed to fetch'); }).ApiClient;
    assert.strictEqual((await offline.checkHealth()).status, 'offline');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Connectivity state: backend availability vs static host vs authentication vs Demo Sandbox
// ---------------------------------------------------------------------------------------------------------------
const API_HEADERS = { 'x-request-id': 'req_0123abcd' };
const apiRes = (status, body, h = {}) => res(status, body, { ...API_HEADERS, ...h });
const healthOk = () => apiRes(200, { success: true, data: { status: 'ok', storageMode: 'd1' } });
const netErr = () => new TypeError('Failed to fetch');
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
function fakeTimers() {
  let id = 0;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => { id += 1; pending.set(id, { fn, ms }); return id; },
    clearTimeout: (t) => { pending.delete(t); },
    delays: () => [...pending.values()].map(p => p.ms),
    async fire(ms) {
      const entry = [...pending.entries()].find(([, p]) => p.ms === ms);
      assert.ok(entry, `no pending timer of ${ms} ms (pending: ${[...pending.values()].map(p => p.ms)})`);
      pending.delete(entry[0]);
      entry[1].fn();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    }
  };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const types = (events) => events.map(e => e.type);

describe('ApiClient connectivity state (static host vs backend availability vs auth vs demo)', () => {
  it('a page load starts "unknown" with no Static Preview flag (refresh resets state)', () => {
    const { ApiClient } = loadClient(async () => healthOk());
    assert.deepStrictEqual([ApiClient.connectivity, ApiClient.staticHostDetected, ApiClient.lastBackendIssue], ['unknown', false, null]);
  });

  it('401 and 403 from the live API mean "online" and never trigger the offline fallback', async () => {
    for (const [status, code] of [[401, 'UNAUTHORIZED'], [403, 'FORBIDDEN']]) {
      const { ApiClient, events } = loadClient(async () => apiRes(status, { success: false, error: { code, message: 'x' } }, { 'x-sigma-proxy': '1' }));
      await assert.rejects(() => ApiClient.request('/cart'), (err) => err.status === status && err.code === code);
      assert.deepStrictEqual([ApiClient.connectivity, ApiClient.staticHostDetected, ApiClient.lastBackendIssue], ['online', false, null]);
      assert.ok(!types(events).includes('sigmacar:static-host-detected'));
      assert.strictEqual(ApiClient.isDemoMode(), false);
    }
  });

  it('arbitrary or malformed JSON is not proof of availability (API contract required)', async () => {
    // captive portal / unrelated JSON without the envelope
    let c = loadClient(async () => apiRes(200, { ok: true })).ApiClient;
    await c.request('/vehicles');
    assert.strictEqual(c.connectivity, 'unknown');
    // envelope but no X-Request-Id / proxy marker (not from our backend)
    c = loadClient(async () => res(200, { success: true, data: [] })).ApiClient;
    await c.request('/vehicles');
    assert.strictEqual(c.connectivity, 'unknown');
    // error envelope with an invalid code shape
    c = loadClient(async () => apiRes(400, { success: false, error: { code: 'not a code' } })).ApiClient;
    await assert.rejects(() => c.request('/vehicles'));
    assert.strictEqual(c.connectivity, 'unknown');
    // body that is not JSON at all with a 500
    c = loadClient(async () => ({ ok: false, status: 500, headers: headers({ 'content-type': 'application/json' }), text: async () => '{oops' })).ApiClient;
    await assert.rejects(() => c.request('/vehicles'), (err) => err.code === 'INVALID_SERVER_RESPONSE');
    assert.deepStrictEqual([c.connectivity, c.staticHostDetected], ['unknown', false]);
    // health: HTTP 200 alone (no {status:'ok'}) or without API markers is not "online"
    c = loadClient(async () => apiRes(200, { success: true, data: { status: 'starting' } })).ApiClient;
    assert.strictEqual((await c.checkHealth()).status, 'error');
    c = loadClient(async () => res(200, { success: true, data: { status: 'ok' } })).ApiClient;
    assert.deepStrictEqual(plain(await c.checkHealth()), { status: 'error', code: 'UNVERIFIED_HEALTH_RESPONSE', httpStatus: 200 });
  });

  it('network error gives "offline" with a recorded reason (not Static Preview); the next API answer recovers it', async () => {
    let fail = true;
    const { ApiClient, events } = loadClient(async () => { if (fail) throw netErr(); return apiRes(200, { success: true, data: [{ id: 'live' }] }); });
    const list = await ApiClient.vehicles.getAll();
    assert.ok(list.length > 0, 'public reads keep the bundled catalog while offline');
    assert.deepStrictEqual([ApiClient.connectivity, ApiClient.staticHostDetected, plain(ApiClient.lastBackendIssue)], ['offline', false, { code: 'NETWORK_ERROR' }]);
    await assert.rejects(() => ApiClient.auth.login({ email: 'a@b.c', password: 'x' }), (err) => err.code === 'BACKEND_UNAVAILABLE');
    fail = false;
    const live = await ApiClient.vehicles.getAll();
    assert.deepStrictEqual(Array.from(live, v => v.id), ['live']);
    assert.deepStrictEqual([ApiClient.connectivity, ApiClient.staticHostDetected, ApiClient.lastBackendIssue], ['online', false, null]);
    assert.ok(types(events).includes('sigmacar:backend-online'));
    assert.ok(types(events).filter(t => t === 'sigmacar:connectivity-changed').length >= 2);
    assert.strictEqual(ApiClient.isDemoMode(), false, 'Demo Sandbox is never enabled automatically');
  });

  it('a programming TypeError is thrown, not mistaken for "offline"', async () => {
    const { ApiClient } = loadClient(async () => { throw new TypeError('Cannot read properties of undefined'); });
    await assert.rejects(() => ApiClient.request('/vehicles'), (err) => /Cannot read properties/.test(err.message));
    assert.deepStrictEqual([ApiClient.connectivity, ApiClient.staticHostDetected], ['unknown', false]);
  });

  it('timeout gives a REQUEST_TIMEOUT error + offline; a caller-cancelled request is not an outage', async () => {
    const hang = (url, opts) => new Promise((_, reject) => {
      if (opts && opts.signal) opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const { ApiClient } = loadClient(hang);
    await assert.rejects(() => ApiClient.request('/vehicles', { timeoutMs: 20 }), (err) => err.code === 'REQUEST_TIMEOUT' && err.status === 504);
    assert.deepStrictEqual([ApiClient.connectivity, plain(ApiClient.lastBackendIssue)], ['offline', { code: 'REQUEST_TIMEOUT' }]);

    const c2 = loadClient(hang).ApiClient;
    const ctl = new AbortController();
    const p = c2.request('/vehicles', { signal: ctl.signal, timeoutMs: 5000 });
    ctl.abort();
    await assert.rejects(() => p);
    assert.strictEqual(c2.connectivity, 'unknown', 'navigation/caller abort says nothing about the backend');
  });

  it('a stale failed request cannot overwrite a newer confirmed online state', async () => {
    const slow = deferred();
    let n = 0;
    const { ApiClient } = loadClient(async () => { n += 1; return n === 1 ? slow.promise : apiRes(200, { success: true, data: [] }); });
    const older = ApiClient.request('/vehicles?a=1');
    await ApiClient.request('/vehicles?b=2');
    assert.strictEqual(ApiClient.connectivity, 'online');
    slow.reject(netErr());
    await older; // served from the static catalog
    assert.deepStrictEqual([ApiClient.connectivity, ApiClient.lastBackendIssue], ['online', null]);
  });

  it('concurrent requests: the latest-started observation wins in both directions', async () => {
    const a = deferred();
    const b = deferred();
    const queue = [a, b];
    const { ApiClient } = loadClient(async () => queue.shift().promise);
    const pa = ApiClient.request('/vehicles?a=1');
    const pb = ApiClient.request('/vehicles?b=2');
    b.reject(netErr()); // newer request fails first
    await pb;
    assert.strictEqual(ApiClient.connectivity, 'offline');
    a.resolve(apiRes(200, { success: true, data: [] })); // older request succeeds afterwards: stale
    await pa;
    assert.strictEqual(ApiClient.connectivity, 'offline', 'stale success does not hide a newer failure; the health retry decides');
  });

  it('an older health check cannot overwrite a newer confirmed online state', async () => {
    const health = deferred();
    const { ApiClient } = loadClient(async (url) => (String(url).endsWith('/health') ? health.promise : apiRes(200, { success: true, data: [] })));
    const probe = ApiClient.verifyConnectivity();
    assert.strictEqual(ApiClient.verifyConnectivity(), probe, 'concurrent probes share one request');
    await ApiClient.request('/vehicles');
    assert.strictEqual(ApiClient.connectivity, 'online');
    health.reject(netErr());
    await probe;
    assert.deepStrictEqual([ApiClient.connectivity, ApiClient.lastBackendIssue], ['online', null]);
    assert.strictEqual(ApiClient._healthInFlight, null);
  });

  it('retry/backoff: one timer at a time, 5 s, 10 s, ... capped at 60 s, stops on recovery', async () => {
    const timers = fakeTimers();
    const browserEvents = {};
    let healthy = false;
    let healthCalls = 0;
    const { ApiClient } = loadClient(async (url) => {
      if (String(url).endsWith('/health')) { healthCalls += 1; if (!healthy) throw netErr(); return healthOk(); }
      throw netErr();
    }, { timers, browserEvents });
    assert.strictEqual(ApiClient._connInit, true, 'browser bootstrap initialises connectivity when api-client.js loads');
    assert.strictEqual(ApiClient.initConnectivity(), false, 'initialised once (no duplicate listeners / timers)');
    assert.deepStrictEqual(Object.keys(browserEvents).sort(), ['offline', 'online']);
    assert.strictEqual(browserEvents.online.length, 1);
    await ApiClient.request('/vehicles');
    await ApiClient.request('/vehicles/certified');
    assert.deepStrictEqual(timers.delays().sort((x, y) => x - y), [2500, 5000], 'startup probe + a single retry timer');
    await timers.fire(2500); // startup probe skipped: state already decided
    assert.strictEqual(healthCalls, 0);
    const seen = [];
    for (const ms of [5000, 10000, 20000, 40000, 60000, 60000]) {
      await timers.fire(ms);
      await flush();
      seen.push(ms);
      assert.strictEqual(timers.delays().length, 1, `exactly one pending retry after ${ms} ms`);
    }
    assert.strictEqual(healthCalls, seen.length);
    healthy = true;
    await timers.fire(60000);
    await flush();
    assert.deepStrictEqual([ApiClient.connectivity, timers.delays().length, ApiClient._retryTimer, ApiClient._retryDelayMs], ['online', 0, null, 0]);
    ApiClient.stopConnectivity();
  });

  it('browser online / offline events: offline is shown at once, online re-checks immediately and recovers', async () => {
    const timers = fakeTimers();
    const browserEvents = {};
    let healthy = false;
    const { ApiClient, events } = loadClient(async () => { if (!healthy) throw netErr(); return healthOk(); }, { timers, browserEvents });
    browserEvents.offline.forEach(fn => fn());
    assert.deepStrictEqual([ApiClient.connectivity, plain(ApiClient.lastBackendIssue), ApiClient.staticHostDetected], ['offline', { code: 'BROWSER_OFFLINE' }, false]);
    assert.ok(timers.delays().includes(5000));
    healthy = true;
    browserEvents.online.forEach(fn => fn());
    await flush();
    assert.strictEqual(ApiClient.connectivity, 'online');
    assert.ok(!timers.delays().includes(5000), 'retry timer cleared on recovery');
    assert.ok(types(events).includes('sigmacar:backend-online'));
    ApiClient.stopConnectivity();
  });

  it('real static host / proxy outage still show Static Preview, and clear when a health check confirms the API', async () => {
    let mode = 'html';
    const { ApiClient, events } = loadClient(async () => {
      if (mode === 'html') return { ok: true, status: 200, headers: headers({ 'content-type': 'text/html' }), text: async () => '<html>', json: async () => { throw new Error('html'); } };
      return healthOk();
    });
    await ApiClient.vehicles.getAll();
    assert.deepStrictEqual([ApiClient.connectivity, ApiClient.staticHostDetected, ApiClient.lastBackendIssue.code], ['static-host', true, 'STATIC_HOST_NO_API']);
    assert.ok(types(events).includes('sigmacar:static-host-detected'));
    mode = 'api';
    await ApiClient.verifyConnectivity();
    assert.deepStrictEqual([ApiClient.connectivity, ApiClient.staticHostDetected, ApiClient.lastBackendIssue], ['online', false, null]);
  });

  it('opting into Demo Sandbox does not flag a static host; leaving it shows no stale banner state', async () => {
    let calls = 0;
    const { ApiClient } = loadClient(async () => { calls += 1; return apiRes(200, { success: true, data: [] }); });
    ApiClient.setDemoMode(true);
    await ApiClient.vehicles.getAll();
    assert.strictEqual(calls, 0, 'demo reads are local');
    assert.deepStrictEqual([ApiClient.staticHostDetected, ApiClient.connectivity], [false, 'unknown']);
    ApiClient.setDemoMode(false);
    await ApiClient.vehicles.getAll();
    assert.deepStrictEqual([ApiClient.staticHostDetected, ApiClient.connectivity], [false, 'online']);
  });
});
