// tests/security/p0_regression.test.js
// Comprehensive regression checks for SIGMACAR Batch P0 security, storage, isolation & contract invariants

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, createMockFs } = require('../helpers/test-app');
const { runMigration } = require('../../scripts/migrate-json-to-sql');
const { auditDataIntegrity } = require('../../scripts/audit-data-integrity');

describe('P0 Security, Isolation, Atomic Storage & Boundary Regressions', () => {
  let app = null;
  let rootUrl = '';
  let baseUrl = '';
  let adminToken = '';
  let sellerHnToken = '';
  let sellerHcmToken = '';
  let buyer1Token = '';
  let buyer2Token = '';

  const loginAs = async (email, password) => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const body = await res.json();
    assert.equal(res.status, 200, `Expected login 200 for ${email}`);
    return body.data.token;
  };

  before(async () => {
    app = await startTestServer({ mode: 'memory', reseed: true });
    rootUrl = app.rootUrl;
    baseUrl = app.baseUrl;
    adminToken = await loginAs('admin@sigmacar.vn', 'Admin@123456');
    sellerHnToken = await loginAs('minhphan.seller@sigmacar.vn', 'Seller@123456');
    sellerHcmToken = await loginAs('linhnguyen.seller@sigmacar.vn', 'Seller@123456');
    buyer1Token = await loginAs('minhhoang.sigma@example.com', 'Buyer@123456');
    buyer2Token = await loginAs('thanhthao.ev@example.com', 'Buyer@123456');
  });

  after(async () => {
    if (app) await app.close();
  });

  it('SIG-P0-002: Static file boundary blocks private store, backend code, .env, .git and malformed URIs', async () => {
    for (const badPath of ['/.env', '/.git/HEAD', '/backend/config/index.js', '/data/sigmacar_store.json', '/package.json']) {
      const res = await fetch(`${rootUrl}${badPath}`);
      assert.equal(res.status, 404, `Private path ${badPath} must not be served`);
    }
    const malformed = await fetch(`${rootUrl}/%E0%A4%A`);
    assert.equal(malformed.status, 400);

    const publicAsset = await fetch(`${rootUrl}/data/ar-manifest.json`);
    assert.equal(publicAsset.status, 200);
  });

  it('SIG-P0-003 / SIG-P0-006: Admin staff creation works cleanly & GET /admin/users denies Seller', async () => {
    const sellerListRes = await fetch(`${baseUrl}/admin/users`, {
      headers: { Authorization: `Bearer ${sellerHnToken}` }
    });
    assert.equal(sellerListRes.status, 403);

    const createRes = await fetch(`${baseUrl}/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        fullName: 'Nhân viên Kinh Doanh Test',
        email: `staff_${Date.now()}@sigmacar.vn`,
        phone: '0911223344',
        role: 'seller',
        branchId: 'hcm-q7'
      })
    });
    const created = await createRes.json();
    assert.equal(createRes.status, 201);
    assert.equal(created.data.role, 'seller');
    assert.equal(created.data.passwordHash, undefined);
    assert.equal(created.data.branchId, 'hcm-q7');
  });

  it('SIG-P0-004 (CR-02): Orders start as Unpaid, unauthenticated deposit rejected & client self-delivery blocked', async () => {
    const anonRes = await fetch(`${baseUrl}/orders/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleId: 'toyota-camry', buyerName: 'Anon', buyerPhone: '0900000000' })
    });
    assert.equal(anonRes.status, 401);

    const depRes = await fetch(`${baseUrl}/orders/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyer1Token}` },
      body: JSON.stringify({ vehicleId: 'toyota-camry', branchId: 'hcm-q7', buyerName: 'Minh Hoàng', buyerPhone: '0912345678' })
    });
    const depData = await depRes.json();
    assert.equal(depRes.status, 201);
    assert.equal(depData.data.paymentStatus, 'Unpaid');
    assert.equal(depData.data.orderStatus, 'Pending');

    const unverifiedComplete = await fetch(`${baseUrl}/orders/${depData.data.id}/complete-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyer1Token}` },
      body: JSON.stringify({ paymentMethod: 'QR Napas' })
    });
    assert.equal(unverifiedComplete.status, 409);
  });

  it('CR-04: Rejected order cancel MUST NOT restore inventory and Branch A Seller is denied Branch B order', async () => {
    const depRes = await fetch(`${baseUrl}/orders/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyer2Token}` },
      body: JSON.stringify({ vehicleId: 'vinfast-vf3', branchId: 'hn-caugiay', buyerName: 'Thanh Thảo', buyerPhone: '0908765432' })
    });
    const order = (await depRes.json()).data;

    // Confirm first via HN seller
    const confRes = await fetch(`${baseUrl}/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerHnToken}` },
      body: JSON.stringify({ status: 'Confirmed' })
    });
    assert.equal(confRes.status, 200);

    const stockBefore = (await (await fetch(`${baseUrl}/vehicles/vinfast-vf3`)).json()).data.stock;

    // Cross-branch HCM seller attempting to mutate HN order -> 403, stock unchanged
    const crossRes = await fetch(`${baseUrl}/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerHcmToken}` },
      body: JSON.stringify({ status: 'Preparing' })
    });
    assert.equal(crossRes.status, 403);

    // HN seller attempting to cancel Confirmed order -> 403, stock MUST NOT increase
    const cancelRes = await fetch(`${baseUrl}/orders/${order.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerHnToken}` },
      body: JSON.stringify({ status: 'Cancelled' })
    });
    assert.equal(cancelRes.status, 403);

    const stockAfter = (await (await fetch(`${baseUrl}/vehicles/vinfast-vf3`)).json()).data.stock;
    assert.equal(stockAfter, stockBefore, 'Stock must remain invariant when status transitions are denied');
  });

  it('SIG-P0-003: Cross-branch order/analytics isolation & cross-buyer appointment IDOR denial', async () => {
    const hcmOrdersRes = await fetch(`${baseUrl}/orders`, { headers: { Authorization: `Bearer ${sellerHcmToken}` } });
    const hcmOrders = (await hcmOrdersRes.json()).data;
    assert.equal(hcmOrders.some(o => o.branchId === 'hn-caugiay'), false);

    // Create buyer1 appointment in hn-caugiay and confirm buyer2 cannot cancel it
    const slotRes = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyer1Token}` },
      body: JSON.stringify({
        customerName: 'Minh Hoàng',
        phone: '0912345678',
        branchId: 'hn-caugiay',
        preferredDate: '2027-06-15',
        timeSlot: '10:30 - 11:30',
        carName: 'Toyota Camry'
      })
    });
    const appt = (await slotRes.json()).data;
    assert.equal(slotRes.status, 201);

    const idorCancel = await fetch(`${baseUrl}/appointments/${appt.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyer2Token}` },
      body: JSON.stringify({ status: 'Đã hủy' })
    });
    assert.equal(idorCancel.status, 403);
  });

  it('SIG-P0-003: Support ticket lookup denies unauthenticated guessing & cross-buyer access, requires secret token for guests', async () => {
    const guestCreate = await fetch(`${baseUrl}/support/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: 'Yêu cầu báo giá lăn bánh khách lẻ',
        category: 'Tư vấn Sản phẩm',
        description: 'Xin tư vấn thủ tục trả góp cho mẫu VinFast VF 9.',
        customerName: 'Khách Lẻ'
      })
    });
    const createdTicket = (await guestCreate.json()).data;
    assert.equal(guestCreate.status, 201);
    assert.ok(createdTicket.accessToken, 'Guest ticket creation must issue one-time accessToken');

    const unauthLookup = await fetch(`${baseUrl}/support/tickets/lookup?code=${createdTicket.ticketCode}`);
    assert.equal(unauthLookup.status, 401);

    const otherBuyerLookup = await fetch(`${baseUrl}/support/tickets/lookup?code=${createdTicket.ticketCode}`, {
      headers: { Authorization: `Bearer ${buyer2Token}` }
    });
    assert.equal(otherBuyerLookup.status, 403);

    const validGuestLookup = await fetch(`${baseUrl}/support/tickets/lookup?code=${createdTicket.ticketCode}&accessToken=${createdTicket.accessToken}`);
    assert.equal(validGuestLookup.status, 200);
    const validData = await validGuestLookup.json();
    assert.equal(validData.data.guestAccessTokenHash, undefined);
  });

  it('SIG-P0-005: Password change increments sessionVersion and immediately revokes old JWTs', async () => {
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `revoke_${Date.now()}@example.com`,
        password: 'OldPassword@123',
        fullName: 'Session Revoke User',
        phone: '0933445566'
      })
    });
    const { token: oldToken } = (await regRes.json()).data;

    const pwdRes = await fetch(`${baseUrl}/auth/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oldToken}` },
      body: JSON.stringify({ currentPassword: 'OldPassword@123', newPassword: 'NewPassword@456' })
    });
    const pwdData = await pwdRes.json();
    assert.equal(pwdRes.status, 200);
    assert.ok(pwdData.data.token);

    const oldMeRes = await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${oldToken}` } });
    assert.equal(oldMeRes.status, 401, 'Old token must be rejected after sessionVersion bump');

    const newMeRes = await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${pwdData.data.token}` } });
    assert.equal(newMeRes.status, 200);
  });

  it('SIG-P0-001: Atomic storage rolls back RAM state on ENOSPC disk failure', async () => {
    const StorageEngine = app.storageEngine;
    const prevConfig = StorageEngine.getStorageConfig();
    const mockFs = createMockFs({ failWriteOnCall: 2, errCode: 'ENOSPC' });

    try {
      StorageEngine.configureStorage({
        mode: 'json',
        dataFile: 'C:\\virtual\\enospc-test.json',
        fsImpl: mockFs,
        allowDevSeed: false
      });
      StorageEngine.resetToEmpty();
      StorageEngine.dbState.vehicles.push({ id: 'v1', name: 'Baseline Car', price: 1000000000, stock: 5 });
      StorageEngine.saveToDisk();

      await assert.rejects(async () => {
        await StorageEngine.runInTransaction(async (state) => {
          state.vehicles[0].stock = 999;
        });
      }, /No space left on device/i);

      assert.equal(StorageEngine.dbState.vehicles[0].stock, 5, 'RAM state MUST roll back cleanly when disk save fails');
    } finally {
      StorageEngine.configureStorage({ mode: prevConfig.mode, allowDevSeed: prevConfig.allowDevSeed, fsImpl: require('fs') });
      app.reset();
    }
  });

  it('Financing API handles 0% down/rate cleanly and rejects invalid negative/NaN bounds', async () => {
    const zeroRateRes = await fetch(`${baseUrl}/financing/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehiclePrice: 1200000000, downPaymentPercent: 0, annualInterestRatePercent: 0, termMonths: 12 })
    });
    const zeroData = (await zeroRateRes.json()).data;
    assert.equal(zeroRateRes.status, 200);
    assert.equal(zeroData.monthlyPayment, 100000000);
    assert.equal(zeroData.totalInterest, 0);

    const negRateRes = await fetch(`${baseUrl}/financing/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehiclePrice: 1200000000, downPaymentPercent: 20, annualInterestRatePercent: -5, termMonths: 36 })
    });
    assert.equal(negRateRes.status, 400);
  });

  it('SIG-P0-009 / SIG-P0-010: Data integrity check & SQL migration dry-run succeed cleanly', () => {
    const audit = auditDataIntegrity();
    assert.equal(audit.ok, true, `Data integrity issues: ${audit.issues.join('; ')}`);

    const mig = runMigration({ dryRun: true });
    assert.equal(mig.ok, true);
    assert.equal(mig.migrationsApplied, 7);
    assert.equal(mig.counts.vehicles, 24);
  });
});
