const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { startTestServer } = require('../helpers/test-app');

describe('Integration Test: SIGMACAR REST API v1', () => {
  let app = null;
  let BASE_URL = '';
  let buyerToken = null;
  let sellerToken = null;
  let adminToken = null;

  before(async () => {
    app = await startTestServer({ mode: 'memory', reseed: true });
    BASE_URL = app.baseUrl;
    const res = await fetch(`${BASE_URL}/vehicles`);
    assert.strictEqual(res.status, 200);
  });

  after(async () => {
    if (app) await app.close();
  });

  it('POST /auth/login - should authenticate seeded accounts successfully', async () => {
    // 1. Buyer
    let res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'minhhoang.sigma@example.com', password: 'Buyer@123456' })
    });
    let data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.data.user.role, 'buyer');
    assert(data.data.token);
    buyerToken = data.data.token;

    // 2. Seller
    res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'minhphan.seller@sigmacar.vn', password: 'Seller@123456' })
    });
    data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.data.user.role, 'seller');
    sellerToken = data.data.token;

    // 3. Admin
    res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@sigmacar.vn', password: 'Admin@123456' })
    });
    data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.data.user.role, 'admin');
    adminToken = data.data.token;
  });

  it('POST /auth/login - should reject invalid password with 401', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@sigmacar.vn', password: 'WrongPassword!' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.strictEqual(data.success, false);
  });

  it('GET /vehicles - should retrieve catalog with server-side filtering', async () => {
    const res = await fetch(`${BASE_URL}/vehicles`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert(Array.isArray(data.data));
    assert(data.data.length >= 4);

    // Filter by type: certified
    const certRes = await fetch(`${BASE_URL}/vehicles?type=certified`);
    const certData = await certRes.json();
    assert.strictEqual(certRes.status, 200);
    assert(certData.data.every(v => v.condition === 'certified' || v.type === 'certified'));
  });

  it('POST /financing/calculate - should compute accurate loan estimates via API', async () => {
    const res = await fetch(`${BASE_URL}/financing/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehiclePrice: 1290000000,
        downPaymentPercent: 30,
        annualInterestRatePercent: 7.9,
        termMonths: 60
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.data.downPaymentAmount, 387000000);
    assert(data.data.monthlyPayment > 18000000);
  });

  it('POST /appointments - should book appointment and PREVENT double booking collision', async () => {
    const testDate = `2029-12-${String(Math.floor(Math.random() * 20 + 1)).padStart(2, '0')}`;
    const testSlot = `Slot-${Date.now()}`;
    const branchId = 'hn-caugiay';

    // 1. First booking should succeed
    const res1 = await fetch(`${BASE_URL}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Kiểm Thử Viên 1',
        customerPhone: '0988776655',
        customerEmail: 'tester1@sigmacar.vn',
        branchId,
        date: testDate,
        timeSlot: testSlot,
        vehicleModel: 'SIGMA Model E'
      })
    });
    const data1 = await res1.json();
    assert.strictEqual(res1.status, 201);
    assert.strictEqual(data1.success, true);
    assert(data1.data.id, 'Appointment should have unique generated ID');

    // 2. Second booking with identical branch, date and slot MUST fail with 409 Conflict
    const res2 = await fetch(`${BASE_URL}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Kiểm Thử Viên 2',
        customerPhone: '0911223344',
        customerEmail: 'tester2@sigmacar.vn',
        branchId,
        date: testDate,
        timeSlot: testSlot,
        vehicleModel: 'SIGMA Vision S'
      })
    });
    const data2 = await res2.json();
    assert.strictEqual(res2.status, 409);
    assert.strictEqual(data2.success, false);
    assert(data2.error.message.includes('đã có người đặt'));
  });

  it('POST /orders/deposit - should calculate price on server and reserve inventory atomically', async () => {
    // Generate isolated fresh buyer to prevent duplicate checkout window collision
    const testEmail = `deposit_buyer_${Date.now()}@sigmacar.vn`;
    const regRes = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'Password@123',
        fullName: 'Test Deposit Buyer',
        phone: '0981122334'
      })
    });
    const regData = await regRes.json();
    assert.strictEqual(regRes.status, 201);
    const freshToken = regData.data.token;

    // Check initial stock for Cybertruck
    const vResBefore = await fetch(`${BASE_URL}/vehicles/tesla-cybertruck`);
    const vDataBefore = await vResBefore.json();
    const initialStock = vDataBefore.data.stockQuantity;

    // Place deposit order
    const orderRes = await fetch(`${BASE_URL}/orders/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${freshToken}`
      },
      body: JSON.stringify({
        vehicleId: 'tesla-cybertruck',
        branchId: 'hn-caugiay',
        buyerName: 'Test Deposit Buyer',
        buyerPhone: '+84 981 122 334',
        paymentMethod: 'Chuyển khoản QR Napas 24/7'
      })
    });
    const orderData = await orderRes.json();
    assert.strictEqual(orderRes.status, 201);
    assert.strictEqual(orderData.success, true);
    assert(orderData.data.orderNumber);
    assert.strictEqual(orderData.data.depositAmount, 50000000); // Server enforced 50M VND

    // Check stock was decremented by 1
    const vResAfter = await fetch(`${BASE_URL}/vehicles/tesla-cybertruck`);
    const vDataAfter = await vResAfter.json();
    assert.strictEqual(vDataAfter.data.stockQuantity, initialStock - 1);
  });
});
