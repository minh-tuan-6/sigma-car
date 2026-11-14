// tests/workers/contract.workers.js — npm run test:workers (not part of npm test: starts wrangler dev / workerd)
// API contract comparison: the same scripted request sequence runs against the Node backend (server.js + JSON file)
// and the Cloudflare Worker (workerd via wrangler dev + local D1), both started from the same data and JWT secret.
// Status codes, contract headers and normalised JSON bodies must match. Every difference fails the test unless it is
// listed in EXPECTED_DIFFERENCES with the reason (documented in docs/CLOUDFLARE_WORKERS_TEST_REPORT.md).

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startBackends } = require('./harness');
const PaymentGateway = require('../../backend/infrastructure/payment-gateway');

const COMPARED_HEADERS = ['content-type', 'cache-control', 'x-content-type-options', 'x-frame-options', 'access-control-allow-origin',
  'access-control-allow-methods', 'access-control-allow-headers', 'permissions-policy', 'referrer-policy', 'content-disposition', 'vary'];

// step name → why the Worker legitimately differs (anything else is a failure)
const EXPECTED_DIFFERENCES = {
  'health': 'storageMode "json" → "d1" and uptimeSeconds is 0 on Workers (the clock does not advance during a request)',
  'ar-manifest vf9': 'Workers list only USDZ files Pages hosts (<= 25 MiB) or the external base URL serves — identical to the static snapshot dist/data/ar/vinfast-vf9.json; Node lists its local 90 MB files'
};

// Masks values that legitimately differ between two runs (ids, tokens, timestamps), keeping structure and the rest.
function normalise(value, key = '') {
  if (Array.isArray(value)) return value.map(v => normalise(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = normalise(value[k], k);
    return out;
  }
  if (typeof value === 'number') {
    if (['iat', 'exp', 'uptimeSeconds'].includes(key) || value > 1e12) return '<n>';
    return value;
  }
  if (typeof value !== 'string') return value;
  return value
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ts>')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<jwt>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/req_[0-9a-f]{12}/g, '<req>')
    // Gateway references are <PROVIDER>_<Date.now() base36>_<random hex> (payment-gateway.js) — random in both runtimes.
    // The opaque-id fallback below cannot match them inside a sentence when the base36 part has no digit.
    .replace(/\b[A-Z][A-Z0-9_]*_[0-9a-z]{6,10}_[0-9A-F]{6}\b/g, '<provider-ref>')
    .replace(/[?&](token|exp)=[^&"]+/g, '&$1=<v>');
}

// Server-generated identifiers (cart lines, intents, provider references, …) are random in both runtimes. Equal
// strings must match exactly; two DIFFERENT strings are accepted only if they have the same opaque-id shape.
function opaqueShape(s) {
  if (!/\s/.test(s) && /\d/.test(s) && /[-_]/.test(s) && s.length >= 6 && s.length <= 96) return s.split(/[-_]/)[0] + '#';
  return s.replace(/[A-Za-z0-9]*\d[A-Za-z0-9]*/g, '#');
}

function firstDiff(a, b, p = '$') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (typeof a === 'string' && typeof b === 'string' && opaqueShape(a) === opaqueShape(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = firstDiff(a[k], b[k], `${p}.${k}`);
      if (d) return d;
    }
    return null; // same keys, every value equal or an equivalent generated id
  }
  return `${p}: node=${JSON.stringify(a)?.slice(0, 160)} worker=${JSON.stringify(b)?.slice(0, 160)}`;
}

let env;
const results = [];
const ctx = { node: {}, worker: {} };
const futureDate = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
const runId = Date.now().toString(36);

async function send(target, { method = 'GET', path: p, body, token, headers = {} }) {
  const h = { ...headers };
  if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(target.base + p, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch (_) { /* csv / binary */ }
  const hdr = {};
  for (const n of COMPARED_HEADERS) hdr[n] = res.headers.get(n);
  return { status: res.status, headers: hdr, json, buf, requestId: res.headers.get('x-request-id') };
}

// Runs one step on both backends. `build(c)` receives the per-backend context (tokens, ids) and returns the request.
async function step(name, build, after) {
  const out = {};
  for (const target of [env.node, env.worker]) {
    const c = ctx[target.name];
    const r = await send(target, build(c));
    if (after) after(c, r);
    out[target.name] = r;
  }
  const n = out.node;
  const w = out.worker;
  const diffs = [];
  if (n.status !== w.status) diffs.push(`status node=${n.status} worker=${w.status}`);
  for (const h of COMPARED_HEADERS) if (n.headers[h] !== w.headers[h]) diffs.push(`header ${h}: node=${n.headers[h]} worker=${w.headers[h]}`);
  // Node answers OPTIONS before the router, so neither runtime sends X-Request-Id there; elsewhere both must.
  if (Boolean(n.requestId) !== Boolean(w.requestId) || (w.requestId && !/^req_[0-9a-f]{12}$/.test(w.requestId))) {
    diffs.push(`x-request-id: node=${n.requestId} worker=${w.requestId}`);
  }
  if (n.json || w.json) {
    const d = firstDiff(normalise(n.json), normalise(w.json));
    if (d) diffs.push(`body ${d}`);
  } else if (!n.buf.equals(w.buf)) {
    const a = opaqueShape(normalise(n.buf.toString('utf8')));
    const b = opaqueShape(normalise(w.buf.toString('utf8')));
    if (a !== b) diffs.push(`raw body differs (${n.buf.length} vs ${w.buf.length} bytes)`);
  }
  results.push({ name, status: n.status, workerStatus: w.status, diffs, expected: EXPECTED_DIFFERENCES[name] || null });
  return out;
}

before(async () => {
  env = await startBackends();
});

after(async () => {
  // The Node backend stores private media in <repo>/data/runtime_media by design; remove what this test uploaded.
  const mediaDir = path.join(__dirname, '..', '..', 'data', 'runtime_media');
  if (ctx.node.media) {
    for (const f of fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : []) {
      if (f.startsWith(`${ctx.node.media}.`)) fs.unlinkSync(path.join(mediaDir, f));
    }
    if (fs.existsSync(mediaDir) && fs.readdirSync(mediaDir).length === 0) fs.rmdirSync(mediaDir);
  }
  const out = path.join(__dirname, '..', '..', '.d1-migration', 'contract-results.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  if (env) await env.stop();
});

describe('Node vs Worker (workerd + local D1): API contract', () => {
  it('runs the scripted sequence with identical results', async () => {
    // --- public catalog & AR ------------------------------------------------------------------------------------
    await step('health', () => ({ path: '/api/v1/health' }));
    await step('vehicles list', () => ({ path: '/api/v1/vehicles' }));
    await step('vehicles filtered+paginated', () => ({ path: '/api/v1/vehicles?paginated=true&page=1&pageSize=5&sort=price_asc&fuel=ev' }));
    await step('vehicles search', () => ({ path: '/api/v1/vehicles?search=vinfast&inStock=true' }));
    await step('certified', () => ({ path: '/api/v1/vehicles/certified?maxPrice=2000000000' }));
    await step('vehicle detail', () => ({ path: '/api/v1/vehicles/vinfast-vf9' }));
    await step('vehicle related', () => ({ path: '/api/v1/vehicles/vinfast-vf9/related' }));
    await step('vehicle 404', () => ({ path: '/api/v1/vehicles/does-not-exist' }));
    await step('ar-manifest cybertruck', () => ({ path: '/api/v1/vehicles/tesla-cybertruck/ar-manifest' }));
    await step('ar-manifest ferrari', () => ({ path: '/api/v1/vehicles/ferrari-f50-1995/ar-manifest' }));
    await step('ar-manifest vf9', () => ({ path: '/api/v1/vehicles/vinfast-vf9/ar-manifest' }));
    await step('ar-manifest 404', () => ({ path: '/api/v1/vehicles/nope/ar-manifest' }));
    await step('inventory public', () => ({ path: '/api/v1/inventory/vinfast-vf9' }));
    await step('financing calculate', () => ({ method: 'POST', path: '/api/v1/financing/calculate', body: { vehiclePrice: 1290000000, downPaymentPercent: 30, annualInterestRatePercent: 7.9, termMonths: 60 } }));
    await step('promotions', () => ({ path: '/api/v1/promotions' }));
    await step('policies', () => ({ path: '/api/v1/policies' }));
    await step('service centers', () => ({ path: '/api/v1/service-centers' }));
    await step('accessories', () => ({ path: '/api/v1/accessories' }));
    await step('bundles recommend', () => ({ path: '/api/v1/bundles/recommend?vehicleId=vinfast-vf9' }));
    await step('tco assumptions', () => ({ path: '/api/v1/cost-estimates/assumptions' }));
    await step('tco estimate', () => ({ method: 'POST', path: '/api/v1/cost-estimates/tco', body: { vehicleId: 'vinfast-vf9', annualKm: 15000, years: 5 } }));
    await step('cms public', () => ({ path: '/api/v1/cms/public' }));
    await step('appointment slots', () => ({ path: `/api/v1/appointments/slots?branchId=hn-caugiay&date=${futureDate}` }));
    await step('workshop availability', () => ({ path: `/api/v1/workshop/availability?date=${futureDate}` }));
    await step('reviews', () => ({ path: '/api/v1/reviews?vehicleId=vinfast-vf9' }));

    // --- protocol errors ----------------------------------------------------------------------------------------
    await step('unknown route', () => ({ path: '/api/v1/no-such-route' }));
    await step('bad json', () => ({ method: 'POST', path: '/api/v1/auth/login', body: '{oops' }));
    await step('options preflight', () => ({ method: 'OPTIONS', path: '/api/v1/cart', headers: { Origin: 'http://localhost:3000' } }));
    await step('auth required', () => ({ path: '/api/v1/auth/me' }));
    await step('garbage token', () => ({ path: '/api/v1/auth/me', token: 'abc.def.ghi' }));

    // --- authentication ---------------------------------------------------------------------------------------
    const tokenOf = (key) => (c, r) => { if (r.json && r.json.data) c[key] = r.json.data.token; };
    await step('login buyer', () => ({ method: 'POST', path: '/api/v1/auth/login', body: { email: 'minhhoang.sigma@example.com', password: 'Buyer@123456' } }), tokenOf('buyer'));
    await step('login seller', () => ({ method: 'POST', path: '/api/v1/auth/login', body: { email: 'minhphan.seller@sigmacar.vn', password: 'Seller@123456' } }), tokenOf('seller'));
    await step('login admin', () => ({ method: 'POST', path: '/api/v1/auth/login', body: { email: 'admin@sigmacar.vn', password: 'Admin@123456' } }), tokenOf('admin'));
    await step('login wrong password', () => ({ method: 'POST', path: '/api/v1/auth/login', body: { email: 'admin@sigmacar.vn', password: 'nope-nope' } }));
    await step('me', (c) => ({ path: '/api/v1/auth/me', token: c.buyer }));
    await step('buyer forbidden admin', (c) => ({ path: '/api/v1/admin/users', token: c.buyer }));
    await step('register', () => ({ method: 'POST', path: '/api/v1/auth/register', body: { email: `contract.${runId}@example.com`, password: 'Contract@123456', fullName: 'Contract Test', phone: '0901234567', role: 'admin' } }), tokenOf('newUser'));
    await step('register duplicate', () => ({ method: 'POST', path: '/api/v1/auth/register', body: { email: `contract.${runId}@example.com`, password: 'Contract@123456', fullName: 'Contract Test', phone: '0901234567' } }));
    await step('profile update', (c) => ({ method: 'PUT', path: '/api/v1/auth/profile', token: c.newUser, body: { fullName: 'Contract Tester', address: 'Hà Nội' } }));
    await step('saved car toggle', (c) => ({ method: 'POST', path: '/api/v1/auth/saved-cars', token: c.newUser, body: { carId: 'vinfast-vf9' } }));

    // --- cart, checkout, payments ---------------------------------------------------------------------------------
    await step('cart empty', (c) => ({ path: '/api/v1/cart', token: c.buyer }));
    await step('cart add vehicle', (c) => ({ method: 'POST', path: '/api/v1/cart/items', token: c.buyer, body: { itemType: 'vehicle', itemId: 'vinfast-vf9', quantity: 1 } }),
      (c, r) => { const items = r.json && r.json.data && r.json.data.items; if (items && items[0]) c.line = items[0].lineId || items[0].id; });
    await step('cart add accessory', (c) => ({ method: 'POST', path: '/api/v1/cart/items', token: c.buyer, body: { itemType: 'accessory', itemId: 'acc_dashcam_vietmap', quantity: 1 } }));
    await step('cart promo', (c) => ({ method: 'POST', path: '/api/v1/cart/promo', token: c.buyer, body: { promoCode: 'EVGREEN5' } }));
    await step('cart promo invalid', (c) => ({ method: 'POST', path: '/api/v1/cart/promo', token: c.buyer, body: { promoCode: 'NOPE' } }));
    await step('cart get', (c) => ({ path: '/api/v1/cart', token: c.buyer }));
    await step('cart version conflict', (c) => ({ method: 'PATCH', path: '/api/v1/cart', token: c.buyer, body: { expectedVersion: 1, branchId: 'hcm-q7' } }));
    await step('quote', (c) => ({ method: 'POST', path: '/api/v1/quotes', token: c.buyer, body: { items: [{ itemType: 'vehicle', itemId: 'vinfast-vf9', quantity: 1 }], branchId: 'hn-caugiay' } }));

    const checkoutBody = { source: 'direct', items: [{ itemType: 'vehicle', itemId: 'vinfast-vf9', quantity: 1 }], branchId: 'hn-caugiay', buyerName: 'Buyer One', buyerPhone: '0901234567', acceptedPolicy: true };
    const idem = { 'Idempotency-Key': `contract-${runId}` };
    await step('checkout', (c) => ({ method: 'POST', path: '/api/v1/checkout', token: c.buyer, headers: idem, body: checkoutBody }),
      (c, r) => { if (r.json && r.json.data && r.json.data.order) c.order = r.json.data.order.id; });
    await step('checkout replay', (c) => ({ method: 'POST', path: '/api/v1/checkout', token: c.buyer, headers: idem, body: checkoutBody }));
    await step('checkout key mismatch', (c) => ({ method: 'POST', path: '/api/v1/checkout', token: c.buyer, headers: idem, body: { ...checkoutBody, paymentMode: 'full' } }));
    await step('payment intent', (c) => ({ method: 'POST', path: '/api/v1/payments/intents', token: c.buyer, body: { orderId: c.order, mode: 'deposit', provider: 'napas_qr_sandbox' } }),
      (c, r) => { if (r.json && r.json.data) { c.intent = r.json.data.id; c.intentAmount = r.json.data.amount; } });
    await step('webhook bad signature', (c) => ({ method: 'POST', path: '/api/v1/payments/webhooks/napas_qr_sandbox', headers: { 'x-webhook-signature': 'sha256=' + '0'.repeat(64) }, body: JSON.stringify({ eventId: `evt_${runId}`, intentId: c.intent, status: 'succeeded', amount: c.intentAmount, currency: 'VND' }) }));
    const signed = (c) => {
      const payload = JSON.stringify({ eventId: `evt_${runId}`, intentId: c.intent, status: 'succeeded', amount: c.intentAmount, currency: 'VND' });
      return { method: 'POST', path: '/api/v1/payments/webhooks/napas_qr_sandbox', headers: { 'x-webhook-signature': `sha256=${PaymentGateway.signWebhookPayload(payload, PaymentGateway.getWebhookSecret('napas_qr_sandbox'))}` }, body: payload };
    };
    await step('webhook settles deposit', signed);
    await step('webhook replay deduped', signed);
    await step('payment history', (c) => ({ path: `/api/v1/payments/intents/${c.order}`, token: c.buyer }));
    await step('orders mine', (c) => ({ path: '/api/v1/orders', token: c.buyer }));
    await step('order detail', (c) => ({ path: `/api/v1/orders/${c.order}`, token: c.buyer }));
    await step('order timeline', (c) => ({ path: `/api/v1/orders/${c.order}/timeline`, token: c.buyer }));
    await step('order other buyer forbidden', (c) => ({ path: `/api/v1/orders/${c.order}`, token: c.newUser }));
    await step('seller confirms order', (c) => ({ method: 'PATCH', path: `/api/v1/orders/${c.order}/status`, token: c.seller, body: { status: 'Confirmed', note: 'contract' } }));
    await step('buyer cannot change confirmed', (c) => ({ method: 'PATCH', path: `/api/v1/orders/${c.order}/status`, token: c.buyer, body: { status: 'Cancelled' } }));
    await step('inventory staff', (c) => ({ path: '/api/v1/inventory', token: c.seller }));

    // --- appointments, notifications, community -------------------------------------------------------------------
    await step('test drive booking', () => ({ method: 'POST', path: '/api/v1/appointments', body: { customerName: 'Contract', customerPhone: '0988776655', customerEmail: 'c@sigmacar.vn', branchId: 'hn-caugiay', date: futureDate, timeSlot: '10:00', vehicleModel: 'VinFast VF9' } }));
    await step('test drive double booking', () => ({ method: 'POST', path: '/api/v1/appointments', body: { customerName: 'Contract 2', customerPhone: '0988776656', customerEmail: 'c2@sigmacar.vn', branchId: 'hn-caugiay', date: futureDate, timeSlot: '10:00', vehicleModel: 'VinFast VF9' } }));
    await step('notifications', (c) => ({ path: '/api/v1/notifications', token: c.buyer }));
    await step('analytics event', () => ({ method: 'POST', path: '/api/v1/analytics/events', body: { eventType: 'vehicle_view', vehicleId: 'vinfast-vf9', sessionId: `s_${runId}` } }));
    await step('support ticket', (c) => ({ method: 'POST', path: '/api/v1/support/tickets', token: c.buyer, body: { subject: 'Contract test', category: 'general', message: 'Xin chào, đây là kiểm thử.', priority: 'normal' } }));
    await step('configuration save', (c) => ({ method: 'POST', path: '/api/v1/configurations', token: c.buyer, body: { vehicleId: 'vinfast-vf9', colorIndex: 1, name: 'Cấu hình kiểm thử' } }),
      (c, r) => { if (r.json && r.json.data) c.config = r.json.data.id; });
    await step('configuration list', (c) => ({ path: '/api/v1/configurations', token: c.buyer }));
    await step('configuration delete', (c) => ({ method: 'DELETE', path: `/api/v1/configurations/${c.config}`, token: c.buyer }));
    await step('ai chat local', () => ({ method: 'POST', path: '/api/v1/ai/chat', body: { message: 'Xe điện 7 chỗ dưới 2,5 tỷ?' } }));

    // --- media ------------------------------------------------------------------------------------------------------
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(700 * 1024, 3)]).toString('base64');
    await step('media upload', (c) => ({ method: 'POST', path: '/api/v1/media/upload', token: c.buyer, body: { fileName: 'proof.png', mimeType: 'image/png', dataBase64: png, purpose: 'return_evidence' } }),
      (c, r) => { if (r.json && r.json.data) c.media = r.json.data.id; });
    await step('media download', (c) => ({ path: `/api/v1/media/${c.media}`, token: c.buyer }));
    await step('media forbidden for others', (c) => ({ path: `/api/v1/media/${c.media}`, token: c.newUser }));
    await step('media spoofed type', (c) => ({ method: 'POST', path: '/api/v1/media/upload', token: c.buyer, body: { fileName: 'x.png', mimeType: 'image/png', dataBase64: Buffer.from('not a png').toString('base64') } }));

    // --- staff / admin -------------------------------------------------------------------------------------------
    await step('admin users', (c) => ({ path: '/api/v1/admin/users', token: c.admin }));
    await step('analytics overview', (c) => ({ path: '/api/v1/analytics/overview', token: c.admin }));
    await step('analytics csv export', (c) => ({ path: '/api/v1/analytics/export', token: c.admin }));
    await step('seller customers', (c) => ({ path: '/api/v1/seller/customers', token: c.seller }));
    await step('llm config (admin)', (c) => ({ path: '/api/v1/config/llm', token: c.admin }));

    // --- session invalidation ------------------------------------------------------------------------------------
    await step('password change', (c) => ({ method: 'PUT', path: '/api/v1/auth/password', token: c.newUser, body: { currentPassword: 'Contract@123456', newPassword: 'Contract@654321' } }));
    await step('old token rejected after password change', (c) => ({ path: '/api/v1/auth/me', token: c.newUser }));
    await step('logout', (c) => ({ method: 'POST', path: '/api/v1/auth/logout', token: c.seller }));
    await step('token rejected after logout', (c) => ({ path: '/api/v1/auth/me', token: c.seller }));

    const unexpected = results.filter(r => r.diffs.length && !r.expected);
    const report = results.filter(r => r.diffs.length).map(r => `${r.expected ? 'EXPECTED' : 'UNEXPECTED'} ${r.name}: ${r.diffs.join(' | ')}`).join('\n');
    if (report) console.log(report);
    assert.deepStrictEqual(unexpected.map(r => `${r.name}: ${r.diffs.join(' | ')}`), []);
    // the documented differences must really be the only ones, and must actually occur
    for (const name of Object.keys(EXPECTED_DIFFERENCES)) assert.ok(results.find(r => r.name === name), `step ${name} ran`);
  });

  it('accepts tokens across runtimes (existing sessions stay valid with the same JWT_SECRET)', async () => {
    const login = await send(env.node, { method: 'POST', path: '/api/v1/auth/login', body: { email: 'thanhthao.ev@example.com', password: 'Buyer@123456' } });
    assert.strictEqual(login.status, 200);
    const me = await send(env.worker, { path: '/api/v1/auth/me', token: login.json.data.token });
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.json.data.email, 'thanhthao.ev@example.com');
  });

  it('persists Worker writes in D1 rows (not only in isolate memory)', () => {
    const rows = env.d1(`SELECT COUNT(*) AS n FROM state_documents WHERE collection = 'users' AND lower(json_extract(doc, '$.email')) = 'contract.${runId}@example.com'`);
    assert.strictEqual(rows[0].n, 1);
    const orders = env.d1(`SELECT json_extract(doc, '$.paymentStatus') AS ps, json_extract(doc, '$.orderStatus') AS os FROM state_documents WHERE collection = 'orders' AND doc_key = '${ctx.worker.order}'`);
    assert.strictEqual(orders.length, 1, 'the order created through the Worker is a D1 row');
    assert.strictEqual(orders[0].ps, 'Deposit_Paid');
    assert.strictEqual(orders[0].os, 'Confirmed');
    const blobs = env.d1('SELECT COUNT(*) AS n, SUM(bytes) AS b FROM media_blobs');
    assert.strictEqual(blobs[0].n, 2);
    assert.strictEqual(blobs[0].b, 8 + 700 * 1024);
  });

  it('keeps invariants under concurrent requests in workerd', async () => {
    const email = `race.${runId}@example.com`;
    const regs = await Promise.all(Array.from({ length: 12 }, () => send(env.worker, { method: 'POST', path: '/api/v1/auth/register', body: { email, password: 'Race@123456', fullName: 'Race', phone: '0900000000' } })));
    const statuses = regs.map(r => r.status).sort();
    assert.strictEqual(statuses.filter(s => s === 201).length, 1, `exactly one registration wins: ${statuses}`);
    assert.ok(statuses.filter(s => s !== 201).every(s => s === 409), `others conflict: ${statuses}`);
    assert.strictEqual(env.d1(`SELECT COUNT(*) AS n FROM state_documents WHERE collection = 'users' AND lower(json_extract(doc, '$.email')) = '${email}'`)[0].n, 1);

    const events = await Promise.all(Array.from({ length: 30 }, (_, i) => send(env.worker, { method: 'POST', path: '/api/v1/analytics/events', body: { eventType: 'vehicle_view', vehicleId: 'vinfast-vf9', sessionId: `race_${runId}_${i}` } })));
    assert.ok(events.every(r => r.status === 202), events.map(r => r.status).join(','));
    const stored = env.d1(`SELECT COUNT(*) AS n FROM state_documents WHERE collection = 'analyticsEvents' AND json_extract(doc, '$.sessionId') LIKE 'race_${runId}_%'`)[0].n;
    assert.strictEqual(stored, 30, 'no lost writes');
  });
});
