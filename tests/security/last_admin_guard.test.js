// tests/security/last_admin_guard.test.js
// T0.3 — the last active admin can be neither demoted nor disabled; multi-admin management keeps working.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('../helpers/test-app');

describe('T0.3 last active admin protection', () => {
  let app = null;
  let baseUrl = '';

  const api = async (path, { method = 'GET', body, token } = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, body: json };
  };
  const login = async (email, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(r.status, 200, `login ${email}`);
    return r.body.data.token;
  };
  const findUserId = async (token, email) => {
    const r = await api('/admin/users', { token });
    assert.equal(r.status, 200);
    const list = Array.isArray(r.body.data) ? r.body.data : (r.body.data.users || r.body.data.items || []);
    const u = list.find(x => x.email === email);
    assert.ok(u, `user ${email} listed`);
    return u.id;
  };

  before(async () => {
    app = await startTestServer({ mode: 'memory', reseed: true });
    baseUrl = app.baseUrl;
  });
  after(async () => { if (app) await app.close(); });

  it('rejects disabling the only active admin, allows it once a second admin exists', async () => {
    const admin1Token = await login('admin@sigmacar.vn', 'Admin@123456');
    const admin1Id = await findUserId(admin1Token, 'admin@sigmacar.vn');

    const selfDisable = await api(`/admin/users/${admin1Id}/role`, {
      method: 'PATCH', token: admin1Token, body: { role: 'admin', disabledAt: new Date().toISOString() }
    });
    assert.equal(selfDisable.status, 409);
    assert.equal(selfDisable.body.error.code, 'LAST_ADMIN_PROTECTED');

    const selfDemote = await api(`/admin/users/${admin1Id}/role`, {
      method: 'PATCH', token: admin1Token, body: { role: 'seller' }
    });
    assert.equal(selfDemote.status, 409, 'existing demotion guard still applies');

    // T0.5: staff creation without a password is rejected (no shared default password).
    const noPassword = await api('/admin/users', {
      method: 'POST', token: admin1Token,
      body: { fullName: 'Không Mật Khẩu', email: `nopw_${Date.now()}@sigmacar.vn`, phone: '0911000333', role: 'seller', branchId: 'hcm-q7' }
    });
    assert.equal(noPassword.status, 400);
    assert.equal(noPassword.body.error.code, 'VALIDATION_ERROR');

    const admin2Email = `admin2_${Date.now()}@sigmacar.vn`;
    const created = await api('/admin/users', {
      method: 'POST', token: admin1Token,
      body: { fullName: 'Admin Hai', email: admin2Email, phone: '0911000222', role: 'admin', branchId: 'hn-caugiay', password: 'Admin2@Strong123' }
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const admin2Token = await login(admin2Email, 'Admin2@Strong123');
    const admin2Id = created.body.data.id;

    const disableAdmin1 = await api(`/admin/users/${admin1Id}/role`, {
      method: 'PATCH', token: admin2Token, body: { role: 'admin', disabledAt: new Date().toISOString() }
    });
    assert.equal(disableAdmin1.status, 200, 'multi-admin management still allowed');

    const disableLast = await api(`/admin/users/${admin2Id}/role`, {
      method: 'PATCH', token: admin2Token, body: { role: 'admin', disabledAt: new Date().toISOString() }
    });
    assert.equal(disableLast.status, 409);
    assert.equal(disableLast.body.error.code, 'LAST_ADMIN_PROTECTED');

    const reEnable = await api(`/admin/users/${admin1Id}/role`, {
      method: 'PATCH', token: admin2Token, body: { role: 'admin', disabledAt: null }
    });
    assert.equal(reEnable.status, 200, 're-enabling an admin is never blocked');
  });
});
