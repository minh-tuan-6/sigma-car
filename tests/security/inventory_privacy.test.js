// tests/security/inventory_privacy.test.js
// T0.4 — the public stock endpoint must not expose staff ids or internal references in recentMovements.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-app');

describe('T0.4 inventory movements privacy', () => {
  let app = null;
  let baseUrl = '';
  let adminToken = '';
  let buyerToken = '';
  const vehicleId = 'vinfast-vf3';

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
    assert.equal(r.status, 200);
    return r.body.data.token;
  };

  before(async () => {
    app = await startTestServer({ mode: 'memory', reseed: true });
    baseUrl = app.baseUrl;
    adminToken = await login('admin@sigmacar.vn', 'Admin@123456');
    buyerToken = await login('minhhoang.sigma@example.com', 'Buyer@123456');
    const adj = await api(`/inventory/${vehicleId}`, {
      method: 'PATCH', token: adminToken, body: { branchId: 'hn-caugiay', delta: 1, reason: 'T0.4 test restock' }
    });
    assert.equal(adj.status, 200, JSON.stringify(adj.body));
  });
  after(async () => { if (app) await app.close(); });

  const assertRedacted = (data) => {
    assert.ok(Array.isArray(data.recentMovements) && data.recentMovements.length > 0);
    for (const m of data.recentMovements) {
      assert.equal(m.actorId, undefined);
      assert.equal(m.referenceId, undefined);
      assert.ok(m.vehicleId && m.createdAt && typeof m.delta === 'number', 'other movement fields are kept');
    }
  };

  it('anonymous callers get movements without actorId/referenceId', async () => {
    const r = await api(`/inventory/${vehicleId}`);
    assert.equal(r.status, 200);
    assertRedacted(r.body.data);
    assert.ok(Array.isArray(r.body.data.branches), 'response shape unchanged');
  });

  it('buyers get the redacted view too', async () => {
    const r = await api(`/inventory/${vehicleId}`, { token: buyerToken });
    assertRedacted(r.body.data);
  });

  it('staff still see actorId', async () => {
    const r = await api(`/inventory/${vehicleId}`, { token: adminToken });
    assert.equal(r.status, 200);
    assert.ok(r.body.data.recentMovements.some(m => m.actorId), 'admin sees actorId');
  });
});
