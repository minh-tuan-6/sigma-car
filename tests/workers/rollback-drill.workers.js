// tests/workers/rollback-drill.workers.js — npm run test:workers
// Production-like Worker and rollback drill, locally:
//   1. D1 prepared like production: catalog only, no demo accounts, first admin from scripts/d1/create-admin.js
//   2. Worker in production mode (NODE_ENV=production, no dev seed) serves real writes (register, cart, checkout)
//   3. D1 → JSON export (scripts/d1/json-to-d1.js --export-json)
//   4. Node backend (server.js, production mode) starts from that file: same users, orders, and still-valid sessions

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { ROOT, freePort, waitFor, killTree, wranglerBin } = require('./harness');

const SECRET = 'sigmacar-rollback-drill-secret-0123456789abcdefgh';
const ADMIN = { email: 'ops.drill@sigmacar.example', password: 'Drill-Admin-Password-2026' };
let dir;
let persist;
let worker;
let node;
const w = {};

function run(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...extraEnv } });
  if (r.status !== 0) throw new Error(`${args.join(' ')} failed:\n${r.stderr}\n${r.stdout.slice(-1500)}`);
  return r.stdout;
}

async function api(base, p, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigmacar-drill-'));
  persist = path.join(dir, 'd1');
  run(['scripts/d1/json-to-d1.js', '--execute', '--local', '--persist-to', persist, '--catalog-only', '--exclude-demo-accounts', '--out-dir', path.join(dir, 'sql')]);
  run(['scripts/d1/create-admin.js', '--email', ADMIN.email, '--name', 'Drill Admin', '--local', '--persist-to', persist], { SIGMA_ADMIN_PASSWORD: ADMIN.password });

  const port = await freePort();
  const logs = [];
  worker = spawn(process.execPath, [wranglerBin(), 'dev', '-c', 'wrangler.api.toml', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persist,
    '--var', 'NODE_ENV:production', '--var', 'SIGMACAR_ALLOW_DEV_SEED:false', '--var', `JWT_SECRET:${SECRET}`, '--show-interactive-dev-session=false'], {
    cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  worker.stdout.on('data', d => logs.push(String(d)));
  worker.stderr.on('data', d => logs.push(String(d)));
  w.base = `http://127.0.0.1:${port}`;
  await waitFor(`${w.base}/api/v1/health`, worker, logs);
});

after(async () => {
  killTree(worker);
  killTree(node);
  await new Promise(r => setTimeout(r, 500));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* Windows file locks */ }
});

describe('Production-like Worker on a catalog-only D1, then rollback to Node', () => {
  it('serves production data without any demo account', async () => {
    const demo = await api(w.base, '/api/v1/auth/login', { method: 'POST', body: { email: 'admin@sigmacar.vn', password: 'Admin@123456' } });
    assert.strictEqual(demo.status, 401, 'demo admin must not exist in production data');
    const cat = await api(w.base, '/api/v1/vehicles');
    assert.strictEqual(cat.status, 200);
    assert.strictEqual(cat.json.data.length, 24);
    const admin = await api(w.base, '/api/v1/auth/login', { method: 'POST', body: ADMIN });
    assert.strictEqual(admin.status, 200, JSON.stringify(admin.json));
    assert.strictEqual(admin.json.data.user.role, 'admin');
    w.admin = admin.json.data.token;
  });

  it('accepts writes through the Worker (register, cart, checkout)', async () => {
    const reg = await api(w.base, '/api/v1/auth/register', { method: 'POST', body: { email: 'drill.buyer@example.com', password: 'Drill@123456', fullName: 'Drill Buyer', phone: '0901234567' } });
    assert.strictEqual(reg.status, 201, JSON.stringify(reg.json));
    w.buyer = reg.json.data.token;
    const add = await api(w.base, '/api/v1/cart/items', { method: 'POST', token: w.buyer, body: { itemType: 'vehicle', itemId: 'tesla-cybertruck', quantity: 1 } });
    assert.strictEqual(add.status, 201, JSON.stringify(add.json));
    const chk = await api(w.base, '/api/v1/checkout', { method: 'POST', token: w.buyer, body: { source: 'cart', branchId: 'hn-caugiay', buyerName: 'Drill Buyer', buyerPhone: '0901234567', acceptedPolicy: true } });
    assert.strictEqual(chk.status, 201, JSON.stringify(chk.json));
    w.order = chk.json.data.order.id;
  });

  it('rolls back: D1 export → Node backend with the same data and valid sessions', async () => {
    const exportFile = path.join(dir, 'export', 'sigmacar_store.json');
    run(['scripts/d1/json-to-d1.js', '--export-json', exportFile, '--local', '--persist-to', persist]);
    const port = await freePort();
    const logs = [];
    const env = { ...process.env, PORT: String(port), NODE_ENV: 'production', JWT_SECRET: SECRET, SIGMACAR_DATA_FILE: exportFile };
    delete env.SIGMACAR_LAZY_INIT;
    node = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    node.stdout.on('data', d => logs.push(String(d)));
    node.stderr.on('data', d => logs.push(String(d)));
    const base = `http://127.0.0.1:${port}`;
    await waitFor(`${base}/api/v1/health`, node, logs);

    const me = await api(base, '/api/v1/auth/me', { token: w.buyer });
    assert.strictEqual(me.status, 200, 'a token issued by the Worker stays valid on Node');
    assert.strictEqual(me.json.data.email, 'drill.buyer@example.com');
    const orders = await api(base, '/api/v1/orders', { token: w.buyer });
    assert.strictEqual(orders.status, 200);
    assert.ok(orders.json.data.some(o => o.id === w.order), 'order written on Workers is on Node');
    const users = await api(base, '/api/v1/admin/users', { token: w.admin });
    assert.strictEqual(users.status, 200);
    assert.deepStrictEqual(users.json.data.map(u => u.email).sort(), [ADMIN.email, 'drill.buyer@example.com'].sort());
    const login = await api(base, '/api/v1/auth/login', { method: 'POST', body: { email: 'drill.buyer@example.com', password: 'Drill@123456' } });
    assert.strictEqual(login.status, 200, 'password hash written by the Worker verifies on Node');
  });
});
