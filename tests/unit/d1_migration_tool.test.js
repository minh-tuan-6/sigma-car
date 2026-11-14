// tests/unit/d1_migration_tool.test.js
// scripts/d1/json-to-d1.js without Wrangler: the generated SQL is executed against the node:sqlite D1 shim.
// The same flow against real local D1 (Miniflare) is recorded in docs/D1_DATA_MIGRATION_REPORT.md.

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const tool = require('../../scripts/d1/json-to-d1');
const { D1SqliteShim } = require('../helpers/d1-sqlite-shim');
const { D1StateStore } = require('../../backend/infrastructure/persistence/d1-state-store');

const STORE = path.join(__dirname, '..', '..', 'data', 'sigmacar_store.json');
const quiet = { error() {}, log() {}, warn() {} };

function importInto(shim, state, mode = 'full') {
  const data = tool.rowsOf(state);
  const sql = tool.buildSql(data, { id: `test:${mode}`, sourceSha: 'abc', mode, summary: { rows: data.rows.length }, nowIso: '2026-11-14T00:00:00.000Z' });
  shim.db.exec(sql);
  return data;
}

function readBack(shim) {
  return {
    rows: shim.db.prepare('SELECT collection, doc_key, pos, doc FROM state_documents').all(),
    meta: shim.db.prepare('SELECT key, value FROM state_meta').all()
  };
}

describe('json-to-d1: source handling', () => {
  it('never writes to the source file and normalises deterministically', () => {
    const before = crypto.createHash('sha256').update(fs.readFileSync(STORE)).digest('hex');
    const mtime = fs.statSync(STORE).mtimeMs;
    const a = tool.loadNormalisedSource(STORE);
    const b = tool.loadNormalisedSource(STORE);
    assert.strictEqual(a.sha256, before);
    assert.deepStrictEqual(a.state, b.state, 'two runs produce identical rows (backfills stamped with the source save time)');
    assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(STORE)).digest('hex'), before);
    assert.strictEqual(fs.statSync(STORE).mtimeMs, mtime);
    assert.ok(a.state.branchInventory.length > 0, 'boot normalisation applied (branch inventory backfilled)');
  });

  it('refuses a corrupt source before doing anything', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'j2d1-'));
    const f = path.join(dir, 'store.json');
    fs.writeFileSync(f, '{"users": [');
    assert.throws(() => tool.loadNormalisedSource(f), /JSON/);
    assert.strictEqual(fs.readFileSync(f, 'utf8'), '{"users": [');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('json-to-d1: validation', () => {
  it('reports duplicate ids, missing required fields, duplicate e-mails and bad hashes as errors', () => {
    const v = tool.validate({
      users: [
        { id: 'u1', email: 'a@x.vn', passwordHash: 'aa:bb', role: 'buyer' },
        { id: 'u2', email: 'A@x.vn ', passwordHash: 'plaintext', role: 'buyer' },
        { id: 'u2', email: 'c@x.vn', role: 'buyer' }
      ],
      orders: [{ id: 'o1' }],
      vehicles: [{ id: 'v1', name: 'V', price: 'n/a' }]
    });
    const text = v.errors.join('\n');
    assert.match(text, /users: duplicate id "u2"/);
    assert.match(text, /missing passwordHash/);
    assert.match(text, /passwordHash is not salt:hex/);
    assert.match(text, /e-mail a@x\.vn used by u1 and u2/);
    assert.match(text, /orders\[0\] \(o1\) missing userId/);
    assert.match(text, /price is not numeric/);
  });

  it('reports dangling references as warnings, not errors', () => {
    const v = tool.validate({ users: [], vehicles: [], orders: [{ id: 'o1', userId: 'ghost', vehicleId: 'nope' }] });
    assert.strictEqual(v.errors.length, 0);
    assert.ok(v.warnings.some(w => /unknown user "ghost"/.test(w)));
  });

  it('catalog-only keeps reference data and drops customer/demo activity; demo accounts are detected by their public salt', () => {
    const src = tool.loadNormalisedSource(STORE);
    const sel = tool.selectState(src.state, { catalogOnly: true, excludeDemo: true });
    assert.strictEqual(sel.state.users.length, 0);
    assert.strictEqual(sel.state.orders.length, 0);
    assert.strictEqual(sel.state.vehicles.length, src.state.vehicles.length);
    assert.ok(src.state.users.every(tool.isDemoUser), 'every user in the repository snapshot is a demo account');
    const keepRefs = tool.selectState(src.state, { excludeDemo: true });
    assert.ok(tool.findReferences(keepRefs.state, keepRefs.dropped.demoUsers).length > 0, 'orders still point at the demo users');
  });
});

describe('json-to-d1: generated SQL', () => {
  it('imports every record verbatim and in order; D1 metrics equal the source metrics', () => {
    const shim = new D1SqliteShim();
    const src = tool.loadNormalisedSource(STORE);
    const data = importInto(shim, src.state);
    const back = readBack(shim);
    assert.deepStrictEqual(tool.compare(tool.metrics(data.rows, data.meta), tool.metrics(back.rows, back.meta)), []);
    assert.strictEqual(back.rows.length, data.rows.length);
  });

  it('is idempotent and never overwrites rows that changed after the import', () => {
    const shim = new D1SqliteShim();
    const src = tool.loadNormalisedSource(STORE);
    importInto(shim, src.state);
    shim.db.prepare("UPDATE state_documents SET doc = json_set(doc, '$.stock', 99) WHERE collection = 'vehicles' AND doc_key = 'vinfast-vf9'").run();
    const count = shim.db.prepare('SELECT COUNT(*) n FROM state_documents').get().n;
    importInto(shim, src.state); // second run
    assert.strictEqual(shim.db.prepare('SELECT COUNT(*) n FROM state_documents').get().n, count);
    assert.strictEqual(JSON.parse(shim.db.prepare("SELECT doc FROM state_documents WHERE doc_key = 'vinfast-vf9'").get().doc).stock, 99);
    assert.strictEqual(shim.db.prepare('SELECT COUNT(*) n FROM data_migrations').get().n, 1);
  });

  it('bumps the revision so running Workers reload, and the Worker store loads the imported state', async () => {
    const shim = new D1SqliteShim();
    const src = tool.loadNormalisedSource(STORE);
    importInto(shim, src.state);
    assert.strictEqual(shim.db.prepare('SELECT rev FROM state_revision').get().rev, 1);
    const store = new D1StateStore(shim, { logger: quiet });
    const patch = await store.load();
    const loaded = { ...patch.collections, ...patch.meta };
    const expected = JSON.parse(JSON.stringify(src.state));
    for (const k of Object.keys(expected)) if (Array.isArray(expected[k]) && expected[k].length === 0) delete expected[k];
    assert.deepStrictEqual(loaded, expected);
  });

  it('escapes quotes safely (no SQL injection through data)', () => {
    const shim = new D1SqliteShim();
    const evil = { faqs: [{ id: "f'); DROP TABLE state_documents; --", q: "it's '' \"quoted\"" }], meta: { note: "o'clock" } };
    importInto(shim, evil);
    const back = readBack(shim);
    assert.strictEqual(back.rows.length, 1);
    assert.deepStrictEqual(JSON.parse(back.rows[0].doc), evil.faqs[0]);
    assert.strictEqual(JSON.parse(back.meta[0].value).note, "o'clock");
  });

  it('verification detects tampering, a missing row and changed money totals', () => {
    const shim = new D1SqliteShim();
    const src = tool.loadNormalisedSource(STORE);
    const data = importInto(shim, src.state);
    const expected = tool.metrics(data.rows, data.meta);
    const ord = src.state.orders[0].id;
    shim.db.prepare("UPDATE state_documents SET doc = json_set(doc, '$.depositAmount', 1) WHERE collection = 'orders' AND doc_key = ?").run(ord);
    shim.db.prepare("DELETE FROM state_documents WHERE collection = 'faqs' AND doc_key = (SELECT doc_key FROM state_documents WHERE collection = 'faqs' LIMIT 1)").run();
    const back = readBack(shim);
    const diffs = tool.compare(expected, tool.metrics(back.rows, back.meta)).join('\n');
    assert.match(diffs, /orders: orderedSha256 differs/);
    assert.match(diffs, /orders: money totals differ/);
    assert.match(diffs, /faqs: count differs/);
  });
});
