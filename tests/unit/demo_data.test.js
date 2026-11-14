// tests/unit/demo_data.test.js
// PLAN.md §I.4 isolation invariants for the synthetic demo dataset (T5.1) and the removal SQL (T5.5).

require('../helpers/isolated-store');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { generate, COUNTS } = require('../../scripts/demo/generate-demo-data');
const { buildSql, buildCountSql } = require('../../scripts/demo/remove-demo-data');
const { D1SqliteShim } = require('../helpers/d1-sqlite-shim');
const { startTestServer } = require('../helpers/test-app');

const ROOT = path.resolve(__dirname, '..', '..');
const SEED_STORE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sigmacar_store.json'), 'utf8'));
const NOW = '2026-11-15T00:00:00.000Z';

describe('T5.1 demo dataset invariants', () => {
  const data = generate({ seed: 7, batchId: 'demo-test', now: NOW, vehicles: SEED_STORE.vehicles });
  const collections = Object.entries(data).filter(([, v]) => Array.isArray(v));

  it('has the planned volume', () => {
    for (const [name, count] of Object.entries(COUNTS)) assert.equal(data[name].length, count, name);
  });

  it('every record is flagged, batch-tagged and uses a demo- id', () => {
    for (const [name, list] of collections) {
      for (const r of list) {
        assert.equal(r.isDemo, true, `${name} ${r.id}`);
        assert.equal(r.demoBatchId, 'demo-test');
        assert.match(String(r.id), /^demo-|^DEMO-/i, `${name} id ${r.id}`);
      }
    }
  });

  it('demo users cannot log in, cannot be e-mailed and are not real people', () => {
    const realEmails = new Set(SEED_STORE.users.map(u => u.email));
    const realNames = new Set(SEED_STORE.users.map(u => u.fullName));
    for (const u of data.users) {
      assert.ok(u.disabledAt, 'disabled');
      assert.match(u.email, /@demo\.sigmacar\.invalid$/);
      assert.equal(u.marketingConsent, false);
      assert.match(u.passwordHash, /^[0-9a-f]{16}:[0-9a-f]{128}$/);
      assert.equal(u.role, 'buyer');
      assert.ok(!realEmails.has(u.email) && !realNames.has(u.fullName));
    }
    assert.ok(data.users.some(u => u.fullName === 'Nguyễn Văn Tốc Độ'));
    assert.equal(new Set(data.users.map(u => u.fullName)).size, data.users.length, 'names are unique');
  });

  it('generates no outbound or payment artefacts', () => {
    for (const forbidden of ['outboxEvents', 'emailCampaigns', 'campaignDeliveries', 'paymentIntents', 'paymentLedger', 'webhookEvents', 'refunds']) {
      assert.equal(data[forbidden], undefined, forbidden);
    }
    assert.ok(data.notifications.every(n => n.deliveryStatus === 'demo_not_sent'));
  });

  it('verified purchase ⇔ a delivered/completed demo order of the same user and vehicle', () => {
    const owned = new Set(data.orders.filter(o => ['Delivered', 'Completed'].includes(o.orderStatus)).map(o => `${o.userId}|${o.vehicleId}`));
    let verified = 0;
    for (const r of data.reviews) {
      assert.equal(r.verifiedPurchase, owned.has(`${r.userId}|${r.vehicleId}`), r.id);
      if (r.verifiedPurchase) {
        verified++;
        const o = data.orders.find(x => x.id === r.orderId);
        assert.ok(o && o.userId === r.userId && o.vehicleId === r.vehicleId);
      }
    }
    assert.ok(verified >= 80 && verified < data.reviews.length);
  });

  it('only real catalog vehicles are referenced', () => {
    const ids = new Set(SEED_STORE.vehicles.map(v => v.id));
    for (const name of ['orders', 'reviews', 'questions', 'appointments']) {
      assert.ok(data[name].every(r => ids.has(r.vehicleId)), name);
    }
  });

  it('is deterministic for a seed and clock', () => {
    const again = generate({ seed: 7, batchId: 'demo-test', now: NOW, vehicles: SEED_STORE.vehicles });
    assert.equal(JSON.stringify(again), JSON.stringify(data));
    const other = generate({ seed: 8, batchId: 'demo-test', now: NOW, vehicles: SEED_STORE.vehicles });
    assert.notEqual(JSON.stringify(other.users), JSON.stringify(data.users));
  });
});

describe('T5.1 demo users really cannot log in', () => {
  let app = null;
  before(async () => { app = await startTestServer({ mode: 'memory', reseed: true }); });
  after(async () => { if (app) await app.close(); });

  it('login with any password is refused', async () => {
    const data = generate({ seed: 9, batchId: 'demo-login', now: NOW, vehicles: SEED_STORE.vehicles });
    const StorageEngine = require('../../backend/infrastructure/storage-engine');
    const u = data.users[0];
    await StorageEngine.runInTransaction(async (state) => { state.users.push(u); });
    for (const password of ['', 'Buyer@123456', 'demo', u.passwordHash]) {
      const res = await fetch(`${app.baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password }) });
      assert.notEqual(res.status, 200, `password "${password.slice(0, 12)}"`);
    }
  });
});

describe('T5.5 removal SQL on a real SQLite D1 schema', () => {
  it('removes only the batch, records deletions and bumps the revision by one', async () => {
    const shim = new D1SqliteShim();
    const db = shim.db;
    db.prepare("UPDATE state_revision SET rev = rev + 1 WHERE id = 1").run(); // guard allows +1 only
    const put = db.prepare('INSERT INTO state_documents (collection, doc_key, pos, doc, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?)');
    put.run('orders', 'demo-ord-0001', 1, JSON.stringify({ id: 'demo-ord-0001', isDemo: true, demoBatchId: 'demo-2026' }), NOW, 1);
    put.run('reviews', 'demo-rev-0001', 1, JSON.stringify({ id: 'demo-rev-0001', isDemo: true, demoBatchId: 'demo-2026' }), NOW, 1);
    put.run('reviews', 'demo-rev-9999', 2, JSON.stringify({ id: 'demo-rev-9999', isDemo: true, demoBatchId: 'other-batch' }), NOW, 1);
    put.run('orders', 'ORD-9020', 2, JSON.stringify({ id: 'ORD-9020', demoBatchId: 'demo-2026' }), NOW, 1); // real record, no isDemo flag

    const before = db.prepare(buildCountSql('demo-2026')).all();
    assert.deepEqual(before.map(r => [r.collection, r.rows]), [['orders', 1], ['reviews', 1]]);

    db.exec(buildSql('demo-2026', NOW));
    const left = db.prepare('SELECT doc_key FROM state_documents ORDER BY doc_key').all().map(r => r.doc_key);
    assert.deepEqual(left, ['ORD-9020', 'demo-rev-9999']);
    assert.equal(db.prepare('SELECT rev FROM state_revision WHERE id = 1').get().rev, 2);
    const dels = db.prepare('SELECT collection, doc_key, rev FROM state_deletions ORDER BY doc_key').all();
    assert.deepEqual(dels.map(d => [d.collection, d.doc_key, d.rev]), [['orders', 'demo-ord-0001', 2], ['reviews', 'demo-rev-0001', 2]]);
  });

  it('rejects unsafe batch ids', () => {
    for (const bad of ["x'; DROP TABLE state_documents; --", 'AB', '', 'demo_2026']) {
      assert.throws(() => buildSql(bad));
    }
  });
});
