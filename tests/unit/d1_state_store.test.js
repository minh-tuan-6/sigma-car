// tests/unit/d1_state_store.test.js
// D1 persistence for the storage engine: schema, codec, D1StateStore, engine driver mode, D1BlobStore.
// Runs against tests/helpers/d1-sqlite-shim.js (SQLite with D1 batch semantics); real D1: tests/workers/*.

process.env.SIGMACAR_LAZY_INIT = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'sigmacar-isolated-test-suite-secret-key-2026-min-32-chars';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { D1SqliteShim } = require('../helpers/d1-sqlite-shim');
const codec = require('../../backend/infrastructure/persistence/state-codec');
const { D1StateStore } = require('../../backend/infrastructure/persistence/d1-state-store');
const { D1BlobStore, CHUNK_BYTES } = require('../../backend/infrastructure/persistence/d1-blob-store');
const StorageEngine = require('../../backend/infrastructure/storage-engine');

const quietLogger = { error() {}, warn() {}, log() {} };

// Realistic state: the dev seed plus the boot normalisation Node applies when it loads the file.
function seedState() {
  StorageEngine.configureStorage({ driver: null, mode: 'memory', allowDevSeed: true });
  StorageEngine.seedInitialData();
  StorageEngine.ensureExtendedCollections();
  return JSON.parse(JSON.stringify(StorageEngine.dbState));
}

function plain(state) {
  return JSON.parse(JSON.stringify(state));
}

function rowCount(shim, collection) {
  return shim.db.prepare('SELECT COUNT(*) AS n FROM state_documents WHERE collection = ?').get(collection).n;
}

let SEED;
before(() => {
  SEED = seedState();
});

describe('D1 schema (backend/infrastructure/d1/migrations)', () => {
  it('creates the state tables, the revision row and the conflict trigger', () => {
    const shim = new D1SqliteShim();
    const tables = shim.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
    for (const t of ['data_migrations', 'media_blobs', 'state_collection_revision', 'state_documents', 'state_meta', 'state_revision']) {
      assert.ok(tables.includes(t), `missing table ${t}`);
    }
    assert.strictEqual(shim.db.prepare('SELECT rev FROM state_revision WHERE id = 1').get().rev, 0);
    assert.throws(() => shim.db.prepare('UPDATE state_revision SET rev = 5 WHERE id = 1').run(), /SIGMA_REVISION_CONFLICT/);
    shim.db.prepare('UPDATE state_revision SET rev = 1 WHERE id = 1').run();
    assert.strictEqual(shim.db.prepare('SELECT rev FROM state_revision').get().rev, 1);
  });

  it('is idempotent (the migration can be applied twice)', () => {
    const shim = new D1SqliteShim();
    assert.doesNotThrow(() => shim.applyMigrations());
  });

  it('rejects invalid JSON documents and enforces the unique backstops', () => {
    const shim = new D1SqliteShim();
    const ins = shim.db.prepare('INSERT INTO state_documents (collection, doc_key, pos, doc, updated_at) VALUES (?, ?, ?, ?, ?)');
    // rejected either by the CHECK or, first, by the json_extract() of the generated column / partial indexes
    assert.throws(() => ins.run('users', 'u1', 0, '{not json', 'now'), /CHECK constraint failed|malformed JSON/);
    ins.run('users', 'u1', 0, JSON.stringify({ id: 'u1', email: 'A@x.vn' }), 'now');
    assert.throws(() => ins.run('users', 'u2', 1, JSON.stringify({ id: 'u2', email: 'a@x.vn' }), 'now'), /UNIQUE constraint failed/);
    // the same e-mail in another collection is not a user
    assert.doesNotThrow(() => ins.run('orders', 'o1', 0, JSON.stringify({ id: 'o1', email: 'a@x.vn' }), 'now'));
  });
});

describe('state codec', () => {
  it('round-trips the whole seed state exactly (values, nesting, order, meta)', () => {
    const snap = codec.encodeState(SEED);
    const rows = [];
    for (const [collection, c] of snap.collections) {
      c.keys.forEach(k => rows.push({ collection, doc_key: k, pos: c.pos.get(k), doc: c.json.get(k) }));
    }
    rows.reverse(); // row order from the database is irrelevant
    const decoded = codec.decodeRows(rows);
    const rebuilt = { ...decoded.collections };
    for (const [k, v] of snap.meta) rebuilt[k] = JSON.parse(v);
    const expected = plain(SEED);
    for (const k of Object.keys(expected)) if (Array.isArray(expected[k]) && expected[k].length === 0) delete expected[k];
    assert.deepStrictEqual(rebuilt, expected);
  });

  it('writes one row for an unshift, one for a push and one delete for a splice', () => {
    const state = plain(SEED);
    const prev = codec.encodeState(state);
    state.auditLogs.unshift({ id: 'log_new_first', action: 'x' });
    state.vehicles.push({ id: 'veh_new_last', name: 'n' });
    state.orders.splice(1, 1);
    const d = codec.diffState(prev, state);
    assert.deepStrictEqual(d.upserts.map(u => u.key).sort(), ['log_new_first', 'veh_new_last']);
    assert.strictEqual(d.deletes.length, 1);
    const firstPos = d.upserts.find(u => u.key === 'log_new_first').pos;
    assert.ok(firstPos < prev.collections.get('auditLogs').pos.get(state.auditLogs[1].id));
  });

  it('renumbers a collection when existing rows are reordered, and keeps the new order', () => {
    const state = { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
    const prev = codec.encodeState(state);
    state.items.reverse();
    const d = codec.diffState(prev, state);
    // renumbered 0..2: 'b' keeps position 1 and its content, so only 'a' and 'c' are rewritten
    assert.deepStrictEqual(d.upserts.map(u => u.key).sort(), ['a', 'c']);
    const order = [...d.next.collections.get('items').keys].sort((x, y) => d.next.collections.get('items').pos.get(x) - d.next.collections.get('items').pos.get(y));
    assert.deepStrictEqual(order, ['c', 'b', 'a']);
  });

  it('handles duplicate ids, missing ids and records that are not objects without losing any', () => {
    const state = { weird: [{ id: 'x', v: 1 }, { id: 'x', v: 2 }, { v: 3 }, 'plain-string', null] };
    const snap = codec.encodeState(state);
    const rows = [];
    for (const [collection, c] of snap.collections) c.keys.forEach(k => rows.push({ collection, doc_key: k, pos: c.pos.get(k), doc: c.json.get(k) }));
    assert.deepStrictEqual(codec.decodeRows(rows).collections.weird, state.weird);
  });

  it('refuses a record larger than a D1 row', () => {
    assert.throws(() => codec.encodeState({ big: [{ id: 'b', blob: 'x'.repeat(codec.MAX_DOC_BYTES) }] }), (e) => e.code === 'RECORD_TOO_LARGE');
  });
});

describe('D1StateStore', () => {
  let shim;
  beforeEach(() => {
    shim = new D1SqliteShim();
  });

  it('refuses to start without a D1 binding', () => {
    assert.throws(() => new D1StateStore(undefined), (e) => e.code === 'STORAGE_NOT_CONFIGURED' && e.statusCode === 503);
  });

  it('commits a full state and another isolate loads it back identically', async () => {
    const a = new D1StateStore(shim, { logger: quietLogger });
    const first = await a.load();
    assert.strictEqual(first.empty, true);
    const res = await a.commit(SEED);
    assert.strictEqual(res.committed, true);
    assert.strictEqual(res.rev, 1);

    const b = new D1StateStore(shim, { logger: quietLogger });
    const patch = await b.load();
    assert.strictEqual(patch.fullLoad, true);
    const rebuilt = { ...patch.collections, ...patch.meta };
    const expected = plain(SEED);
    for (const k of Object.keys(expected)) if (Array.isArray(expected[k]) && expected[k].length === 0) delete expected[k];
    assert.deepStrictEqual(rebuilt, expected);
    assert.strictEqual(await b.load(), null, 'nothing changed → no reload');
  });

  it('writes only changed rows, and other isolates reload only the changed collections', async () => {
    const a = new D1StateStore(shim, { logger: quietLogger });
    await a.load();
    await a.commit(SEED);
    const b = new D1StateStore(shim, { logger: quietLogger });
    await b.load();

    const state = plain(SEED);
    state.orders[0].orderStatus = 'cancelled';
    const before = shim.statementCount;
    const res = await a.commit(state);
    assert.strictEqual(res.upserts, 1);
    // revision guard + the one changed row (meta unchanged)
    assert.strictEqual(shim.statementCount - before, 2);

    const readBefore = b.stats.rowsRead;
    const untouched = (await b.load({ force: true })).collections.orders[1];
    await a.commit({ ...state, orders: state.orders.map((o, i) => (i === 0 ? { ...o, orderStatus: 'Confirmed' } : o)) });
    const patch = await b.load({ current: { orders: [plain(state.orders[0]), untouched, ...plain(SEED.orders.slice(2))] } });
    assert.strictEqual(patch.fullLoad, false);
    assert.deepStrictEqual(Object.keys(patch.collections), ['orders']);
    assert.strictEqual(patch.collections.orders[0].orderStatus, 'Confirmed');
    assert.strictEqual(patch.collections.orders[1], untouched, 'unchanged records keep their in-memory objects');
    assert.ok(b.stats.rowsRead - readBefore < 300, 'sanity');
  });

  it('reads only the changed rows from D1 on reload (Workers/D1 Free: rows read ∝ changes)', async () => {
    const a = new D1StateStore(shim, { logger: quietLogger });
    await a.load();
    const big = plain(SEED);
    big.analyticsEvents = Array.from({ length: 2000 }, (_, i) => ({ id: `evt_${i}`, eventType: 'vehicle_view' }));
    await a.commit(big);
    const b = new D1StateStore(shim, { logger: quietLogger });
    await b.load();
    const fullRead = b.stats.rowsRead;
    assert.ok(fullRead > 2000, 'first load in an isolate reads everything once');

    big.analyticsEvents.unshift({ id: 'evt_new', eventType: 'vehicle_view' });
    big.faqs.splice(0, 1);
    await a.commit(big);
    const patch = await b.load({ current: { analyticsEvents: big.analyticsEvents.slice(1), faqs: plain(SEED.faqs) } });
    // revision probe (1) + batch: revision (1) + 1 changed row + 1 deletion + meta rows
    assert.ok(b.stats.rowsRead - fullRead <= 6, `rows read on reload: ${b.stats.rowsRead - fullRead}`);
    assert.strictEqual(patch.collections.analyticsEvents.length, 2001);
    assert.strictEqual(patch.collections.analyticsEvents[0].id, 'evt_new');
    assert.deepStrictEqual(patch.collections.faqs.map(f => f.id), SEED.faqs.slice(1).map(f => f.id));
    assert.strictEqual(await b.load(), null, 'in sync');
  });

  it('a deleted-then-recreated record (and the reverse) resolves to the latest event', async () => {
    const a = new D1StateStore(shim, { logger: quietLogger });
    await a.load();
    await a.commit({ items: [{ id: 'x', v: 1 }, { id: 'y', v: 1 }] });
    const b = new D1StateStore(shim, { logger: quietLogger });
    await b.load();
    await a.commit({ items: [{ id: 'y', v: 1 }] });            // delete x
    await a.commit({ items: [{ id: 'x', v: 2 }, { id: 'y', v: 1 }] }); // re-create x
    await a.commit({ items: [{ id: 'x', v: 2 }] });            // delete y
    const patch = await b.load({ current: { items: [{ id: 'x', v: 1 }, { id: 'y', v: 1 }] } });
    assert.deepStrictEqual(patch.collections.items, [{ id: 'x', v: 2 }]);
  });

  it('detects a concurrent commit (optimistic lock) and writes nothing from the loser', async () => {
    const a = new D1StateStore(shim, { logger: quietLogger });
    await a.load();
    await a.commit(SEED);
    const b = new D1StateStore(shim, { logger: quietLogger });
    await b.load();

    const sa = plain(SEED);
    sa.promotions[0].usedCount = 7;
    await a.commit(sa);

    const sb = plain(SEED);
    sb.promotions[0].usedCount = 1;
    sb.faqs.push({ id: 'faq_from_b', q: 'b' });
    await assert.rejects(b.commit(sb), (e) => e.code === 'STORAGE_CONFLICT' && e.statusCode === 409);
    const promo = JSON.parse(shim.db.prepare("SELECT doc FROM state_documents WHERE collection='promotions' AND doc_key=?").get(SEED.promotions[0].id).doc);
    assert.strictEqual(promo.usedCount, 7);
    assert.strictEqual(shim.db.prepare("SELECT COUNT(*) n FROM state_documents WHERE doc_key='faq_from_b'").get().n, 0);
  });

  it('maps database failures to 503 without leaking driver details', async () => {
    const a = new D1StateStore(shim, { logger: quietLogger });
    await a.load();
    shim.failNext(1, 'internal error; reference = abc123 SELECT secret');
    await assert.rejects(a.commit(SEED), (e) => e.code === 'STORAGE_UNAVAILABLE' && e.statusCode === 503 && !/SELECT|abc123/.test(e.message));
    // nothing was half-written
    assert.strictEqual(shim.db.prepare('SELECT COUNT(*) n FROM state_documents').get().n, 0);
  });

  it('reports a missing schema clearly', async () => {
    const bare = new D1SqliteShim({ migrate: false });
    const a = new D1StateStore(bare, { logger: quietLogger });
    await assert.rejects(a.load(), (e) => e.code === 'STORAGE_NOT_MIGRATED');
  });

  it('turns a unique-index violation into 409 DUPLICATE_RECORD', async () => {
    const a = new D1StateStore(shim, { logger: quietLogger });
    await a.load();
    const state = { users: [{ id: 'u1', email: 'dup@x.vn' }, { id: 'u2', email: 'DUP@x.vn' }] };
    await assert.rejects(a.commit(state), (e) => e.code === 'DUPLICATE_RECORD' && e.statusCode === 409);
  });

  it('persists records without ids or with repeated ids (positional keys pass the schema checks)', async () => {
    // Regression: keys once started with "\u0000"; SQLite length() stops at NUL, so the CHECK on doc_key failed.
    const a = new D1StateStore(shim, { logger: quietLogger });
    await a.load();
    const state = { jobEvents: [{ type: 'no-id' }, { id: 'e1' }, { id: 'e1', again: true }, 'text'] };
    await a.commit(state);
    state.jobEvents.unshift({ type: 'newest, also no id' });
    await a.commit(state);
    const b = new D1StateStore(shim, { logger: quietLogger });
    assert.deepStrictEqual((await b.load()).collections.jobEvents, state.jobEvents);
  });

  it('stores hostile ids and values verbatim (bound parameters only)', async () => {
    const a = new D1StateStore(shim, { logger: quietLogger });
    await a.load();
    const evil = "x'); DROP TABLE state_documents; --";
    const state = { reviews: [{ id: evil, body: "' OR 1=1 --", nested: { q: '"; DELETE FROM state_meta; --' } }] };
    await a.commit(state);
    const b = new D1StateStore(shim, { logger: quietLogger });
    const patch = await b.load();
    assert.deepStrictEqual(patch.collections.reviews, state.reviews);
    assert.strictEqual(rowCount(shim, 'reviews'), 1);
  });
});

describe('storage engine with the D1 driver', () => {
  let shim;
  beforeEach(async () => {
    shim = new D1SqliteShim();
    // the database starts with the seed, as after an import
    const loader = new D1StateStore(shim, { logger: quietLogger });
    await loader.load();
    await loader.commit(SEED);
    StorageEngine.configureStorage({ driver: new D1StateStore(shim, { logger: quietLogger }), allowDevSeed: false });
    await StorageEngine.syncFromDriver();
  });

  it('loads the database into the same in-memory state the services use', () => {
    assert.strictEqual(StorageEngine.getStorageConfig().mode, 'd1');
    assert.strictEqual(StorageEngine.dbState.vehicles.length, SEED.vehicles.length);
    assert.deepStrictEqual(plain(StorageEngine.dbState.users), SEED.users);
  });

  it('persists a transaction atomically and other isolates see it', async () => {
    await StorageEngine.runInTransaction(async (state) => {
      state.orders[0].note = 'persisted';
      state.notifications.unshift({ id: 'ntf_1', userId: state.users[0].id });
    });
    const other = new D1StateStore(shim, { logger: quietLogger });
    const patch = await other.load();
    assert.strictEqual(patch.collections.orders[0].note, 'persisted');
    assert.strictEqual(patch.collections.notifications[0].id, 'ntf_1');
  });

  it('rolls back memory and writes nothing when the action throws', async () => {
    const before = shim.db.prepare('SELECT rev FROM state_revision').get().rev;
    await assert.rejects(StorageEngine.runInTransaction(async (state) => {
      state.orders[0].note = 'must not persist';
      throw Object.assign(new Error('business rule'), { statusCode: 422, code: 'RULE' });
    }), (e) => e.code === 'RULE');
    assert.strictEqual(StorageEngine.dbState.orders[0].note, undefined);
    assert.strictEqual(shim.db.prepare('SELECT rev FROM state_revision').get().rev, before);
  });

  it('re-runs the transaction on fresh data when another isolate commits first (no lost update)', async () => {
    const promoId = SEED.promotions[0].id;
    const start = SEED.promotions[0].usedCount;
    // Another isolate increments the same counter just before our commit.
    shim.beforeBatch(async () => {
      const other = new D1StateStore(shim, { logger: quietLogger });
      const p = await other.load();
      const st = { ...p.collections, ...p.meta };
      st.promotions.find(x => x.id === promoId).usedCount += 1;
      await other.commit(st);
    });
    let runs = 0;
    await StorageEngine.runInTransaction(async (state) => {
      runs++;
      state.promotions.find(x => x.id === promoId).usedCount += 1;
    });
    assert.strictEqual(runs, 2, 'the losing attempt is re-run');
    const doc = JSON.parse(shim.db.prepare("SELECT doc FROM state_documents WHERE collection='promotions' AND doc_key=?").get(promoId).doc);
    assert.strictEqual(doc.usedCount, start + 2);
    assert.strictEqual(StorageEngine.dbState.promotions.find(x => x.id === promoId).usedCount, start + 2);
  });

  it('serialises many concurrent transactions in one isolate', async () => {
    const promoId = SEED.promotions[1].id;
    const start = SEED.promotions[1].usedCount;
    await Promise.all(Array.from({ length: 25 }, () => StorageEngine.runInTransaction(async (state) => {
      state.promotions.find(x => x.id === promoId).usedCount += 1;
    })));
    const doc = JSON.parse(shim.db.prepare("SELECT doc FROM state_documents WHERE collection='promotions' AND doc_key=?").get(promoId).doc);
    assert.strictEqual(doc.usedCount, start + 25);
  });

  it('returns 503 STORAGE_UNAVAILABLE and restores memory when D1 fails during commit', async () => {
    const original = plain(StorageEngine.dbState.orders[0]);
    // first call (revision probe) succeeds, the commit batch fails
    let calls = 0;
    shim.beforeBatch(async () => {
      calls++;
      shim.failNext(1, 'D1 storage operation exceeded timeout');
    });
    await assert.rejects(StorageEngine.runInTransaction(async (state) => {
      state.orders[0].orderStatus = 'cancelled';
    }), (e) => e.code === 'STORAGE_UNAVAILABLE' && e.statusCode === 503);
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(plain(StorageEngine.dbState.orders[0]), original);
  });

  it('flushes changes made outside a transaction, as Node does at the next save', async () => {
    StorageEngine.dbState.faqs.push({ id: 'faq_outside_tx', q: 'x' });
    const res = await StorageEngine.flushToDriver();
    assert.strictEqual(res.committed, true);
    assert.strictEqual(rowCount(shim, 'faqs'), SEED.faqs.length + 1);
    assert.strictEqual((await StorageEngine.flushToDriver()).committed, false, 'nothing left to write');
  });

  it('seeds an empty database in development and stays empty in production', async () => {
    const devShim = new D1SqliteShim();
    StorageEngine.configureStorage({ driver: new D1StateStore(devShim, { logger: quietLogger }), allowDevSeed: true });
    await StorageEngine.syncFromDriver();
    assert.ok(rowCount(devShim, 'users') >= 4);

    const prodShim = new D1SqliteShim();
    StorageEngine.configureStorage({ driver: new D1StateStore(prodShim, { logger: quietLogger }), allowDevSeed: false });
    await StorageEngine.syncFromDriver();
    assert.strictEqual(StorageEngine.dbState.users.length, 0);
    assert.strictEqual(prodShim.db.prepare('SELECT COUNT(*) n FROM state_documents').get().n, 0);
  });

  it('runtime-created collections persist without a schema change', async () => {
    await StorageEngine.runInTransaction(async (state) => {
      if (!Array.isArray(state.cmsContents)) state.cmsContents = [];
      state.cmsContents.unshift({ id: 'cms_1', title: 't' });
    });
    assert.strictEqual(rowCount(shim, 'cmsContents'), 1);
  });
});

describe('D1BlobStore', () => {
  it('stores a 5 MB file in 512 KiB chunks and reads it back byte-for-byte', async () => {
    const shim = new D1SqliteShim();
    const store = new D1BlobStore(shim, { logger: quietLogger });
    const data = crypto.randomBytes(5 * 1024 * 1024);
    const res = await store.write('med_1.png', data);
    assert.strictEqual(res.chunks, Math.ceil(data.length / CHUNK_BYTES));
    const back = await store.read('med_1.png');
    assert.ok(back.equals(data));
    const maxRow = shim.db.prepare('SELECT MAX(length(data_b64)) m FROM media_blobs').get().m;
    assert.ok(maxRow < 2000000, 'each row stays below the D1 row limit');
    await store.delete('med_1.png');
    assert.strictEqual(await store.read('med_1.png'), null);
  });

  it('overwrites an existing key atomically and returns null for unknown keys', async () => {
    const shim = new D1SqliteShim();
    const store = new D1BlobStore(shim, { logger: quietLogger });
    await store.write('k', Buffer.alloc(CHUNK_BYTES * 2 + 1, 1));
    await store.write('k', Buffer.from('small'));
    assert.strictEqual((await store.read('k')).toString(), 'small');
    assert.strictEqual(await store.read('missing'), null);
  });

  it('reports storage failures as 503', async () => {
    const shim = new D1SqliteShim();
    const store = new D1BlobStore(shim, { logger: quietLogger });
    shim.failNext(1);
    await assert.rejects(store.write('k', Buffer.from('x')), (e) => e.code === 'MEDIA_STORAGE_UNAVAILABLE' && e.statusCode === 503);
  });
});
