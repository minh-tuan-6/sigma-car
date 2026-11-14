// tests/integration/wiring_regressions.test.js
// Server-side checks for PLAN.md Phase 1 fixes: T1.7 (test-drive statuses), T1.8 (seller stock adjust),
// T1.14 (warranty activation only after delivery), T1.15 (created admins are global).

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-app');

describe('Phase 1 server-side wiring regressions', () => {
  let app = null;
  let baseUrl = '';
  let adminToken = '';
  let sellerHnToken = '';
  let buyer1Token = '';

  const api = async (path, { method = 'GET', body, token } = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
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

  it('T1.8: a seller can adjust stock in their own branch and is refused for another branch', async () => {
    const own = await api('/inventory/vinfast-vf3', { method: 'PATCH', token: sellerHnToken, body: { branchId: 'hn-caugiay', delta: 1, reason: 'T1.8 own branch' } });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    const other = await api('/inventory/vinfast-vf3', { method: 'PATCH', token: sellerHnToken, body: { branchId: 'hcm-q7', delta: 1, reason: 'T1.8 other branch' } });
    assert.equal(other.status, 403);
    assert.equal(other.body.error.code, 'BRANCH_FORBIDDEN');
    const adminAny = await api('/inventory/vinfast-vf3', { method: 'PATCH', token: adminToken, body: { branchId: 'hcm-q7', delta: 1, reason: 'T1.8 admin' } });
    assert.equal(adminAny.status, 200, JSON.stringify(adminAny.body));
  });

  it('T1.14: warranty activation is refused before delivery and allowed after delivery', async () => {
    const confirmed = await api('/warranties/activate', {
      method: 'POST', token: buyer1Token,
      body: { vin: 'SGVS2026VN005412', motorNumber: 'MTR-450KW-412', invoiceNumber: 'INV-SG2026-9021', licensePlate: '30K-999.01' }
    });
    assert.equal(confirmed.status, 409, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.error.code, 'ORDER_NOT_ELIGIBLE');

    const delivered = await api('/warranties/activate', {
      method: 'POST', token: buyer1Token,
      body: { vin: 'SGCG2026VN003310', motorNumber: 'MTR-150KW-310', invoiceNumber: 'INV-SG2026-9023', licensePlate: '30K-999.02' }
    });
    assert.equal(delivered.status, 201, JSON.stringify(delivered.body));
  });

  it('T1.15: an admin created through the API sees all branches like the seeded admin', async () => {
    const email = `admin_t115_${Date.now()}@sigmacar.vn`;
    const created = await api('/admin/users', {
      method: 'POST', token: adminToken,
      body: { fullName: 'Admin T1.15', email, phone: '0911000444', role: 'admin', branchId: 'hcm-q7', password: 'AdminT115@Strong' }
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.branchId, 'all');
    const newAdminToken = await login(email, 'AdminT115@Strong');
    const seeded = await api('/orders', { token: adminToken });
    const fresh = await api('/orders', { token: newAdminToken });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.count, seeded.body.count);

    const seller = await api('/admin/users', {
      method: 'POST', token: adminToken,
      body: { fullName: 'Seller T1.15', email: `seller_t115_${Date.now()}@sigmacar.vn`, phone: '0911000555', role: 'seller', branchId: 'hcm-q7', password: 'SellerT115@Strong' }
    });
    assert.equal(seller.status, 201);
    assert.equal(seller.body.data.branchId, 'hcm-q7', 'staff keep their branch');
  });

  it('T1.7: slots expose remainingCapacity and a test drive goes Pending -> Confirmed -> Completed', async () => {
    const date = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const slots = await api(`/appointments/slots?branchId=hn-caugiay&date=${date}&category=test_drive`);
    assert.equal(slots.status, 200);
    const open = slots.body.data.slots.find(s => s.isAvailable);
    assert.ok(open && typeof open.remainingCapacity === 'number');
    assert.ok(Array.isArray(slots.body.data.homeServiceDistricts));

    const booked = await api('/appointments', {
      method: 'POST', token: buyer1Token,
      body: { carName: 'VinFast VF 3', vehicleId: 'vinfast-vf3', customerName: 'Minh Hoàng', phone: '0912345678', branchId: 'hn-caugiay', preferredDate: date, timeSlot: open.timeSlot }
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    const apptId = booked.body.data.id;
    assert.equal(booked.body.data.status, 'Chờ xác nhận');

    const confirm = await api(`/appointments/${apptId}/status`, { method: 'PATCH', token: sellerHnToken, body: { status: 'Đã xác nhận' } });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    const complete = await api(`/appointments/${apptId}/status`, { method: 'PATCH', token: sellerHnToken, body: { status: 'Hoàn thành' } });
    assert.equal(complete.status, 200, JSON.stringify(complete.body));

    const oldLabel = await api(`/appointments/${apptId}/status`, { method: 'PATCH', token: sellerHnToken, body: { status: 'Đã hoàn thành' } });
    assert.notEqual(oldLabel.status, 200, 'the label the old button sent is still not a valid status');
  });
});
