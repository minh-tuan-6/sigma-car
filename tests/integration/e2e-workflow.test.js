const { describe, it } = require('node:test');
const assert = require('node:assert');

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:3000/api/v1';

describe('End-to-End Workflow: Complete EV Commerce Customer & Dealer Journey', () => {
  let buyerToken = null;
  let buyerUser = null;
  let sellerToken = null;
  let createdOrderId = null;
  let createdAppointmentId = null;

  it('Step 1: Buyer browses catalog and queries vehicle specifications', async () => {
    const res = await fetch(`${BASE_URL}/vehicles/model-e`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.data.name, 'SIGMA Model E');
    assert.strictEqual(data.data.price, 1290000000);
  });

  it('Step 2: Buyer registers account (Server forces BUYER role)', async () => {
    const email = `journey_buyer_${Date.now()}@sigmacar.vn`;
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'SecurePassword@2026',
        fullName: 'Nguyễn Tiến Dũng',
        phone: '0977889900'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.data.user.role, 'buyer');
    buyerToken = data.data.token;
    buyerUser = data.data.user;
  });

  it('Step 3: Buyer calculates financing quotation before booking', async () => {
    const res = await fetch(`${BASE_URL}/financing/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehiclePrice: 1290000000,
        downPaymentPercent: 20,
        annualInterestRatePercent: 7.9,
        termMonths: 36
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.data.downPaymentAmount, 258000000);
  });

  it('Step 4: Buyer books a test drive appointment', async () => {
    const dynamicDate = `2027-02-${Math.floor(Math.random() * 25 + 1)}`;
    const dynamicSlot = `Slot-${Date.now().toString().slice(-4)}`;
    const res = await fetch(`${BASE_URL}/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${buyerToken}`
      },
      body: JSON.stringify({
        customerName: buyerUser.fullName,
        phone: buyerUser.phone,
        email: buyerUser.email,
        branchId: 'hn-caugiay',
        preferredDate: dynamicDate,
        timeSlot: dynamicSlot,
        carName: 'SIGMA Model E'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    createdAppointmentId = data.data.id;
    assert(data.data.status === 'Chờ xác nhận' || data.data.status === 'Pending');
  });

  it('Step 5: Buyer places deposit order (Authoritative server pricing & inventory reservation)', async () => {
    const res = await fetch(`${BASE_URL}/orders/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${buyerToken}`
      },
      body: JSON.stringify({
        vehicleId: 'model-e',
        branchId: 'hn-caugiay',
        buyerName: buyerUser.fullName,
        buyerPhone: buyerUser.phone,
        paymentMethod: 'Chuyển khoản QR Napas 24/7'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    createdOrderId = data.data.id;
    assert.strictEqual(data.data.depositAmount, 50000000);
    assert.strictEqual(data.data.orderStatus, 'Pending');
  });

  it('Step 6: Buyer verifies data isolation (Views only their own orders)', async () => {
    const res = await fetch(`${BASE_URL}/orders`, {
      headers: { 'Authorization': `Bearer ${buyerToken}` }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.data.every(o => o.userId === buyerUser.id || o.buyerId === buyerUser.id));
  });

  it('Step 7: Seller signs in and processes authorized order to Confirmed', async () => {
    // Login as Seller
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'minhphan.seller@sigmacar.vn', password: 'Seller@123456' })
    });
    const loginData = await loginRes.json();
    sellerToken = loginData.data.token;

    // Transition order to Confirmed
    const patchRes = await fetch(`${BASE_URL}/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sellerToken}`
      },
      body: JSON.stringify({ status: 'Confirmed' })
    });
    const patchData = await patchRes.json();
    assert.strictEqual(patchRes.status, 200);
    assert.strictEqual(patchData.data.orderStatus, 'Confirmed');
  });

  it('Step 8: Unauthorized operations are blocked (Buyer cannot modify confirmed order status)', async () => {
    const res = await fetch(`${BASE_URL}/orders/${createdOrderId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${buyerToken}`
      },
      body: JSON.stringify({ status: 'Cancelled' })
    });
    assert.strictEqual(res.status, 403);
  });

  it('Step 9: Seller confirms test drive appointment', async () => {
    const res = await fetch(`${BASE_URL}/appointments/${createdAppointmentId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sellerToken}`
      },
      body: JSON.stringify({ status: 'Confirmed' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.data.status === 'Đã xác nhận' || data.data.status === 'Confirmed');
  });

  it('Step 10: Admin checks real stored analytics', async () => {
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@sigmacar.vn', password: 'Admin@123456' })
    });
    const loginData = await loginRes.json();
    const adminToken = loginData.data.token;

    const res = await fetch(`${BASE_URL}/analytics/summary`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.data.totalRevenueNumber > 0);
  });
});
