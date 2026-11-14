// tests/unit/workers_free_plan.test.js
// Cloudflare Workers Free / D1 Free compatibility checks for the API Worker (docs/CLOUDFLARE_FREE_PLAN.md).
// Runs the real Worker handler (backend/cloudflare/runtime.js) against the node:sqlite D1 shim, instrumented to count
// D1 queries and rows per request. Deterministic limits are asserted; CPU is measured as an estimate (wall time minus
// time inside the SQLite shim) and asserted only with WORKERS_FREE_CPU_STRICT=1 (machine-dependent).

process.env.JWT_SECRET = process.env.JWT_SECRET || 'sigmacar-isolated-test-suite-secret-key-2026-min-32-chars';

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { D1SqliteShim } = require('../helpers/d1-sqlite-shim');
const tool = require('../../scripts/d1/json-to-d1');

const ROOT = path.join(__dirname, '..', '..');
const FREE = { cpuMs: 10, d1QueriesPerInvocation: 50 };
const STRICT_CPU = process.env.WORKERS_FREE_CPU_STRICT === '1';

// D1 binding instrumentation: queries (each statement call, each batch = 1, as D1 counts them), rows, time.
function instrument(shim) {
  const m = { queries: 0, rowsRead: 0, rowsWritten: 0, ns: 0n };
  const timeIt = async (fn) => { const t = process.hrtime.bigint(); try { return await fn(); } finally { m.ns += process.hrtime.bigint() - t; } };
  const account = (res) => {
    for (const r of Array.isArray(res) ? res : [res]) {
      if (r && Array.isArray(r.results)) m.rowsRead += r.results.length;
      if (r && r.meta && r.meta.changes) m.rowsWritten += r.meta.changes;
    }
    return res;
  };
  const batch = shim.batch.bind(shim);
  shim.batch = (s) => { m.queries += 1; return timeIt(() => batch(s)).then(account); };
  const prepare = shim.prepare.bind(shim);
  shim.prepare = (sql) => {
    const wrap = (st) => {
      for (const k of ['all', 'run', 'raw']) { const f = st[k].bind(st); st[k] = (...a) => { m.queries += 1; return timeIt(() => f(...a)).then(account); }; }
      const first = st.first.bind(st);
      st.first = (...a) => { m.queries += 1; m.rowsRead += 1; return timeIt(() => first(...a)); };
      const bind = st.bind.bind(st);
      st.bind = (...a) => wrap(bind(...a));
      return st;
    };
    return wrap(prepare(sql));
  };
  m.reset = () => { m.queries = 0; m.rowsRead = 0; m.rowsWritten = 0; m.ns = 0n; };
  return m;
}

let runtime;
let env;
let meter;
const report = [];

async function call(label, method, p, { body, token, hashing = false } = {}) {
  const h = { 'cf-connecting-ip': '198.51.100.20' };
  if (body) h['content-type'] = 'application/json';
  if (token) h.authorization = `Bearer ${token}`;
  meter.reset();
  const t = process.hrtime.bigint();
  const res = await runtime.handle(new Request(`https://sigma-car.pages.dev${p}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env);
  const text = await res.text();
  const wallMs = Number(process.hrtime.bigint() - t) / 1e6;
  const cpuEstimate = wallMs - Number(meter.ns) / 1e6;
  const row = { label, status: res.status, queries: meter.queries, rowsRead: meter.rowsRead, rowsWritten: meter.rowsWritten, cpuEstimate, hashing };
  report.push(row);
  assert.ok(row.queries <= FREE.d1QueriesPerInvocation, `${label}: ${row.queries} D1 queries > ${FREE.d1QueriesPerInvocation} (Free)`);
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* non-JSON */ }
  return { ...row, json };
}

before(async () => {
  // Production-like data: the repository snapshot imported with the real tool (password hashes precomputed — no
  // hashing at import or startup), then the Worker started from it.
  const shim = new D1SqliteShim();
  const src = tool.loadNormalisedSource(path.join(ROOT, 'data', 'sigmacar_store.json'));
  shim.db.exec(tool.buildSql(tool.rowsOf(src.state), { id: 'free-test', sourceSha: src.sha256, mode: 'full', summary: {}, nowIso: new Date().toISOString() }));
  meter = instrument(shim);
  runtime = require('../../backend/cloudflare/runtime');
  env = { DB: shim, SIGMACAR_ALLOW_DEV_SEED: 'false' };
});

describe('Workers Free: startup and configuration', () => {
  it('evaluates the whole backend at startup without touching D1 (cost moves out of the first request)', () => {
    meter.reset();
    const modules = runtime.preload();
    assert.ok(modules.handleApiRequest && modules.StorageEngine && modules.AIService);
    assert.strictEqual(meter.queries, 0);
  });

  it('wrangler.api.toml uses no paid-only settings and never dev-seeds remote databases', () => {
    const toml = fs.readFileSync(path.join(ROOT, 'wrangler.api.toml'), 'utf8');
    const active = toml.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
    assert.doesNotMatch(active, /^\s*\[limits\]|cpu_ms|usage_model/m, 'CPU limits / usage model are paid-plan settings');
    assert.match(active, /compatibility_flags = \["nodejs_compat"\]/);
    for (const envName of ['staging', 'production']) {
      const section = active.split(`[env.${envName}.vars]`)[1].split('[[')[0];
      assert.match(section, /SIGMACAR_ALLOW_DEV_SEED = "false"/, `${envName}: dev seed (3 scrypt hashes in one request) must be off`);
    }
  });

  it('password hashing strength is unchanged (scrypt N=16384, r=8, p=1, 64-byte key, 16-byte random salt)', async () => {
    const Security = require('../../backend/infrastructure/security');
    const stored = await Security.hashPassword('Free-plan-check-123');
    const [salt, key] = stored.split(':');
    assert.strictEqual(salt.length, 32);
    assert.strictEqual(key, crypto.scryptSync('Free-plan-check-123', salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex'));
    assert.strictEqual(await Security.verifyPassword('Free-plan-check-123', stored), true);
  });
});

describe('Workers Free: per-request D1 usage and CPU estimate', () => {
  const t = {};

  it('first request of an isolate reads the dataset once; later requests read one revision row', async () => {
    const first = await call('first request (full load)', 'GET', '/api/v1/health');
    assert.strictEqual(first.status, 200);
    assert.ok(first.rowsRead > 200, 'full load');
    const again = await call('health', 'GET', '/api/v1/health');
    assert.strictEqual(again.rowsRead, 1);
    assert.ok(again.queries <= 2);
  });

  it('API routing: unknown route, preflight', async () => {
    assert.strictEqual((await call('unknown route', 'GET', '/api/v1/nope')).status, 404);
    const pre = await call('OPTIONS preflight', 'OPTIONS', '/api/v1/cart');
    assert.strictEqual(pre.status, 204);
    assert.strictEqual(pre.queries, 0);
  });

  it('vehicle catalog, comparison data and AR manifests', async () => {
    const list = await call('catalog list', 'GET', '/api/v1/vehicles');
    assert.strictEqual(list.json.data.length, 24);
    await call('catalog filter + paginate', 'GET', '/api/v1/vehicles?paginated=true&pageSize=6&fuel=ev&sort=price_asc');
    // the comparison view loads the compared vehicles' details and related models
    for (const id of ['vinfast-vf9', 'tesla-cybertruck']) {
      const d = await call(`compare: detail ${id}`, 'GET', `/api/v1/vehicles/${id}`);
      assert.strictEqual(d.status, 200);
    }
    await call('compare: related', 'GET', '/api/v1/vehicles/vinfast-vf9/related');
    for (const id of ['tesla-cybertruck', 'ferrari-f50-1995', 'vinfast-vf9']) {
      const ar = await call(`AR manifest ${id}`, 'GET', `/api/v1/vehicles/${id}/ar-manifest`);
      assert.strictEqual(ar.status, 200);
      assert.strictEqual(ar.json.data.schemaVersion, 2);
    }
    for (const r of report.filter(x => /^(catalog|compare|AR manifest)/.test(x.label))) {
      assert.strictEqual(r.rowsRead, 1, `${r.label}: steady-state reads only the revision row`);
      assert.strictEqual(r.rowsWritten, 0, `${r.label}: read-only`);
    }
  });

  it('login and registration (scrypt) work; D1 usage stays small', async () => {
    const buyer = await call('login buyer', 'POST', '/api/v1/auth/login', { body: { email: 'minhhoang.sigma@example.com', password: 'Buyer@123456' }, hashing: true });
    assert.strictEqual(buyer.status, 200);
    t.buyer = buyer.json.data.token;
    const admin = await call('login admin', 'POST', '/api/v1/auth/login', { body: { email: 'admin@sigmacar.vn', password: 'Admin@123456' }, hashing: true });
    assert.strictEqual(admin.status, 200);
    t.admin = admin.json.data.token;
    assert.strictEqual((await call('login wrong password', 'POST', '/api/v1/auth/login', { body: { email: 'admin@sigmacar.vn', password: 'wrong-pass' }, hashing: true })).status, 401);
    const reg = await call('register', 'POST', '/api/v1/auth/register', { body: { email: `free.${Date.now()}@example.com`, password: 'FreePlan@123456', fullName: 'Free Plan', phone: '0901234567' }, hashing: true });
    assert.strictEqual(reg.status, 201);
    assert.ok(reg.rowsWritten <= 6, `register writes ${reg.rowsWritten} rows`);
    assert.strictEqual((await call('auth/me', 'GET', '/api/v1/auth/me', { token: t.buyer })).status, 200);
  });

  it('orders: cart → checkout → list → detail', async () => {
    assert.strictEqual((await call('cart add', 'POST', '/api/v1/cart/items', { token: t.buyer, body: { itemType: 'vehicle', itemId: 'tesla-cybertruck', quantity: 1 } })).status, 201);
    const chk = await call('checkout', 'POST', '/api/v1/checkout', { token: t.buyer, body: { source: 'cart', branchId: 'hn-caugiay', buyerName: 'Free', buyerPhone: '0901234567', acceptedPolicy: true } });
    assert.strictEqual(chk.status, 201, JSON.stringify(chk.json));
    assert.ok(chk.rowsWritten <= 20, `checkout writes ${chk.rowsWritten} rows`);
    const id = chk.json.data.order.id;
    assert.ok((await call('orders list', 'GET', '/api/v1/orders', { token: t.buyer })).json.data.some(o => o.id === id));
    assert.strictEqual((await call('order detail', 'GET', `/api/v1/orders/${id}`, { token: t.buyer })).status, 200);
  });

  it('admin functionality', async () => {
    assert.strictEqual((await call('admin users', 'GET', '/api/v1/admin/users', { token: t.admin })).status, 200);
    assert.strictEqual((await call('admin analytics overview', 'GET', '/api/v1/analytics/overview', { token: t.admin })).status, 200);
    assert.strictEqual((await call('admin inventory', 'GET', '/api/v1/inventory', { token: t.admin })).status, 200);
    assert.strictEqual((await call('buyer → admin route', 'GET', '/api/v1/admin/users', { token: t.buyer })).status, 403);
  });

  it('D1 persistence: the order and the new user are rows a fresh isolate can load', async () => {
    const { D1StateStore } = require('../../backend/infrastructure/persistence/d1-state-store');
    const other = new D1StateStore(env.DB, { logger: { error() {} } });
    const patch = await other.load();
    assert.ok(patch.collections.orders.some(o => o.userId === 'usr_buyer_01' && o.items && o.items.some(i => i.itemId === 'tesla-cybertruck')));
    assert.ok(patch.collections.users.some(u => /^free\./.test(u.email)));
  });

  it('CPU estimate per request (10 ms on Workers Free) — non-hashing requests', () => {
    const lines = report.map(r => `${r.label.padEnd(34)} ${String(r.status).padEnd(4)} D1 q=${String(r.queries).padStart(2)} read=${String(r.rowsRead).padStart(4)} written=${String(r.rowsWritten).padStart(3)}  cpu≈${r.cpuEstimate.toFixed(1)} ms${r.hashing ? '  (scrypt)' : ''}`);
    console.log(lines.join('\n'));
    const over = report.filter(r => !r.hashing && r.label !== 'first request (full load)' && r.cpuEstimate > FREE.cpuMs);
    if (STRICT_CPU) assert.deepStrictEqual(over.map(r => r.label), []);
    else if (over.length) console.log(`(informational, machine-dependent) over ${FREE.cpuMs} ms: ${over.map(r => r.label).join(', ')}`);
  });
});
