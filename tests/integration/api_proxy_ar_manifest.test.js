// End-to-end: Cloudflare Pages Function proxy → real SIGMACAR backend (ephemeral server.js),
// backend proxy-secret enforcement, and GET /api/v1/vehicles/:id/ar-manifest.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { startTestServer } = require('../helpers/test-app');

const ROOT = path.resolve(__dirname, '..', '..');
const PROXY_FILE = pathToFileURL(path.join(ROOT, 'functions', 'api', 'v1', '[[path]].js')).href;

describe('API connectivity through the Pages Function proxy', () => {
  let app;
  let origin;
  let proxy;

  before(async () => {
    app = await startTestServer({ mode: 'memory', reseed: true });
    origin = new URL(app.baseUrl).origin;
    proxy = await import(PROXY_FILE);
  });

  after(async () => {
    if (app) await app.close();
  });

  const viaProxy = (pathAndQuery, init) => proxy.handleProxy(
    new Request(`https://sigma-car.pages.dev${pathAndQuery}`, init),
    { SIGMA_BACKEND_ORIGIN: origin, SIGMA_BACKEND_ALLOW_HTTP: 'true' }
  );

  it('GET /api/v1/health and /api/v1/vehicles return JSON from the real backend (not index.html)', async () => {
    const health = await viaProxy('/api/v1/health');
    assert.strictEqual(health.status, 200);
    assert.match(health.headers.get('content-type'), /application\/json/);
    assert.strictEqual((await health.json()).data.status, 'ok');

    const vehicles = await viaProxy('/api/v1/vehicles?page=1&pageSize=5');
    assert.strictEqual(vehicles.status, 200);
    const body = await vehicles.json();
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data) && body.data.length > 0);
    assert.strictEqual(body.pagination.pageSize, 5, 'query string must be forwarded');
  });

  it('POST login and an authenticated GET work end-to-end through the proxy', async () => {
    const login = await viaProxy('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'minhhoang.sigma@example.com', password: 'Buyer@123456' })
    });
    assert.strictEqual(login.status, 200);
    const { data } = await login.json();
    assert.ok(data.token);

    const me = await viaProxy('/api/v1/auth/me', { headers: { Authorization: `Bearer ${data.token}` } });
    assert.strictEqual(me.status, 200);
    assert.strictEqual((await me.json()).data.email, 'minhhoang.sigma@example.com');

    const anon = await viaProxy('/api/v1/auth/me');
    assert.strictEqual(anon.status, 401, 'auth errors must pass through unchanged');
  });

  it('cart endpoint responds with JSON through the proxy (guest)', async () => {
    const cart = await viaProxy('/api/v1/cart');
    assert.match(cart.headers.get('content-type'), /application\/json/);
    assert.ok([200, 401].includes(cart.status), `unexpected ${cart.status}`);
  });

  it('GET /api/v1/vehicles/:id/ar-manifest returns a capability-accurate manifest', async () => {
    const res = await viaProxy('/api/v1/vehicles/tesla-cybertruck/ar-manifest');
    assert.strictEqual(res.status, 200);
    const m = (await res.json()).data;
    assert.strictEqual(m.schemaVersion, 1);
    assert.strictEqual(m.vehicleId, 'tesla-cybertruck');
    assert.strictEqual(m.model.glbUrl, 'assets/models/ar/tesla_cybertruck_ar_v1.glb');
    assert.strictEqual(m.model.scaleMode, 'certified');
    assert.strictEqual(m.model.dimensionsMeters.length, 5.682);
    assert.deepStrictEqual(m.materials.body, ['Material_Body']);
    assert.deepStrictEqual(m.materials.rims, ['Material_Rims']);
    assert.strictEqual(m.variants.length, 4);
    assert.strictEqual(m.features.changeColor, true);
    assert.strictEqual(m.features.changeWheels, true);
    assert.strictEqual(m.features.doorAnimations, false, 'no GLB contains door clips');
    assert.strictEqual(m.features.quickLook, false, 'no USDZ asset exists');
    assert.ok(m.hotspots.length > 0);
    // showroom (4.4 m frame) → metres: x=1.2 * (5.682/4.4)
    assert.ok(Math.abs(m.hotspots[0].position[0] - 1.2 * (5.682 / 4.4)) < 0.002);
  });

  it('reports unknown vehicles and unbound paint honestly', async () => {
    const missing = await viaProxy('/api/v1/vehicles/does-not-exist/ar-manifest');
    assert.strictEqual(missing.status, 404);

    // ferrari-f50-1995: bindings found no paint material → colour change must be disabled, not faked
    const ferrari = await (await viaProxy('/api/v1/vehicles/ferrari-f50-1995/ar-manifest')).json();
    assert.strictEqual(ferrari.data.features.changeColor, false);
    assert.strictEqual(ferrari.data.model.scaleMode, 'fit-to-length');
  });
});

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

describe('Backend proxy-secret enforcement (PROXY_SHARED_SECRET)', () => {
  let child;
  let base;
  const SECRET = 'proxy-secret-for-tests-0123456789abcdef';

  let tmpDir;

  before(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    tmpDir = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'sigmacar-proxy-secret-'));
    child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        // Isolated store: never touch data/sigmacar_store.json (SIGMACAR_DATA_FILE is honoured since the config fix)
        SIGMACAR_DATA_FILE: path.join(tmpDir, 'store.json'),
        NODE_ENV: 'development',
        JWT_SECRET: 'sigmacar-isolated-test-suite-secret-key-2026-min-32-chars',
        PROXY_SHARED_SECRET: SECRET,
        RATE_LIMIT_MAX_REQUESTS_PER_MINUTE: '3'
      },
      stdio: 'ignore'
    });
    for (let i = 0; i < 50; i++) {
      try {
        const r = await fetch(`${base}/api/v1/health`);
        if (r.ok) return;
      } catch (_) {}
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('backend did not start');
  });

  after(async () => {
    if (child) {
      const exited = new Promise(r => child.once('exit', r));
      child.kill();
      await exited;
    }
    if (tmpDir) require('fs').rmSync(tmpDir, { recursive: true, force: true });
  });

  it('honours SIGMACAR_DATA_FILE (store written to the configured path, not the repo)', () => {
    assert.ok(require('fs').existsSync(path.join(tmpDir, 'store.json')));
  });

  it('allows the health probe without the secret (platform health checks)', async () => {
    assert.strictEqual((await fetch(`${base}/api/v1/health`)).status, 200);
  });

  it('rejects direct API calls that bypass the proxy with 403 PROXY_SECRET_REQUIRED', async () => {
    const r = await fetch(`${base}/api/v1/vehicles`);
    assert.strictEqual(r.status, 403);
    assert.strictEqual((await r.json()).error.code, 'PROXY_SECRET_REQUIRED');
    const forged = await fetch(`${base}/api/v1/vehicles`, { headers: { 'X-Sigma-Proxy-Secret': 'wrong' } });
    assert.strictEqual(forged.status, 403);
  });

  it('rate-limits per forwarded client IP (not per proxy IP) for proxied requests', async () => {
    const call = (ip) => fetch(`${base}/api/v1/vehicles/certified`, { headers: { 'X-Sigma-Proxy-Secret': SECRET, 'CF-Connecting-IP': ip } });
    const a = [];
    for (let i = 0; i < 4; i++) a.push((await call('198.51.100.1')).status);
    assert.deepStrictEqual(a, [200, 200, 200, 429], 'client A exhausts its own bucket');
    assert.strictEqual((await call('198.51.100.2')).status, 200, 'client B is unaffected');
  });
});
