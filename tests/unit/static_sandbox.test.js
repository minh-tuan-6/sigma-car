const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createBrowserSandbox() {
  const storage = new Map();
  const events = [];

  const localStorageMock = {
    getItem(k) { return storage.has(k) ? storage.get(k) : null; },
    setItem(k, v) { storage.set(k, String(v)); },
    removeItem(k) { storage.delete(k); },
    clear() { storage.clear(); }
  };

  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    URL,
    URLSearchParams,
    Error,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    Promise,
    setTimeout,
    clearTimeout,
    AbortController: globalThis.AbortController,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    localStorage: localStorageMock,
    sessionStorage: localStorageMock,
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      text: async () => '<!DOCTYPE html><html><body>SPA Fallback</body></html>'
    })
  };

  const windowMock = {
    location: { hostname: 'sigma-car.pages.dev', hash: '' },
    dispatchEvent: (evt) => { events.push(evt); return true; }
  };
  sandbox.window = windowMock;
  sandbox.globalThis = sandbox;
  sandbox.dispatchEvent = windowMock.dispatchEvent;

  const rootDir = path.resolve(__dirname, '..', '..');
  const scripts = ['js/data.js', 'js/static-sandbox.js', 'js/api-client.js'];
  vm.createContext(sandbox);
  for (const rel of scripts) {
    const code = fs.readFileSync(path.join(rootDir, rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }
  const exportsFromVm = vm.runInContext('({ ApiClient, SIGMA_DATA, SigmaStaticSandbox: window.SigmaStaticSandbox })', sandbox);
  Object.assign(sandbox, exportsFromVm);

  return { sandbox, storage, events };
}

describe('Unit Test: Static CDN Fallback & Opt-In Demo Sandbox Isolation (H-01)', () => {
  it('allows public read-only catalog & estimators while strictly failing writes/checkout when Demo Mode is off', async () => {
    const { sandbox, storage, events } = createBrowserSandbox();
    const { ApiClient } = sandbox;

    // Pre-existing stale live session token must not allow spoofing checkout on static CDN
    storage.set('sigmacar_user', JSON.stringify({ id: 'usr_old', email: 'old@example.com', role: 'buyer' }));
    storage.set('sigmacar_auth_token', 'stale_pre_p4_token');

    const vehicles = await ApiClient.vehicles.getAll();
    assert.ok(Array.isArray(vehicles) && vehicles.length > 0);

    const tco = await ApiClient.tco.estimate({ region: 'hanoi', fuelType: 'ev', monthlyKm: 1200 });
    assert.strictEqual(tco.isEstimateOnly, true);
    assert.ok(tco.monthlyEnergy > 0);

    const regEst = await ApiClient.registration.estimate({ vehiclePrice: 1500000000, fuel: 'ev', province: 'hanoi' });
    assert.strictEqual(regEst.breakdown.registrationTax, 0);

    const stations = await ApiClient.charging.findStations({ province: 'hanoi' });
    assert.ok(Array.isArray(stations.stations) && stations.stations.length >= 1);

    // Transactional / auth routes MUST reject in Live mode when hitting static HTML CDN
    await assert.rejects(
      () => ApiClient.quotes.create({ items: [{ itemType: 'vehicle', itemId: vehicles[0].id, quantity: 1 }], branchId: 'hn-caugiay', deliveryMethod: 'showroom' }),
      (err) => err.code === 'BACKEND_UNAVAILABLE' && err.status === 503
    );

    await assert.rejects(
      () => ApiClient.auth.login({ email: 'minhhoang.sigma@example.com', password: 'Buyer@123456' }),
      (err) => err.code === 'BACKEND_UNAVAILABLE' && err.status === 503
    );

    assert.ok(events.some(e => e.type === 'sigmacar:backend-unavailable'));
  });

  it('enforces credentials, forces buyer role on register, isolates demo keys, and completes full checkout flow in Demo Mode', async () => {
    const { sandbox, storage } = createBrowserSandbox();
    const { ApiClient, SIGMA_DATA } = sandbox;

    // Add an item to guest draft BEFORE enabling Demo Mode
    ApiClient.cart.addGuestDraftItem({
      itemType: 'vehicle',
      itemId: SIGMA_DATA.cars[0].id,
      quantity: 1
    });

    // Stale live token remains isolated from demo session
    storage.set('sigmacar_user', JSON.stringify({ id: 'live_u', email: 'live@example.com' }));
    storage.set('sigmacar_auth_token', 'live_jwt');

    ApiClient.setDemoMode(true);
    assert.strictEqual(ApiClient.isDemoMode(), true);
    assert.strictEqual(ApiClient.getToken(), null);
    assert.strictEqual(ApiClient.getCurrentUser(), null);

    // Wrong password MUST fail cleanly
    await assert.rejects(
      () => ApiClient.auth.login({ email: 'minhhoang.sigma@example.com', password: 'wrong' }),
      (err) => err.status === 401
    );

    // Registering with role: 'admin' MUST be coerced to 'buyer'
    const regRes = await ApiClient.auth.register({
      fullName: 'Khách Demo Mới',
      phone: '0901234567',
      role: 'admin',
      email: 'newbuyer.demo@example.com',
      password: 'Password123'
    });
    assert.strictEqual(regRes.user.role, 'buyer');
    assert.ok(storage.get('sigmacar_demo_auth_token'));
    assert.strictEqual(storage.get('sigmacar_auth_token'), 'live_jwt');

    // Pre-login guest quote estimation in Demo Sandbox must work for guest cart preview
    const guestCivicQuote = await ApiClient.quotes.create({
      items: [{ itemType: 'vehicle', itemId: 'honda-civic-type-r-2018', quantity: 1 }],
      branchId: 'hn-caugiay',
      deliveryMethod: 'showroom'
    });
    assert.strictEqual(guestCivicQuote.lines[0].itemId, 'honda-civic-type-r-2018');
    assert.ok(guestCivicQuote.totalAmount > 0);

    // Switch login to seeded demo buyer and merge guest cart -> quote -> checkout -> sandbox payment
    const loginRes = await ApiClient.auth.login({
      email: 'minhhoang.sigma@example.com',
      password: 'Buyer@123456'
    });
    assert.strictEqual(loginRes.user.role, 'buyer');
    assert.strictEqual(loginRes.user.isDemoSandbox, true);

    assert.ok(sandbox.window.SIGMA_DATA && sandbox.window.SIGMA_DATA.cars.length > 0);
    assert.ok(sandbox.window.ApiClient && sandbox.window.SigmaStaticSandbox);

    const invCheck = await ApiClient.inventory.getByVehicle('honda-civic-type-r-2018');
    assert.ok(Array.isArray(invCheck.branches) && invCheck.branches.length > 0);

    // Every new & certified vehicle in SIGMA_DATA must resolve cleanly for checkout quote
    for (const c of SIGMA_DATA.cars) {
      const qAll = await ApiClient.quotes.create({
        items: [{ itemType: 'vehicle', itemId: c.id, quantity: 1 }],
        branchId: 'hn-caugiay',
        deliveryMethod: 'showroom'
      });
      assert.strictEqual(qAll.lines[0].itemId, c.id);
      assert.ok(qAll.totalAmount > 0, `Expected positive totalAmount for ${c.id}`);
    }
    for (const cpo of SIGMA_DATA.certifiedCars) {
      const qCpo = await ApiClient.quotes.create({
        items: [{ itemType: 'certified', itemId: cpo.id, quantity: 1 }],
        branchId: 'hn-caugiay',
        deliveryMethod: 'showroom'
      });
      assert.strictEqual(qCpo.lines[0].itemId, cpo.id);
      assert.strictEqual(qCpo.lines[0].isCertified, true);
    }

    await ApiClient.cart.mergeGuestDraftOnLogin();
    const cart = await ApiClient.cart.get();
    assert.strictEqual(cart.items.length, 1);
    assert.ok(cart.totalAmount > 0);

    // Explicitly verify non-first catalog model checkout (e.g. hyundai-elantra-n-2024 & honda-civic-type-r-2018)
    for (const targetId of ['hyundai-elantra-n-2024', 'honda-civic-type-r-2018']) {
      const qTarget = await ApiClient.quotes.create({
        items: [{ itemType: 'vehicle', itemId: targetId, quantity: 1 }],
        branchId: 'hn-caugiay',
        deliveryMethod: 'showroom'
      });
      assert.strictEqual(qTarget.lines[0].itemId, targetId);
      assert.ok(qTarget.totalAmount > 0);
    }

    const quote = await ApiClient.quotes.create({
      items: cart.items,
      branchId: 'hn-caugiay',
      deliveryMethod: 'showroom'
    });
    assert.ok(quote.id.startsWith('qt_demo_'));

    const checkoutRes = await ApiClient.checkout.submit({
      source: 'cart',
      quoteId: quote.id,
      branchId: 'hn-caugiay',
      deliveryMethod: 'showroom',
      buyerName: 'Minh Hoàng',
      buyerPhone: '0912345678',
      paymentMode: 'deposit',
      acceptedPolicy: true
    }, 'idem_demo_001');

    assert.ok(checkoutRes.order);
    assert.strictEqual(checkoutRes.order.isDemoSandbox, true);
    assert.strictEqual(checkoutRes.order.paymentStatus, 'unpaid');
    assert.ok(checkoutRes.order.reservationExpiresAt);
    assert.ok(Array.isArray(checkoutRes.order.history) && checkoutRes.order.history.length >= 1);

    const intent = await ApiClient.payments.createIntent({
      orderId: checkoutRes.order.id,
      mode: 'deposit',
      provider: 'napas_qr_sandbox'
    }, 'pi_idem_001');
    assert.strictEqual(intent.status, 'pending');
    assert.strictEqual(intent.isDemoSandbox, true);
    assert.ok(intent.providerRef);

    const sim = await ApiClient.payments.simulateSandbox({
      intentId: intent.id,
      status: 'succeeded'
    });
    assert.strictEqual(sim.intent.status, 'succeeded');
    assert.strictEqual(sim.order.paymentStatus, 'deposit_paid');
    assert.strictEqual(sim.order.paidAmount, sim.order.depositAmount);

    const history = await ApiClient.payments.getHistory(checkoutRes.order.id);
    assert.strictEqual(history.totalAmount, checkoutRes.order.totalAmount);
    assert.strictEqual(history.depositAmount, checkoutRes.order.depositAmount);
    assert.strictEqual(history.paidAmount, sim.order.depositAmount);
    assert.strictEqual(history.ledger.length, 1);
    assert.strictEqual(history.intents[0].providerRef, intent.providerRef);
    assert.ok(sim.order.history.length >= 2);
    assert.ok(storage.has('sigmacar_demo_store_v1'));

    // Toggling Demo Mode OFF isolates back to live credentials cleanly
    ApiClient.setDemoMode(false);
    assert.strictEqual(ApiClient.getToken(), 'live_jwt');
  });
});
