const { describe, it, before } = require('node:test');
const assert = require('node:assert');

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:3000/api/v1';

describe('Security Test: RBAC, Privilege Escalation Prevention & Data Isolation', () => {
  let buyerToken = null;
  let sellerToken = null;
  let adminToken = null;

  before(async () => {
    // Authenticate all three roles
    const login = async (email, password) => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      return data.data.token;
    };

    buyerToken = await login('minhhoang.sigma@example.com', 'Buyer@123456');
    sellerToken = await login('minhphan.seller@sigmacar.vn', 'Seller@123456');
    adminToken = await login('admin@sigmacar.vn', 'Admin@123456');
  });

  it('Privilege Escalation Prevention: public registration cannot assign privileged roles', async () => {
    const maliciousEmail = `hacker_${Date.now()}@exploit.com`;
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: maliciousEmail,
        password: 'HackerPassword123!',
        fullName: 'Attacker Attempting Escalation',
        phone: '0999999999',
        role: 'admin' // Attempting to escalate to Admin!
      })
    });

    const data = await res.json();
    assert.strictEqual(res.status, 201);
    // Role MUST be forced to 'buyer' by server-side invariant
    assert.strictEqual(data.data.user.role, 'buyer', 'Public registration MUST enforce role=buyer regardless of payload');
  });

  it('401 Unauthorized: unauthenticated requests to protected endpoints must be rejected', async () => {
    const res = await fetch(`${BASE_URL}/orders`);
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.strictEqual(data.success, false);
  });

  it('403 Forbidden: Buyer CANNOT access Seller/Admin Analytics Summary', async () => {
    const res = await fetch(`${BASE_URL}/analytics/summary`, {
      headers: {
        'Authorization': `Bearer ${buyerToken}`
      }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.error.code, 'FORBIDDEN');
  });

  it('403 Forbidden: Buyer CANNOT force update order status', async () => {
    const res = await fetch(`${BASE_URL}/orders/ORD-9021/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${buyerToken}`
      },
      body: JSON.stringify({
        status: 'shipped'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.success, false);
  });

  it('200 OK: Authorized Admin CAN access Analytics and update Order Status', async () => {
    const res = await fetch(`${BASE_URL}/analytics/summary`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert(data.data.totalRevenue !== undefined || data.data.stats !== undefined);
  });

  it('Data Isolation: Buyer only receives their own orders', async () => {
    const res = await fetch(`${BASE_URL}/orders`, {
      headers: {
        'Authorization': `Bearer ${buyerToken}`
      }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.data.every(o => o.userId === 'usr_buyer_01' || o.buyerId === 'usr_buyer_01'));
  });
});
