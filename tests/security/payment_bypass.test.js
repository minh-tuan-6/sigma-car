// tests/security/payment_bypass.test.js
// T0.1 — POST /orders/:id/complete-payment must not trust client-supplied settlement evidence.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startTestServer } = require('../helpers/test-app');
const PaymentGateway = require('../../backend/infrastructure/payment-gateway');

describe('T0.1 complete-payment rejects forged verification', () => {
  let app = null;
  let baseUrl = '';
  let adminToken = '';
  let buyer1Token = '';
  let buyer2Token = '';

  const api = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, body: json };
  };

  const loginAs = async (email, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(r.status, 200, `login ${email}`);
    return r.body.data.token;
  };

  // Picks any vehicle/branch that still has stock so the test does not depend on seed quantities.
  const createOrder = async (token) => {
    const vehicles = (await api('/vehicles')).body.data;
    const list = Array.isArray(vehicles) ? vehicles : (vehicles.items || vehicles.vehicles || []);
    for (const v of list) {
      const inv = await api(`/inventory/${encodeURIComponent(v.id)}`);
      const branch = inv.status === 200 && (inv.body.data.branches || []).find(b => b.availableQty > 0);
      if (!branch) continue;
      const r = await api('/orders/deposit', {
        method: 'POST',
        token,
        body: { vehicleId: v.id, branchId: branch.branchId, buyerName: 'T0.1 Buyer', buyerPhone: '0912345678' }
      });
      if (r.status === 201) return r.body.data;
    }
    throw new Error('No vehicle with available stock in the test seed');
  };

  const getOrder = async (id, token) => {
    const r = await api(`/orders/${id}`, { token });
    assert.equal(r.status, 200);
    return r.body.data;
  };

  // Creates a deposit intent and settles it through the signed gateway webhook (the legitimate path).
  const settleDepositIntent = async (order, token) => {
    const intentRes = await api('/payments/intents', {
      method: 'POST',
      token,
      body: { orderId: order.id, mode: 'deposit', provider: 'napas_qr_sandbox' }
    });
    assert.equal(intentRes.status, 201, JSON.stringify(intentRes.body));
    const intent = intentRes.body.data;
    const payload = JSON.stringify({
      eventId: `evt_t01_${crypto.randomUUID().slice(0, 8)}`,
      intentId: intent.id,
      status: 'succeeded',
      amount: intent.amount,
      currency: 'VND'
    });
    const sig = PaymentGateway.signWebhookPayload(payload, PaymentGateway.getWebhookSecret('napas_qr_sandbox'));
    const wh = await api('/payments/webhooks/napas_qr_sandbox', {
      method: 'POST',
      headers: { 'x-webhook-signature': `sha256=${sig}` },
      body: payload
    });
    assert.equal(wh.status, 200, JSON.stringify(wh.body));
    return intent;
  };

  before(async () => {
    app = await startTestServer({ mode: 'memory', reseed: true });
    baseUrl = app.baseUrl;
    adminToken = await loginAs('admin@sigmacar.vn', 'Admin@123456');
    buyer1Token = await loginAs('minhhoang.sigma@example.com', 'Buyer@123456');
    buyer2Token = await loginAs('thanhthao.ev@example.com', 'Buyer@123456');
  });

  after(async () => {
    if (app) await app.close();
  });

  it('rejects a buyer-forged verifiedByWebhook flag and leaves the order unpaid', async () => {
    const order = await createOrder(buyer1Token);
    const forged = await api(`/orders/${order.id}/complete-payment`, {
      method: 'POST',
      token: buyer1Token,
      body: { verifiedByWebhook: true, amount: order.unitPrice, paymentMethod: 'QR Napas' }
    });
    assert.equal(forged.status, 409);
    assert.equal(forged.body.error.code, 'PAYMENT_VERIFICATION_REQUIRED');
    const after = await getOrder(order.id, buyer1Token);
    assert.equal(after.paymentStatus, 'Unpaid');
    assert.equal(after.paidAmount || 0, 0);
  });

  it('rejects buyer-supplied adminVerified / transactionRef', async () => {
    const order = await createOrder(buyer1Token);
    const forged = await api(`/orders/${order.id}/complete-payment`, {
      method: 'POST',
      token: buyer1Token,
      body: { adminVerified: true, transactionRef: 'FAKE-REF', amount: order.unitPrice }
    });
    assert.equal(forged.status, 409);
  });

  it('a verified intent settles only at the intent amount, never a client-inflated amount', async () => {
    const order = await createOrder(buyer1Token);
    const intent = await settleDepositIntent(order, buyer1Token);
    const before = await getOrder(order.id, buyer1Token);
    assert.equal(before.paidAmount, intent.amount);
    assert.ok(intent.amount < order.unitPrice, 'deposit must be smaller than the vehicle price');

    const inflated = await api(`/orders/${order.id}/complete-payment`, {
      method: 'POST',
      token: buyer1Token,
      body: { paymentIntentId: intent.id, amount: order.unitPrice, verifiedByWebhook: true }
    });
    assert.equal(inflated.status, 200, JSON.stringify(inflated.body));
    assert.equal(inflated.body.data.paidAmount, intent.amount);
    assert.notEqual(inflated.body.data.paymentStatus, 'Fully_Paid');

    // Re-submitting the same intent must not settle it twice.
    const replay = await api(`/orders/${order.id}/complete-payment`, {
      method: 'POST',
      token: buyer1Token,
      body: { paymentIntentId: intent.id }
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.data.paidAmount, intent.amount);
  });

  it("rejects another order's intent", async () => {
    const orderA = await createOrder(buyer1Token);
    const intentA = await settleDepositIntent(orderA, buyer1Token);
    const orderB = await createOrder(buyer1Token);
    const cross = await api(`/orders/${orderB.id}/complete-payment`, {
      method: 'POST',
      token: buyer1Token,
      body: { paymentIntentId: intentA.id }
    });
    assert.equal(cross.status, 409);
  });

  it('keeps admin settlement with a transaction reference', async () => {
    const order = await createOrder(buyer1Token);
    const settled = await api(`/orders/${order.id}/complete-payment`, {
      method: 'POST',
      token: adminToken,
      body: { transactionRef: 'BANK-REF-001', amount: order.unitPrice, paymentMethod: 'Chuyển khoản' }
    });
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    assert.equal(settled.body.data.paymentStatus, 'Fully_Paid');
  });

  it("forbids completing another buyer's order", async () => {
    const order = await createOrder(buyer1Token);
    const other = await api(`/orders/${order.id}/complete-payment`, {
      method: 'POST',
      token: buyer2Token,
      body: { verifiedByWebhook: true }
    });
    assert.equal(other.status, 403);
  });
});
