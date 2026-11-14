// tests/integration/phase4_admin.test.js
// PLAN.md Phase 4 backend: T4.1 vehicle whitelist, T4.2 promotions edit, T4.3 accessory admin, T4.4 movements,
// T4.7 parts restock, T4.9 server funnel events, T4.10 rankings, T4.11 audit log viewer, T4.15 role-change audit,
// T5.2 demo records excluded from analytics.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startTestServer } = require('../helpers/test-app');
const PaymentGateway = require('../../backend/infrastructure/payment-gateway');
const StorageEngine = require('../../backend/infrastructure/storage-engine');

describe('Phase 4 administration', () => {
  let app = null;
  let baseUrl = '';
  let adminToken = '';
  let sellerHnToken = '';
  let buyer1Token = '';

  const api = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const login = async (email, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(r.status, 200, `login ${email}`);
    return r.body.data.token;
  };

  before(async () => {
    app = await startTestServer({ mode: 'memory', reseed: true });
    baseUrl = app.baseUrl;
    adminToken = await login('admin@sigmacar.vn', 'Admin@123456');
    sellerHnToken = await login('minhphan.seller@sigmacar.vn', 'Seller@123456');
    buyer1Token = await login('minhhoang.sigma@example.com', 'Buyer@123456');
  });
  after(async () => { if (app) await app.close(); });

  it('T4.1: vehicle create/update keep the form fields and validate trims/videos', async () => {
    const created = await api('/vehicles', {
      method: 'POST', token: adminToken,
      body: {
        name: 'Xe Thử T4.1', brand: 'SIGMA', category: 'SUV', fuel: 'ev', price: 990000000, seats: 5,
        power: '300 HP', acceleration: '6.1s', battery: '75 kWh', dimensions: '4.700 x 1.900 x 1.700 mm', warranty: '8 năm',
        features: ['ADAS', '<script>x</script>Camera 360'],
        trims: [{ id: 'base', name: 'Tiêu chuẩn', priceDelta: 0 }, { name: 'Cao cấp', priceDelta: 80000000 }, { bogus: true }],
        videos: ['assets/videos/demo.mp4', 'https://evil.example/v.mp4'],
        unknownField: 'dropped'
      }
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const v = created.body.data;
    assert.equal(v.power, '300 HP');
    assert.equal(v.warranty, '8 năm');
    assert.equal(v.trims.length, 2);
    assert.deepEqual(v.videos.map(x => x.url), ['assets/videos/demo.mp4']);
    assert.ok(!JSON.stringify(v.features).includes('<script>'));
    assert.equal(v.unknownField, undefined);

    const updated = await api(`/vehicles/${v.id}`, { method: 'PUT', token: adminToken, body: { acceleration: '5.9s' } });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.data.acceleration, '5.9s');
  });

  it('T4.2: promotions can be deactivated; inactive codes are listed for staff only and stop validating', async () => {
    const created = await api('/promotions', { method: 'POST', token: adminToken, body: { code: 'T42TEST', discountType: 'fixed', discountValue: 1000000 } });
    assert.equal(created.status, 201);
    const off = await api(`/promotions/${created.body.data.id}`, { method: 'PATCH', token: adminToken, body: { isActive: false } });
    assert.equal(off.status, 200);
    assert.equal(off.body.data.isActive, false);

    const staffAll = await api('/promotions?activeOnly=false', { token: adminToken });
    assert.ok(staffAll.body.data.some(p => p.code === 'T42TEST'));
    const publicAll = await api('/promotions?activeOnly=false');
    assert.ok(!publicAll.body.data.some(p => p.code === 'T42TEST'), 'anonymous never sees inactive codes');

    const check = await api('/promotions/validate', { method: 'POST', body: { code: 'T42TEST', subtotal: 900000000 } });
    assert.ok(check.status !== 200 || check.body.data.valid === false || check.body.data.isValid === false, JSON.stringify(check.body));

    assert.equal((await api(`/promotions/${created.body.data.id}`, { method: 'PATCH', token: buyer1Token, body: { isActive: true } })).status, 403);
    // seller may not edit a global (admin-created, no branch) promotion
    assert.equal((await api(`/promotions/${created.body.data.id}`, { method: 'PATCH', token: sellerHnToken, body: { isActive: true } })).status, 403);
  });

  it('T4.3: admin creates, edits and archives an accessory; others are refused', async () => {
    const created = await api('/accessories', { method: 'POST', token: adminToken, body: { sku: 'acc-t43', name: 'Thảm sàn T4.3', price: 1500000, quantity: 10 } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.id, 'ACC-T43');
    const list = await api('/accessories');
    const items = list.body.data.items || list.body.data;
    assert.ok(items.some(a => a.id === 'ACC-T43'));

    const edit = await api('/accessories/ACC-T43', { method: 'PATCH', token: adminToken, body: { price: 1700000 } });
    assert.equal(edit.body.data.price, 1700000);
    await api('/accessories/ACC-T43', { method: 'PATCH', token: adminToken, body: { archived: true } });
    const after = await api('/accessories');
    assert.ok(!(after.body.data.items || after.body.data).some(a => a.id === 'ACC-T43'), 'archived SKU hidden from catalog');

    assert.equal((await api('/accessories', { method: 'POST', token: sellerHnToken, body: { sku: 'X1', name: 'abc', price: 1 } })).status, 403);
    assert.equal((await api('/accessories', { method: 'POST', token: adminToken, body: { sku: 'ACC-T43', name: 'dup', price: 1 } })).status, 409);
  });

  it('T4.4: movement history is staff-only and branch-scoped', async () => {
    await api('/inventory/vinfast-vf3', { method: 'PATCH', token: adminToken, body: { branchId: 'hcm-q7', delta: 1, reason: 'T4.4 HCM' } });
    await api('/inventory/vinfast-vf3', { method: 'PATCH', token: sellerHnToken, body: { branchId: 'hn-caugiay', delta: 1, reason: 'T4.4 HN' } });
    const admin = await api('/inventory/movements?vehicleId=vinfast-vf3', { token: adminToken });
    assert.equal(admin.status, 200);
    assert.ok(admin.body.data.some(m => m.branchId === 'hcm-q7'));
    const seller = await api('/inventory/movements?vehicleId=vinfast-vf3', { token: sellerHnToken });
    assert.ok(seller.body.data.length > 0 && seller.body.data.every(m => m.branchId === 'hn-caugiay'));
    assert.equal((await api('/inventory/movements')).status, 401);
    assert.equal((await api('/inventory/movements', { token: buyer1Token })).status, 403);
  });

  it('T4.7: parts can be created and restocked, with movement + audit entries', async () => {
    const created = await api('/workshop/parts', { method: 'POST', token: adminToken, body: { sku: 'prt-t47', name: 'Lọc gió T4.7', unitPrice: 300000, stockOnHand: 2, compatibleFuels: ['ev', 'nuclear'] } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(created.body.data.compatibleFuels, ['ev']);
    const restock = await api('/workshop/parts/PRT-T47/restock', { method: 'POST', token: adminToken, body: { quantity: 5, reason: 'Nhập kho tháng 11' } });
    assert.equal(restock.status, 200);
    assert.equal(restock.body.data.part.stockOnHand, 7);
    assert.equal((await api('/workshop/parts/PRT-T47/restock', { method: 'POST', token: sellerHnToken, body: { quantity: 1 } })).status, 403);
    assert.equal((await api('/workshop/parts/PRT-T47/restock', { method: 'POST', token: adminToken, body: { quantity: 0 } })).status, 400);
    const audit = await api('/admin/audit-logs?action=PART_RESTOCKED', { token: adminToken });
    assert.ok(audit.body.data.items.some(e => e.targetId === 'PRT-T47'));
  });

  it('T4.9/T4.10: server-side funnel events and best-seller rankings follow real checkouts', async () => {
    const coRes = await api('/checkout', {
      method: 'POST', token: buyer1Token, headers: { 'Idempotency-Key': `idem-t49-${crypto.randomUUID().slice(0, 8)}` },
      body: { source: 'direct', items: [{ itemType: 'vehicle', itemId: 'lucid-air-sapphire', quantity: 1 }], branchId: 'hn-caugiay', acceptedPolicy: true, buyerName: 'T4.9', buyerPhone: '0901234567' }
    });
    assert.equal(coRes.status, 201, JSON.stringify(coRes.body));
    const order = coRes.body.data.order;
    const intent = (await api('/payments/intents', { method: 'POST', token: buyer1Token, body: { orderId: order.id, mode: 'deposit', provider: 'napas_qr_sandbox' } })).body.data;
    const payload = JSON.stringify({ eventId: `evt_t49_${crypto.randomUUID().slice(0, 8)}`, intentId: intent.id, status: 'succeeded', amount: intent.amount, currency: 'VND' });
    const sig = PaymentGateway.signWebhookPayload(payload, PaymentGateway.getWebhookSecret('napas_qr_sandbox'));
    assert.equal((await api('/payments/webhooks/napas_qr_sandbox', { method: 'POST', headers: { 'x-webhook-signature': `sha256=${sig}` }, body: payload })).status, 200);

    const funnel = await api('/analytics/funnel?branchId=hn-caugiay', { token: adminToken });
    assert.equal(funnel.status, 200);
    assert.ok(funnel.body.data.serverVerifiedCounts.checkout >= 1);
    assert.ok(funnel.body.data.serverVerifiedCounts.order_paid >= 1);
    assert.ok(funnel.body.data.counts.checkout >= funnel.body.data.serverVerifiedCounts.checkout, 'existing counts still include server events');

    const top = await api('/analytics/top-products?branchId=hn-caugiay', { token: adminToken });
    assert.equal(top.status, 200);
    assert.ok(top.body.data.topVehicles.some(v => v.itemId === 'lucid-air-sapphire'));
    assert.equal((await api('/analytics/top-products', { token: buyer1Token })).status, 403);
  });

  it('T5.2: demo-flagged orders are excluded from revenue and rankings unless an admin asks', async () => {
    const before = (await api('/analytics/overview', { token: adminToken })).body.data;
    await StorageEngine.runInTransaction(async (state) => {
      state.orders.push({ id: 'demo-ord-t52', orderNumber: 'DEMO-T52', isDemo: true, demoBatchId: 't52', userId: 'demo-usr-1', vehicleId: 'bugatti-chiron', vehicleName: 'Demo', unitPrice: 77000000000, totalAmount: 77000000000, paidAmount: 77000000000, paymentStatus: 'Fully_Paid', orderStatus: 'Completed', branchId: 'hn-caugiay', createdAt: new Date().toISOString() });
    });
    const afterDefault = (await api('/analytics/overview', { token: adminToken })).body.data;
    assert.deepEqual(afterDefault, before, 'default analytics unchanged by demo data');
    const top = (await api('/analytics/top-products', { token: adminToken })).body.data;
    assert.ok(!top.topVehicles.some(v => v.itemId === 'bugatti-chiron' && v.revenue >= 77000000000));
    const withDemo = (await api('/analytics/top-products?includeDemo=true', { token: adminToken })).body.data;
    assert.ok(withDemo.topVehicles.some(v => v.itemId === 'bugatti-chiron'));
    const sellerTry = (await api('/analytics/top-products?includeDemo=true', { token: sellerHnToken })).body.data;
    assert.ok(!sellerTry.topVehicles.some(v => v.itemId === 'bugatti-chiron' && v.revenue >= 77000000000), 'only admins may include demo data');
  });

  it('T4.11/T4.15: role changes are audited and the audit log is admin-only', async () => {
    const created = await api('/admin/users', { method: 'POST', token: adminToken, body: { fullName: 'Audit T4.15', email: `audit_${Date.now()}@sigmacar.vn`, phone: '0911000666', role: 'seller', branchId: 'hcm-q7', password: 'AuditT415@Strong' } });
    assert.equal(created.status, 201);
    const id = created.body.data.id;
    assert.equal((await api(`/admin/users/${id}/role`, { method: 'PATCH', token: adminToken, body: { role: 'support_staff', branchId: 'hcm-q7' } })).status, 200);
    assert.equal((await api(`/admin/users/${id}`, { method: 'DELETE', token: adminToken })).status, 200);

    const logs = await api(`/admin/audit-logs?targetId=${encodeURIComponent(id)}`, { token: adminToken });
    assert.equal(logs.status, 200);
    const actions = logs.body.data.items.map(e => e.action);
    assert.ok(actions.includes('USER_ROLE_UPDATED'));
    assert.ok(actions.includes('USER_DELETED'));
    assert.ok(logs.body.data.items.find(e => e.action === 'USER_ROLE_UPDATED').detail.includes('seller → support_staff'));
    assert.equal((await api('/admin/audit-logs', { token: sellerHnToken })).status, 403);
  });
});
