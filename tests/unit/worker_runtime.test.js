// tests/unit/worker_runtime.test.js
// The Cloudflare Worker request handler (backend/cloudflare/runtime.js) run under Node against the D1 test shim:
// Worker-specific behaviour that the shared integration suites do not cover (npm run test:worker-runtime covers those).

process.env.JWT_SECRET = process.env.JWT_SECRET || 'sigmacar-isolated-test-suite-secret-key-2026-min-32-chars';

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { D1SqliteShim } = require('../helpers/d1-sqlite-shim');
const runtime = require('../../backend/cloudflare/runtime');
const shimHttp = require('../../backend/cloudflare/node-http-shim');

const BASE = 'https://sigma-car.pages.dev';
let shim;
let env;

async function call(pathname, { method = 'GET', body, token, headers = {} } = {}) {
  const h = new Headers(headers);
  if (body !== undefined) h.set('Content-Type', 'application/json');
  if (token) h.set('Authorization', `Bearer ${token}`);
  if (!h.has('cf-connecting-ip')) h.set('cf-connecting-ip', '198.51.100.7');
  const res = await runtime.handle(new Request(BASE + pathname, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }), env);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { /* binary */ }
  return { status: res.status, headers: res.headers, data, text };
}

async function login(email, password) {
  const r = await call('/api/v1/auth/login', { method: 'POST', body: { email, password } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  return r.data.data.token;
}

before(async () => {
  shim = new D1SqliteShim();
  env = { DB: shim };
});

describe('Worker runtime: platform edges', () => {
  it('answers 503 STORAGE_NOT_CONFIGURED (JSON) when the D1 binding is missing', async () => {
    const res = await runtime.handle(new Request(`${BASE}/api/v1/vehicles`), {});
    assert.strictEqual(res.status, 503);
    assert.strictEqual((await res.json()).error.code, 'STORAGE_NOT_CONFIGURED');
  });

  it('serves only /api/v1/* (JSON 404 elsewhere)', async () => {
    const r = await call('/index.html');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.data.error.code, 'ROUTE_NOT_FOUND');
  });

  it('dev-seeds the empty D1 database on first use and reports the d1 storage mode', async () => {
    const r = await call('/api/v1/health');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.data.storageMode, 'd1');
    assert.strictEqual(r.data.data.vehiclesCount, 24);
    assert.ok(shim.db.prepare("SELECT COUNT(*) n FROM state_documents WHERE collection = 'users'").get().n >= 4);
  });

  it('sends the same CORS / security headers as server.js and answers OPTIONS with 204', async () => {
    const pre = await call('/api/v1/cart', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } });
    assert.strictEqual(pre.status, 204);
    assert.strictEqual(pre.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    assert.match(pre.headers.get('access-control-allow-methods'), /PATCH/);
    const r = await call('/api/v1/vehicles/certified');
    for (const [h, v] of [['x-content-type-options', 'nosniff'], ['x-frame-options', 'DENY'], ['referrer-policy', 'strict-origin-when-cross-origin'], ['cache-control', 'no-store']]) {
      assert.strictEqual(r.headers.get(h), v, h);
    }
    assert.match(r.headers.get('permissions-policy'), /camera=\(self\)/);
    assert.match(r.headers.get('x-request-id'), /^req_[0-9a-f]{12}$/);
  });

  it('keeps the request-body limits and JSON validation of middleware.js', async () => {
    const bad = await call('/api/v1/auth/login', { method: 'POST', body: '{not json' });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.data.error.code, 'BAD_JSON');
    const big = await call('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 10) }) });
    assert.strictEqual(big.status, 413);
    assert.strictEqual(big.data.error.code, 'PAYLOAD_TOO_LARGE');
  });

  it('uses the optional Rate Limiting binding (cross-isolate, per location) with the same 429 contract', async () => {
    const limited = { ...env, API_RATE_LIMITER: { limit: async ({ key }) => ({ success: key !== '203.0.113.66' }) } };
    const blocked = await runtime.handle(new Request(`${BASE}/api/v1/vehicles`, { headers: { 'cf-connecting-ip': '203.0.113.66' } }), limited);
    assert.strictEqual(blocked.status, 429);
    assert.strictEqual((await blocked.json()).error.code, 'RATE_LIMITED');
    const ok = await runtime.handle(new Request(`${BASE}/api/v1/vehicles`, { headers: { 'cf-connecting-ip': '203.0.113.67' } }), limited);
    assert.strictEqual(ok.status, 200);
  });

  it('returns a fixed 503 STORAGE_UNAVAILABLE (no driver details) when D1 fails', async () => {
    shim.failNext(1, 'D1 internal error: SELECT rev FROM state_revision');
    const r = await call('/api/v1/vehicles');
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.data.error.code, 'STORAGE_UNAVAILABLE');
    assert.doesNotMatch(r.text, /SELECT|state_revision|D1/);
    assert.strictEqual((await call('/api/v1/vehicles')).status, 200, 'recovers on the next request');
  });
});

describe('Worker runtime: data written through the API lives in D1', () => {
  it('commerce writes (register → login → cart) are committed to D1 rows', async () => {
    const email = `worker.${Date.now()}@example.com`;
    const reg = await call('/api/v1/auth/register', { method: 'POST', body: { email, password: 'Worker@123456', fullName: 'Worker Test', phone: '0901234567' } });
    assert.strictEqual(reg.status, 201, JSON.stringify(reg.data));
    const token = await login(email, 'Worker@123456');
    const add = await call('/api/v1/cart/items', { method: 'POST', token, body: { itemType: 'vehicle', itemId: 'vinfast-vf9', quantity: 1 } });
    assert.strictEqual(add.status, 201, JSON.stringify(add.data));
    const userRow = shim.db.prepare("SELECT doc FROM state_documents WHERE collection = 'users' AND lower(json_extract(doc, '$.email')) = ?").get(email);
    assert.ok(userRow, 'user row in D1');
    const user = JSON.parse(userRow.doc);
    assert.match(user.passwordHash, /^[0-9a-f]{32}:[0-9a-f]{128}$/, 'scrypt salt:key format unchanged');
    const cart = shim.db.prepare("SELECT doc FROM state_documents WHERE collection = 'carts' AND json_extract(doc, '$.userId') = ?").get(user.id);
    assert.strictEqual(JSON.parse(cart.doc).items[0].itemId, 'vinfast-vf9');
  });

  it('private media bytes go to the D1 media_blobs table, not to the file system', async () => {
    const token = await login('minhhoang.sigma@example.com', 'Buyer@123456');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600 * 1024, 7)]);
    const up = await call('/api/v1/media/upload', { method: 'POST', token, body: { fileName: 'proof.png', mimeType: 'image/png', dataBase64: png.toString('base64'), purpose: 'return_evidence' } });
    assert.strictEqual(up.status, 201, JSON.stringify(up.data));
    const id = up.data.data.id;
    assert.strictEqual(shim.db.prepare('SELECT COUNT(*) n FROM media_blobs').get().n, 2, '600 KiB → two 512 KiB chunks');
    const res = await runtime.handle(new Request(`${BASE}/api/v1/media/${id}`, { headers: { Authorization: `Bearer ${token}`, 'cf-connecting-ip': '198.51.100.7' } }), env);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'image/png');
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(png));
    assert.ok(!fs.existsSync(path.join(__dirname, '..', '..', 'data', 'runtime_media', `${id}.png`)));
  });

  it('AR manifest: same USDZ list as the Pages static snapshot (hostable files only)', async () => {
    const cyber = (await call('/api/v1/vehicles/tesla-cybertruck/ar-manifest')).data.data;
    assert.ok(cyber.appleAr.usdz.length > 0);
    assert.ok(cyber.appleAr.usdz.every(u => /^assets\/models\/usdz\/tesla-cybertruck\/.+\.usdz\?v=[0-9a-f]{12}$/.test(u.url) && u.bytes <= 25 * 1024 * 1024));
    const vf9 = (await call('/api/v1/vehicles/vinfast-vf9/ar-manifest')).data.data;
    assert.deepStrictEqual(vf9.appleAr.usdz, []);
    assert.strictEqual(vf9.appleAr.onDeviceConversion, true);
    // byte-identical to what scripts/build_dist.js publishes for Pages
    const ArManifestService = require('../../backend/application/ar-manifest-service');
    const StorageEngine = require('../../backend/infrastructure/storage-engine');
    const v = StorageEngine.dbState.vehicles.find(x => x.id === 'tesla-cybertruck');
    assert.deepStrictEqual(cyber, JSON.parse(JSON.stringify(ArManifestService.buildArManifest(v, { staticHostOnly: true }))));
  });
});

describe('node-http-shim', () => {
  it('merges writeHead headers over setHeader ones and drops framing headers', async () => {
    const res = shimHttp.createNodeResponse();
    res.setHeader('X-A', '1');
    res.setHeader('Content-Type', 'text/plain');
    res.writeHead(201, { 'Content-Type': 'application/json', 'Content-Length': 3 });
    res.end('abc');
    const out = await res.done;
    assert.strictEqual(out.status, 201);
    assert.deepStrictEqual(Object.fromEntries(out.headers), { 'X-A': '1', 'Content-Type': 'application/json' });
    assert.strictEqual(out.body.toString(), 'abc');
    assert.throws(() => res.setHeader('X-B', '2'), (e) => e.code === 'ERR_HTTP_HEADERS_SENT');
  });

  it('streams the body to data/end listeners attached later, as parseBody expects', async () => {
    const req = shimHttp.createNodeRequest({ method: 'post', url: '/x', headers: {}, body: Buffer.from('{"a":1}') });
    await new Promise(r => setTimeout(r, 5));
    const chunks = [];
    await new Promise((resolve) => {
      req.on('data', c => chunks.push(c));
      req.on('end', resolve);
    });
    assert.strictEqual(Buffer.concat(chunks).toString(), '{"a":1}');
    assert.strictEqual(req.method, 'POST');
  });
});
