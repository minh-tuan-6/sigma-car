// tests/integration/phase2_lifecycle.test.js
// PLAN.md Phase 2: T2.1 status-aware notifications, T2.4 warranty lookup by VIN, T2.5 battery swap/rental,
// T2.7 My Garage extras (owner-scoped CRUD).

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-app');

describe('Phase 2 customer lifecycle extensions', () => {
  let app = null;
  let baseUrl = '';
  let adminToken = '';
  let sellerHnToken = '';
  let sellerHcmToken = '';
  let buyer1Token = '';
  let buyer2Token = '';

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
    sellerHcmToken = await login('linhnguyen.seller@sigmacar.vn', 'Seller@123456');
    buyer1Token = await login('minhhoang.sigma@example.com', 'Buyer@123456');
    buyer2Token = await login('thanhthao.ev@example.com', 'Buyer@123456');
  });
  after(async () => { if (app) await app.close(); });

  it('T2.1: an order status change notifies the buyer with the new status in the title', async () => {
    const changed = await api('/orders/ORD-9021/status', { method: 'PATCH', token: adminToken, body: { status: 'Preparing', note: 'Đang chuẩn bị xe' } });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const inbox = await api('/notifications', { token: buyer1Token });
    assert.equal(inbox.status, 200);
    const list = Array.isArray(inbox.body.data) ? inbox.body.data : (inbox.body.data.items || []);
    const n = list.find(x => x.aggregateId === 'ORD-9021' && x.eventType === 'order_status_updated');
    assert.ok(n, 'status notification exists');
    assert.match(n.title, /Đang chuẩn bị xe/);
    assert.doesNotMatch(n.title, /Xác nhận đơn hàng/);
  });

  describe('T2.4 warranty lookup by VIN', () => {
    const VIN = 'SGME2026VN001889'; // seed warranty of ORD-9020 (buyer 1, branch hn-caugiay)

    it('owner gets coverage data without personal fields', async () => {
      const r = await api(`/warranties/lookup?vin=${VIN.toLowerCase()}`, { token: buyer1Token });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.data.vin, VIN);
      assert.ok(r.body.data.warrantyCode);
      assert.ok('daysRemaining' in r.body.data);
      for (const k of ['ownerName', 'ownerPhone', 'invoiceNumber', 'motorNumber', 'userId']) assert.equal(r.body.data[k], undefined, k);
    });

    it('another buyer and another branch get 404; the branch seller and admin get 200', async () => {
      assert.equal((await api(`/warranties/lookup?vin=${VIN}`, { token: buyer2Token })).status, 404);
      assert.equal((await api(`/warranties/lookup?vin=${VIN}`, { token: sellerHcmToken })).status, 404);
      assert.equal((await api(`/warranties/lookup?vin=${VIN}`, { token: sellerHnToken })).status, 200);
      assert.equal((await api(`/warranties/lookup?vin=${VIN}`, { token: adminToken })).status, 200);
    });

    it('unknown VIN is 404, malformed is 422, anonymous is 401', async () => {
      assert.equal((await api('/warranties/lookup?vin=ZZZZ00000000ZZZZ', { token: adminToken })).status, 404);
      assert.equal((await api('/warranties/lookup?vin=bad!', { token: adminToken })).status, 422);
      assert.equal((await api(`/warranties/lookup?vin=${VIN}`)).status, 401);
    });
  });

  it('T2.5: swap stations and battery rental are public reference data', async () => {
    const swap = await api('/charging/swap-stations');
    assert.equal(swap.status, 200);
    assert.equal(swap.body.data.source, 'demo_reference');
    assert.equal(swap.body.data.liveAvailabilitySupported, false);
    assert.ok(swap.body.data.stations.length >= 1);
    const hcm = await api('/charging/swap-stations?province=TP.HCM');
    assert.ok(hcm.body.data.stations.length >= 1);
    assert.ok(hcm.body.data.stations.every(s => s.province === 'TP.HCM'));
    const rental = await api('/charging/battery-rental');
    assert.equal(rental.status, 200);
    assert.ok(rental.body.data.plans.length >= 1);
    assert.ok(rental.body.data.disclaimer.length > 10);
  });

  describe('T2.7 My Garage extras', () => {
    it('saves, lists and deletes TCO results for the owner only', async () => {
      const saved = await api('/garage/tco-results', {
        method: 'POST', token: buyer1Token,
        body: { region: 'hcm', monthlyKm: 1200, carA: { vehicleId: 'tesla-cybertruck', fuelType: 'ev', fiveYearTotal: 150000000, injected: '<b>x</b>' }, carB: { vehicleId: 'toyota-camry', fuelType: 'ice', fiveYearTotal: 210000000 }, fiveYearSavings: 60000000, userId: 'someone-else' }
      });
      assert.equal(saved.status, 201, JSON.stringify(saved.body));
      const rec = saved.body.data;
      assert.equal(rec.carA.vehicleName.length > 0, true);
      assert.equal(rec.carA.injected, undefined, 'unknown fields are dropped');
      assert.notEqual(rec.userId, 'someone-else', 'owner comes from the token');

      const mine = await api('/garage/tco-results', { token: buyer1Token });
      assert.equal(mine.body.count, 1);
      const theirs = await api('/garage/tco-results', { token: buyer2Token });
      assert.equal(theirs.body.count, 0);

      assert.equal((await api(`/garage/tco-results/${rec.id}`, { method: 'DELETE', token: buyer2Token })).status, 404);
      assert.equal((await api(`/garage/tco-results/${rec.id}`, { method: 'DELETE', token: buyer1Token })).status, 200);
      assert.equal((await api('/garage/tco-results', { token: buyer1Token })).body.count, 0);
    });

    it('validates recommendations and requires login', async () => {
      const ok = await api('/garage/recommendations', { method: 'POST', token: buyer1Token, body: { vehicleId: 'vinfast-vf3', score: 87, reasons: ['Phù hợp ngân sách', 'Đô thị'] } });
      assert.equal(ok.status, 201, JSON.stringify(ok.body));
      assert.deepEqual(ok.body.data.reasons, ['Phù hợp ngân sách', 'Đô thị']);
      const bad = await api('/garage/recommendations', { method: 'POST', token: buyer1Token, body: { vehicleId: 'no-such-car' } });
      assert.equal(bad.status, 422);
      assert.equal((await api('/garage/recommendations')).status, 401);
      assert.equal((await api('/garage/unknown-kind', { token: buyer1Token })).status, 404);
    });
  });
});
