const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { startTestServer } = require('../helpers/test-app');
const { dbState } = require('../../backend/infrastructure/storage-engine');
const InventoryRepository = require('../../backend/infrastructure/repositories/inventory-repository');
const CheckoutService = require('../../backend/application/checkout-service');
const PaymentGateway = require('../../backend/infrastructure/payment-gateway');
const PaymentReconciliationWorker = require('../../backend/workers/payment-reconciliation');
const FilterEngine = require('../../js/app.js');

describe('Batch P1: Catalog, Inventory Concurrency, Authoritative Cart/Quote, Atomic Checkout & HMAC Payments', () => {
  let app = null;
  let BASE_URL = '';
  let buyerToken = null;
  let buyer2Token = null;
  let sellerToken = null;
  let adminToken = null;
  let buyerUser = null;

  before(async () => {
    app = await startTestServer({ mode: 'memory', reseed: true });
    BASE_URL = app.baseUrl;

    // Login seeded accounts
    const login = async (email, password) => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      return data.data;
    };

    const b1 = await login('minhhoang.sigma@example.com', 'Buyer@123456');
    buyerToken = b1.token;
    buyerUser = b1.user;

    // Register second buyer for cross-account cart & race isolation
    const regRes = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Buyer Two P1',
        email: 'buyer2.p1@example.com',
        phone: '0911222333',
        password: 'Buyer2@123456'
      })
    });
    const regData = await regRes.json();
    assert.strictEqual(regRes.status, 201);
    buyer2Token = regData.data.token;

    const s1 = await login('minhphan.seller@sigmacar.vn', 'Seller@123456');
    sellerToken = s1.token;

    const a1 = await login('admin@sigmacar.vn', 'Admin@123456');
    adminToken = a1.token;
  });

  after(async () => {
    if (app) await app.close();
  });

  it('SIG-P1-001: import_vehicle.js --dry-run produces zero disk writes on store/data/assets', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-dryrun-'));
    try {
      const sampleJson = {
        id: 'sigma-dryrun-test-ev',
        name: 'SIGMA DryRun Concept',
        brand: 'SIGMACAR',
        category: 'SUV',
        fuel: 'ev',
        price: 1500000000,
        range: 550,
        hp: 400
      };
      fs.writeFileSync(path.join(tmpDir, 'vehicle.json'), JSON.stringify(sampleJson, null, 2), 'utf8');

      const rootDir = path.resolve(__dirname, '..', '..');
      const targetAssetDir = path.join(rootDir, 'assets', 'vehicles', 'sigma-dryrun-test-ev');
      const dataJsPath = path.join(rootDir, 'js', 'data.js');
      const storeJsonPath = path.join(rootDir, 'data', 'sigmacar_store.json');
      const dataMtimeBefore = fs.statSync(dataJsPath).mtimeMs;
      const storeMtimeBefore = fs.statSync(storeJsonPath).mtimeMs;

      const stdout = execFileSync(process.execPath, [
        path.join(rootDir, 'scripts', 'import_vehicle.js'),
        tmpDir,
        '--dry-run',
        '--no-build'
      ], { encoding: 'utf8' });

      assert(stdout.includes('DRY-RUN'), 'Expected DRY-RUN confirmation output');
      assert.strictEqual(fs.existsSync(targetAssetDir), false, '--dry-run must NOT create asset directory');
      assert.strictEqual(fs.statSync(dataJsPath).mtimeMs, dataMtimeBefore, '--dry-run must NOT touch js/data.js');
      assert.strictEqual(fs.statSync(storeJsonPath).mtimeMs, storeMtimeBefore, '--dry-run must NOT touch sigmacar_store.json');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('SIG-P1-002 & SIG-P1-003: Server-side pagination, advanced EV/monthly filters parity & related vehicles', async () => {
    const p1Res = await fetch(`${BASE_URL}/vehicles?paginated=1&page=1&pageSize=6`);
    const p1 = await p1Res.json();
    assert.strictEqual(p1Res.status, 200);
    assert.strictEqual(p1.data.length, 6);
    assert.strictEqual(p1.pagination.page, 1);
    assert(p1.pagination.total >= 24);
    assert.strictEqual(p1.pagination.hasMore, true);

    const p2Res = await fetch(`${BASE_URL}/vehicles?paginated=1&page=2&pageSize=6`);
    const p2 = await p2Res.json();
    assert.strictEqual(p2Res.status, 200);
    assert.strictEqual(p2.data.length, 6);
    const ids1 = new Set(p1.data.map(v => v.id));
    assert(p2.data.every(v => !ids1.has(v.id)), 'Page 2 items must not overlap page 1');

    // Advanced filter parity between Backend API and Frontend FilterEngine
    const allRes = await fetch(`${BASE_URL}/vehicles`);
    const allVehicles = (await allRes.json()).data;

    const apiAdvRes = await fetch(`${BASE_URL}/vehicles?fuel=ev&minRange=400&minBatteryKwh=60&sort=hp-desc&inStock=true`);
    const apiAdv = await apiAdvRes.json();
    const feAdv = FilterEngine.filterAndSortVehicles(allVehicles, {
      fuel: 'ev',
      minRange: 400,
      minBatteryKwh: 60,
      inStock: true,
      sort: 'hp-desc'
    });
    assert.deepStrictEqual(apiAdv.data.map(v => v.id), feAdv.map(v => v.id), 'Backend & Frontend advanced filters must match identically');

    // Related vehicles
    const relRes = await fetch(`${BASE_URL}/vehicles/toyota-camry/related`);
    const relData = await relRes.json();
    assert.strictEqual(relRes.status, 200);
    assert(Array.isArray(relData.data) && relData.data.length > 0 && relData.data.length <= 3);
    assert(relData.data.every(v => v.id !== 'toyota-camry'));
  });

  it('SIG-P1-004: Branch inventory concurrency (100 racers on stock=1), optimistic lock 409 & CPO qty=1 enforcement', async () => {
    // 1. Adjust branch stock to 1 and test optimistic version conflict
    const invBeforeRes = await fetch(`${BASE_URL}/inventory/toyota-camry`);
    const invBefore = await invBeforeRes.json();
    const branchRec = invBefore.data.branches.find(b => b.branchId === 'hcm-thuduc');
    assert(branchRec, 'Expected seeded hcm-thuduc branch record');

    const adjRes = await fetch(`${BASE_URL}/inventory/toyota-camry`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        branchId: 'hcm-thuduc',
        stockOnHand: 1,
        expectedVersion: branchRec.version,
        reason: 'P1 concurrency test stock=1'
      })
    });
    assert.strictEqual(adjRes.status, 200);
    const adjData = await adjRes.json();
    assert.strictEqual(adjData.data.version, branchRec.version + 1);

    // Stale expectedVersion MUST fail with 409 & return currentRecord
    const conflictRes = await fetch(`${BASE_URL}/inventory/toyota-camry`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        branchId: 'hcm-thuduc',
        delta: 1,
        expectedVersion: branchRec.version, // stale!
        reason: 'Stale write'
      })
    });
    const conflictData = await conflictRes.json();
    assert.strictEqual(conflictRes.status, 409);
    assert.strictEqual(conflictData.error.code, 'VERSION_CONFLICT');
    assert.strictEqual(conflictData.error.details.currentRecord.version, branchRec.version + 1);

    // 2. 100 concurrent reservations racing stock=1 -> STRICTLY 1 winner
    const racers = Array.from({ length: 100 }, (_, i) =>
      InventoryRepository.reserveStock({
        vehicleId: 'toyota-camry',
        branchId: 'hcm-thuduc',
        quantity: 1,
        userId: `racer-${i}`,
        orderId: `ord-race-${i}`
      }).then(r => ({ ok: true, res: r })).catch(err => ({ ok: false, code: err.code, status: err.statusCode }))
    );
    const results = await Promise.all(racers);
    const winners = results.filter(r => r.ok);
    const losers = results.filter(r => !r.ok);
    assert.strictEqual(winners.length, 1, `Strictly 1 winner allowed for stock=1, got ${winners.length}`);
    assert.strictEqual(losers.length, 99);
    assert(losers.every(l => l.status === 409));

    const postInv = await (await fetch(`${BASE_URL}/inventory/toyota-camry`)).json();
    const hcmAfter = postInv.data.branches.find(b => b.branchId === 'hcm-thuduc');
    assert.strictEqual(hcmAfter.available, 0);

    // Release test reservation cleanly
    await InventoryRepository.releaseReservation(winners[0].res.reservation.id, 'cleanup', 'test');

    // 3. CPO max stock = 1 enforcement
    const cpoAdjRes = await fetch(`${BASE_URL}/inventory/cpo-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ branchId: 'hn-caugiay', stockOnHand: 5, reason: 'Try exceeding CPO cap' })
    });
    assert.strictEqual(cpoAdjRes.status, 409);
  });

  it('SIG-P1-005 & SIG-P1-006: Authoritative quote ignores tampered price, cart optimistic concurrency, compatibility & guest merge isolation', async () => {
    // Seed a model-specific accessory temporarily for 422 compatibility check
    dbState.accessories.push({
      id: 'ACC-VF9-ONLY',
      name: 'Thảm sàn 6D riêng VF 9',
      brand: 'KATA',
      category: 'Nội thất',
      price: 3500000,
      quantity: 10,
      compatibility: ['vinfast-vf9']
    });

    try {
      // Quote ignores fake client prices/totals
      const quoteRes = await fetch(`${BASE_URL}/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}` },
        body: JSON.stringify({
          items: [{
            itemType: 'vehicle',
            itemId: 'vinfast-vf9',
            quantity: 1,
            price: 1000, // client tamper attempt
            unitPrice: 1000,
            discountAmount: 999999999,
            totalAmount: 1
          }],
          branchId: 'hn-caugiay',
          deliveryMethod: 'home_city'
        })
      });
      const qData = await quoteRes.json();
      assert.strictEqual(quoteRes.status, 201);
      assert(qData.data.itemsSubtotal >= 1000000000, 'Server MUST ignore tampered client price=1000');
      assert.strictEqual(qData.data.deliveryFee, 2500000);
      assert(qData.data.quoteHash);

      // Cart CRUD & version conflict
      const addRes = await fetch(`${BASE_URL}/cart/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}` },
        body: JSON.stringify({ itemType: 'vehicle', itemId: 'toyota-camry', quantity: 1 })
      });
      const addData = await addRes.json();
      assert.strictEqual(addRes.status, 201);
      const cartV = addData.data.version;

      // Incompatible accessory -> 422
      const incompRes = await fetch(`${BASE_URL}/cart/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}` },
        body: JSON.stringify({ itemType: 'accessory', itemId: 'ACC-VF9-ONLY', quantity: 1 })
      });
      assert.strictEqual(incompRes.status, 422);

      // Stale expectedVersion -> 409 CART_VERSION_CONFLICT
      const stalePatch = await fetch(`${BASE_URL}/cart`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}` },
        body: JSON.stringify({ expectedVersion: cartV - 1, deliveryMethod: 'intercity' })
      });
      const staleData = await stalePatch.json();
      assert.strictEqual(stalePatch.status, 409);
      assert.strictEqual(staleData.error.code, 'CART_VERSION_CONFLICT');
      assert(staleData.error.details.currentCart);

      // Guest merge adds accessory & deduplicates vehicle
      const mergeRes = await fetch(`${BASE_URL}/cart/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}` },
        body: JSON.stringify({
          guestItems: [
            { itemType: 'vehicle', itemId: 'toyota-camry', quantity: 1 },
            { itemType: 'accessory', itemId: 'ACC-001', quantity: 2 }
          ]
        })
      });
      const mergeData = await mergeRes.json();
      assert.strictEqual(mergeRes.status, 200);
      assert(mergeData.data.items.some(i => i.itemId === 'ACC-001' && i.quantity === 2));

      // Cross-account isolation: Buyer 2 sees empty cart and cannot touch Buyer 1 line
      const b2CartRes = await fetch(`${BASE_URL}/cart`, {
        headers: { 'Authorization': `Bearer ${buyer2Token}` }
      });
      const b2Cart = await b2CartRes.json();
      assert.strictEqual(b2Cart.data.items.length, 0);
      const b1LineId = mergeData.data.items[0].lineId;
      const b2Del = await fetch(`${BASE_URL}/cart/items/${b1LineId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${buyer2Token}` }
      });
      assert.strictEqual(b2Del.status, 404);
    } finally {
      const idx = dbState.accessories.findIndex(a => a.id === 'ACC-VF9-ONLY');
      if (idx !== -1) dbState.accessories.splice(idx, 1);
    }
  });

  it('SIG-P1-007: Atomic Checkout rollback on mid-transaction failure, stale/expired quotes & idempotency retry/mismatch', async () => {
    // Prepare Buyer 1 cart with promo SIGMA50
    await fetch(`${BASE_URL}/cart/promo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}` },
      body: JSON.stringify({ promoCode: 'SIGMA50' })
    });

    // Missing policy acceptance -> 422
    const noPolicyRes = await fetch(`${BASE_URL}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}`, 'Idempotency-Key': 'idem-no-pol' },
      body: JSON.stringify({ source: 'cart', buyerName: 'Buyer 1', buyerPhone: '0901234567', acceptedPolicy: false })
    });
    assert.strictEqual(noPolicyRes.status, 422);

    // Expired quote -> 409 QUOTE_EXPIRED
    const expQuote = (await (await fetch(`${BASE_URL}/quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}` },
      body: JSON.stringify({ items: [{ itemType: 'vehicle', itemId: 'vinfast-vf3', quantity: 1 }], branchId: 'hn-caugiay' })
    })).json()).data;
    const storedExpQuote = dbState.quotes.find(q => q.id === expQuote.id);
    storedExpQuote.expiresAt = new Date(Date.now() - 60000).toISOString();

    const expChkRes = await fetch(`${BASE_URL}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}` },
      body: JSON.stringify({ source: 'direct', quoteId: expQuote.id, acceptedPolicy: true, buyerName: 'Buyer 1', buyerPhone: '0901234567' })
    });
    assert.strictEqual(expChkRes.status, 409);

    // Quote staleness check: change vehicle price after quote created -> 409 QUOTE_STALE_PRICE_CHANGED
    const freshQuote = (await (await fetch(`${BASE_URL}/quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}` },
      body: JSON.stringify({ items: [{ itemType: 'vehicle', itemId: 'vinfast-vf3', quantity: 1 }], branchId: 'hn-caugiay' })
    })).json()).data;
    const vf3Obj = dbState.vehicles.find(v => v.id === 'vinfast-vf3');
    const origPrice = vf3Obj.price;
    vf3Obj.price = origPrice + 10000000;
    const staleQuoteRes = await fetch(`${BASE_URL}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}` },
      body: JSON.stringify({ source: 'direct', quoteId: freshQuote.id, acceptedPolicy: true, buyerName: 'Buyer 1', buyerPhone: '0901234567' })
    });
    vf3Obj.price = origPrice;
    const staleQuoteData = await staleQuoteRes.json();
    assert.strictEqual(staleQuoteRes.status, 409);
    assert.strictEqual(staleQuoteData.error.code, 'QUOTE_STALE_PRICE_CHANGED');

    // Mid-transaction failure hook MUST roll back stock, reservations, promo usedCount & cart cleanly!
    const ordersBefore = dbState.orders.length;
    const resBefore = (dbState.reservations || []).length;
    const promoBefore = dbState.promotions.find(p => p.code === 'SIGMA50').usedCount;
    const invBefore = dbState.branchInventory.find(b => b.vehicleId === 'toyota-camry' && b.branchId === 'hn-caugiay').reservedQty;

    await assert.rejects(
      () => CheckoutService.checkout({
        user: { userId: buyerUser.id, fullName: buyerUser.fullName, phone: buyerUser.phone, role: 'buyer' },
        idempotencyKey: 'idem-fail-hook',
        payload: { source: 'cart', branchId: 'hn-caugiay', deliveryMethod: 'showroom', acceptedPolicy: true, buyerName: 'Buyer 1', buyerPhone: '0901234567' },
        __testHooks: { failAfterReserve: true }
      }),
      /Simulated crash after stock reservation/
    );

    assert.strictEqual(dbState.orders.length, ordersBefore, 'Orders count must roll back on checkout crash');
    assert.strictEqual((dbState.reservations || []).length, resBefore, 'Reservations must roll back on checkout crash');
    assert.strictEqual(dbState.promotions.find(p => p.code === 'SIGMA50').usedCount, promoBefore, 'Promo count must roll back on checkout crash');
    assert.strictEqual(dbState.branchInventory.find(b => b.vehicleId === 'toyota-camry' && b.branchId === 'hn-caugiay').reservedQty, invBefore, 'Reserved qty must roll back');

    // Happy-path checkout with Idempotency-Key + exact retry + mismatch
    const idemKey = 'idem-cart-happy-01';
    const happyBody = {
      source: 'cart',
      branchId: 'hn-caugiay',
      deliveryMethod: 'showroom',
      paymentMode: 'deposit',
      buyerName: 'Buyer One',
      buyerPhone: '0901234567',
      acceptedPolicy: true
    };
    const chk1Res = await fetch(`${BASE_URL}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}`, 'Idempotency-Key': idemKey },
      body: JSON.stringify(happyBody)
    });
    const chk1 = await chk1Res.json();
    assert.strictEqual(chk1Res.status, 201);
    assert.strictEqual(chk1.data.idempotentReplay, false);
    assert.strictEqual(chk1.data.order.orderStatus, 'Pending');
    assert.strictEqual(chk1.data.order.paymentStatus, 'Unpaid');

    // Replay same key & payload -> returns same order cleanly
    const chk2Res = await fetch(`${BASE_URL}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}`, 'Idempotency-Key': idemKey },
      body: JSON.stringify(happyBody)
    });
    const chk2 = await chk2Res.json();
    assert.strictEqual(chk2Res.status, 200);
    assert.strictEqual(chk2.data.idempotentReplay, true);
    assert.strictEqual(chk2.data.order.id, chk1.data.order.id);

    // Same key with tampered payload -> 409 IDEMPOTENCY_PAYLOAD_MISMATCH
    const chkMismatch = await fetch(`${BASE_URL}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}`, 'Idempotency-Key': idemKey },
      body: JSON.stringify({ ...happyBody, paymentMode: 'full' })
    });
    assert.strictEqual(chkMismatch.status, 409);
  });

  it('SIG-P1-008 & SIG-P1-009: Payment Intents, HMAC webhook security, replay dedupe, partial mismatch, late expiry exception & reconciliation worker', async () => {
    // 1. Direct checkout on vinfast-vf9
    const ordRes = await fetch(`${BASE_URL}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}`, 'Idempotency-Key': 'idem-pay-vf9' },
      body: JSON.stringify({
        source: 'direct',
        items: [{ itemType: 'vehicle', itemId: 'vinfast-vf9', quantity: 1 }],
        branchId: 'hn-caugiay',
        buyerName: 'Buyer One',
        buyerPhone: '0901234567',
        acceptedPolicy: true
      })
    });
    const order = (await ordRes.json()).data.order;

    // 2. Initiate Payment Intent
    const piRes = await fetch(`${BASE_URL}/payments/intents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}` },
      body: JSON.stringify({ orderId: order.id, mode: 'deposit', provider: 'napas_qr_sandbox' })
    });
    const intent = (await piRes.json()).data;
    assert.strictEqual(piRes.status, 201);
    assert.strictEqual(intent.status, 'pending');

    // 3. Invalid HMAC signature MUST fail with 401
    const whPayload = JSON.stringify({
      eventId: 'evt_test_hmac_01',
      intentId: intent.id,
      status: 'succeeded',
      amount: intent.amount,
      currency: 'VND'
    });
    const badSigRes = await fetch(`${BASE_URL}/payments/webhooks/napas_qr_sandbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-signature': 'sha256=' + '0'.repeat(64) },
      body: whPayload
    });
    assert.strictEqual(badSigRes.status, 401);

    // 4. Valid HMAC signature settles deposit & creates balanced ledger without flipping Delivered
    const goodSig = PaymentGateway.signWebhookPayload(whPayload, PaymentGateway.getWebhookSecret('napas_qr_sandbox'));
    const okSigRes = await fetch(`${BASE_URL}/payments/webhooks/napas_qr_sandbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-signature': `sha256=${goodSig}` },
      body: whPayload
    });
    const okSigData = await okSigRes.json();
    assert.strictEqual(okSigRes.status, 200);
    assert.strictEqual(okSigData.data.order.paymentStatus, 'Deposit_Paid');
    assert.strictEqual(okSigData.data.order.orderStatus, 'Pending', 'Webhook MUST NEVER auto-flip orderStatus to Delivered');
    assert.strictEqual(okSigData.data.order.paidAmount, intent.amount);

    // 5. Replay exact eventId -> duplicate: true, paidAmount unchanged
    const replayRes = await fetch(`${BASE_URL}/payments/webhooks/napas_qr_sandbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-signature': `sha256=${goodSig}` },
      body: whPayload
    });
    const replayData = await replayRes.json();
    assert.strictEqual(replayRes.status, 200);
    assert.strictEqual(replayData.data.duplicate, true);
    const histAfterReplay = (await (await fetch(`${BASE_URL}/payments/intents/${order.id}`, {
      headers: { 'Authorization': `Bearer ${buyerToken}` }
    })).json()).data;
    assert.strictEqual(histAfterReplay.paidAmount, intent.amount);

    // 6. Partial payment mismatch for balance intent
    const balPiRes = await fetch(`${BASE_URL}/payments/intents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}` },
      body: JSON.stringify({ orderId: order.id, mode: 'balance', provider: 'vnpay_sandbox' })
    });
    const balIntent = (await balPiRes.json()).data;
    const partialRes = await fetch(`${BASE_URL}/payments/sandbox/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyerToken}` },
      body: JSON.stringify({ intentId: balIntent.id, status: 'succeeded', amount: 1000000 })
    });
    const partialData = await partialRes.json();
    assert.strictEqual(partialRes.status, 200);
    assert.strictEqual(partialData.data.isPartialMismatch, true);
    assert.strictEqual(partialData.data.order.exceptionStatus, 'partial_settlement_mismatch');

    // 7. Late payment after reservation expired when stock === 0 records exception cleanly without negative stock
    const lateOrdRes = await fetch(`${BASE_URL}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyer2Token}`, 'Idempotency-Key': 'idem-late-stock0' },
      body: JSON.stringify({
        source: 'direct',
        items: [{ itemType: 'vehicle', itemId: 'vinfast-vf3', quantity: 1 }],
        branchId: 'dn-haichau',
        buyerName: 'Buyer Two',
        buyerPhone: '0911222333',
        acceptedPolicy: true
      })
    });
    const lateOrd = (await lateOrdRes.json()).data.order;
    const latePi = (await (await fetch(`${BASE_URL}/payments/intents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyer2Token}` },
      body: JSON.stringify({ orderId: lateOrd.id, mode: 'deposit', provider: 'momo_sandbox' })
    })).json()).data;

    // Simulate expiry + branch depletion to 0 before late callback arrives
    const rRec = dbState.reservations.find(r => r.orderId === lateOrd.id);
    rRec.expiresAt = new Date(Date.now() - 60000).toISOString();
    await PaymentReconciliationWorker.runReconciliationCycle({ nowMs: Date.now() });
    const dnBranch = dbState.branchInventory.find(b => b.vehicleId === 'vinfast-vf3' && b.branchId === 'dn-haichau');
    dnBranch.stockOnHand = 0;
    dnBranch.reservedQty = 0;

    const lateSimRes = await fetch(`${BASE_URL}/payments/sandbox/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${buyer2Token}` },
      body: JSON.stringify({ intentId: latePi.id, status: 'succeeded' })
    });
    const lateSimData = await lateSimRes.json();
    assert.strictEqual(lateSimRes.status, 200);
    assert.strictEqual(lateSimData.data.lateOutOfStock, true);
    assert.strictEqual(lateSimData.data.order.exceptionStatus, 'late_payment_out_of_stock');
    assert(dnBranch.stockOnHand >= 0 && dnBranch.reservedQty >= 0, 'Inventory MUST NEVER go negative');

    // 8. Worker reconciliation cycle verifies zero unexpected ledger mismatch for valid settled orders
    const reconRes = await PaymentReconciliationWorker.runReconciliationCycle({ nowMs: Date.now() });
    assert.strictEqual(reconRes.mismatches.length, 0);
  });

  it('SIG-P1-010: Seller creates vehicle, creates maxUses=1 promo & 10 concurrent checkouts cannot over-redeem promo', async () => {
    const newCarRes = await fetch(`${BASE_URL}/vehicles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sellerToken}` },
      body: JSON.stringify({
        name: 'SIGMA Seller Created GT',
        brand: 'SIGMACAR',
        category: 'Sedan',
        fuel: 'ev',
        price: 1600000000,
        range: 620,
        hp: 480,
        stock: 15
      })
    });
    assert.strictEqual(newCarRes.status, 201);
    const createdCar = (await newCarRes.json()).data;

    // Verify Seller created vehicle appears in catalog & branch inventory
    const invCheck = await (await fetch(`${BASE_URL}/inventory/${createdCar.id}`)).json();
    assert(invCheck.data.totalAvailable > 0);

    // Create promotion capped strictly at maxUses: 1
    const promoRes = await fetch(`${BASE_URL}/promotions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sellerToken}` },
      body: JSON.stringify({
        code: 'RACEONE2026',
        name: 'Suất ưu đãi duy nhất 1 xe',
        discountType: 'fixed',
        discountValue: 40000000,
        maxUses: 1,
        perUserLimit: 5
      })
    });
    assert.strictEqual(promoRes.status, 201);

    // Fire 10 concurrent checkouts trying to claim RACEONE2026
    const promoRacers = Array.from({ length: 10 }, (_, idx) =>
      CheckoutService.checkout({
        user: { userId: `promo-racer-${idx}`, fullName: `Racer ${idx}`, phone: '0900000001', role: 'buyer' },
        idempotencyKey: `idem-promo-race-${idx}`,
        payload: {
          source: 'direct',
          items: [{ itemType: 'vehicle', itemId: createdCar.id, quantity: 1 }],
          branchId: 'hn-caugiay',
          promoCode: 'RACEONE2026',
          buyerName: `Racer ${idx}`,
          buyerPhone: '0900000001',
          acceptedPolicy: true
        }
      }).then(res => ({ ok: true, res })).catch(err => ({ ok: false, message: err.message }))
    );

    const promoResults = await Promise.all(promoRacers);
    const promoWinners = promoResults.filter(r => r.ok);
    assert.strictEqual(promoWinners.length, 1, `Strictly 1 checkout may redeem maxUses=1 promo, got ${promoWinners.length}`);
    const storedPromo = dbState.promotions.find(p => p.code === 'RACEONE2026');
    assert.strictEqual(storedPromo.usedCount, 1);
  });
});
