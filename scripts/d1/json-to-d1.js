#!/usr/bin/env node
// scripts/d1/json-to-d1.js
// JSON store (data/sigmacar_store.json format) → Cloudflare D1 (state store schema), plus verification and the reverse
// export used for rollback. The source file is opened read-only and never modified.
//
//   node scripts/d1/json-to-d1.js --validate                          parse + normalise + validate, write nothing
//   node scripts/d1/json-to-d1.js --dry-run                           … + write the SQL file and a report, execute nothing
//   node scripts/d1/json-to-d1.js --execute --local                   apply schema + import into the local (Miniflare) D1
//   node scripts/d1/json-to-d1.js --execute --env staging             … into the staging D1 (remote; needs wrangler login)
//   node scripts/d1/json-to-d1.js --execute --env production --confirm-production
//   node scripts/d1/json-to-d1.js --verify  --local | --env <name>   compare D1 with the source, write a report
//   node scripts/d1/json-to-d1.js --export-json <file> --local | --env <name>   rebuild a JSON store from D1 (rollback)
//
// Options: --source <file>  --out-dir <dir> (default .d1-migration/)  --catalog-only  --exclude-demo-accounts
//          --merge (allow importing into a non-empty database; existing rows are never overwritten)
//          --report <file.md>  --persist-to <dir> (local D1 state directory)  --config <wrangler config>  --force

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_SOURCE = path.join(ROOT, 'data', 'sigmacar_store.json');
const DEFAULT_CONFIG = path.join(ROOT, 'wrangler.api.toml');
const DEMO_SALT = 'a1b2c3d4e5f60718'; // fixed salt of the demo accounts in storage-engine.js seedInitialData()
const MAX_STATEMENT_BYTES = 95000; // D1 limit: 100,000 bytes per SQL statement (file import cannot bind parameters)

// Reference/catalog data that a production database may start with. Everything else is customer or demo activity.
const CATALOG_COLLECTIONS = [
  'vehicles', 'certifiedVehicles', 'branchInventory', 'accessories', 'promotions', 'policyVersions', 'faqs',
  'serviceCenters', 'serviceBays', 'technicians', 'serviceParts', 'partsLedger', 'tcoAssumptions',
  'contentEntries', 'cmsContents', 'chargingCache'
];
const MONEY_COLLECTIONS = ['orders', 'paymentIntents', 'paymentLedger', 'refunds', 'quotes', 'reservations'];

// ---------------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const a = { source: DEFAULT_SOURCE, outDir: path.join(ROOT, '.d1-migration'), config: DEFAULT_CONFIG };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${k} needs a value`);
      return argv[++i];
    };
    switch (k) {
      case '--validate': a.validate = true; break;
      case '--dry-run': a.dryRun = true; break;
      case '--execute': a.execute = true; break;
      case '--verify': a.verify = true; break;
      case '--export-json': a.exportJson = path.resolve(next()); break;
      case '--local': a.local = true; break;
      case '--env': a.env = next(); break;
      case '--confirm-production': a.confirmProduction = true; break;
      case '--source': a.source = path.resolve(next()); break;
      case '--out-dir': a.outDir = path.resolve(next()); break;
      case '--catalog-only': a.catalogOnly = true; break;
      case '--exclude-demo-accounts': a.excludeDemo = true; break;
      case '--merge': a.merge = true; break;
      case '--report': a.report = path.resolve(next()); break;
      case '--persist-to': a.persistTo = path.resolve(next()); break;
      case '--config': a.config = path.resolve(next()); break;
      case '--force': a.force = true; break;
      case '-h': case '--help': a.help = true; break;
      default: throw new Error(`Unknown option ${k}`);
    }
  }
  return a;
}

// ---------------------------------------------------------------------------------------------------------------
// Source: read-only, normalised exactly like the Node backend does at boot
// ---------------------------------------------------------------------------------------------------------------
function readOnlyFs(realFs) {
  const deny = (name) => () => { throw new Error(`json-to-d1: refusing ${name} (source is read-only)`); };
  return {
    existsSync: realFs.existsSync.bind(realFs),
    readFileSync: realFs.readFileSync.bind(realFs),
    mkdirSync: deny('mkdirSync'),
    writeFileSync: deny('writeFileSync'),
    renameSync: deny('renameSync'),
    unlinkSync: deny('unlinkSync')
  };
}

function loadNormalisedSource(file) {
  if (!fs.existsSync(file)) throw new Error(`Source JSON store not found: ${file}`);
  const raw = fs.readFileSync(file);
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  const parsed = JSON.parse(raw.toString('utf8')); // throws on corrupt JSON before anything else happens
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Source root must be a JSON object');

  process.env.SIGMACAR_LAZY_INIT = 'true';
  const StorageEngine = require('../../backend/infrastructure/storage-engine');
  StorageEngine.configureStorage({ driver: null, mode: 'json', dataFile: file, fsImpl: readOnlyFs(fs), allowDevSeed: false });
  // Same path as Node boot: parse + ensureExtendedCollections(). Rows that the normalisation adds are stamped with
  // "now"; freeze that clock at the moment the store was last saved so the import is reproducible and verifiable.
  const savedAt = parsed.meta && !Number.isNaN(Date.parse(parsed.meta.lastSavedAt)) ? parsed.meta.lastSavedAt : fs.statSync(file).mtime.toISOString();
  withFixedClock(savedAt, () => StorageEngine.reload());
  const state = JSON.parse(JSON.stringify(StorageEngine.dbState));
  return { raw: parsed, state, sha256, bytes: raw.length, normalisedAt: savedAt };
}

function withFixedClock(iso, fn) {
  const RealDate = global.Date;
  const fixed = RealDate.parse(iso);
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed); else super(...args);
    }

    static now() {
      return fixed;
    }
  }
  global.Date = FixedDate;
  try {
    return fn();
  } finally {
    global.Date = RealDate;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Selection and validation
// ---------------------------------------------------------------------------------------------------------------
function isDemoUser(u) {
  return Boolean(u && typeof u.passwordHash === 'string' && u.passwordHash.startsWith(`${DEMO_SALT}:`));
}

function selectState(state, { catalogOnly, excludeDemo }) {
  const out = {};
  const dropped = { collections: [], demoUsers: [] };
  for (const [k, v] of Object.entries(state)) {
    if (!Array.isArray(v)) { out[k] = v; continue; }
    if (catalogOnly && !CATALOG_COLLECTIONS.includes(k)) {
      if (v.length) dropped.collections.push(`${k} (${v.length})`);
      out[k] = [];
      continue;
    }
    out[k] = v;
  }
  if (excludeDemo && Array.isArray(out.users)) {
    dropped.demoUsers = out.users.filter(isDemoUser).map(u => u.id);
    out.users = out.users.filter(u => !isDemoUser(u));
  }
  return { state: out, dropped };
}

function findReferences(state, ids) {
  const hits = [];
  if (!ids.length) return hits;
  const set = new Set(ids);
  const walk = (node, where) => {
    if (typeof node === 'string') { if (set.has(node)) hits.push(where); return; }
    if (Array.isArray(node)) { node.forEach((x, i) => walk(x, `${where}[${i}]`)); return; }
    if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, `${where}.${k}`);
  };
  for (const [k, v] of Object.entries(state)) {
    if (k === 'users' || !Array.isArray(v)) continue;
    v.forEach((rec, i) => walk(rec, `${k}[${i}]${rec && rec.id ? `(${rec.id})` : ''}`));
  }
  return hits;
}

function validate(state) {
  const errors = [];
  const warnings = [];
  const ids = (c) => new Set((state[c] || []).map(r => r && r.id).filter(Boolean));
  const catalog = new Set([...ids('vehicles'), ...ids('certifiedVehicles')]);
  const users = ids('users');
  const orders = ids('orders');

  for (const [name, v] of Object.entries(state)) {
    if (!Array.isArray(v)) continue;
    const seen = new Map();
    v.forEach((r, i) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) { warnings.push(`${name}[${i}] is not an object (kept verbatim)`); return; }
      if (typeof r.id !== 'string' || !r.id) { warnings.push(`${name}[${i}] has no string id (stored with a positional key)`); return; }
      seen.set(r.id, (seen.get(r.id) || 0) + 1);
    });
    for (const [id, n] of seen) if (n > 1) errors.push(`${name}: duplicate id "${id}" ×${n}`);
  }

  const req = (coll, fields, check) => (state[coll] || []).forEach((r, i) => {
    for (const f of fields) if (r == null || r[f] === undefined || r[f] === null || r[f] === '') errors.push(`${coll}[${i}] (${r && r.id}) missing ${f}`);
    if (check && r) { const m = check(r); if (m) errors.push(`${coll}[${i}] (${r.id}) ${m}`); }
  });
  req('users', ['id', 'email', 'passwordHash', 'role'], (u) => (/^[0-9a-f]+:[0-9a-f]+$/i.test(u.passwordHash) ? null : 'passwordHash is not salt:hex'));
  req('vehicles', ['id', 'name'], (v) => (Number.isFinite(Number(v.price)) ? null : 'price is not numeric'));
  req('orders', ['id', 'userId']);
  req('paymentIntents', ['id', 'orderId'], (p) => (Number.isFinite(Number(p.amount)) ? null : 'amount is not numeric'));
  req('carts', ['id', 'userId']);
  req('branchInventory', ['id', 'vehicleId', 'branchId'], (b) => (Number.isInteger(b.stockOnHand) ? null : 'stockOnHand is not an integer'));

  const emails = new Map();
  for (const u of state.users || []) {
    const e = String(u.email || '').trim().toLowerCase();
    if (emails.has(e)) errors.push(`users: e-mail ${e} used by ${emails.get(e)} and ${u.id}`);
    emails.set(e, u.id);
  }
  const ref = (coll, field, target, targetName) => (state[coll] || []).forEach(r => {
    if (r && r[field] && !target.has(r[field])) warnings.push(`${coll}(${r.id}).${field} → unknown ${targetName} "${r[field]}"`);
  });
  ref('orders', 'userId', users, 'user');
  ref('orders', 'vehicleId', catalog, 'vehicle');
  ref('paymentIntents', 'orderId', orders, 'order');
  ref('paymentLedger', 'orderId', orders, 'order');
  ref('carts', 'userId', users, 'user');
  ref('branchInventory', 'vehicleId', catalog, 'vehicle');
  ref('reviews', 'vehicleId', catalog, 'vehicle');
  ref('returnRequests', 'orderId', orders, 'order');
  ref('appointments', 'userId', users, 'user');

  if (state.meta && state.meta.aiConfig && ['geminiApiKey', 'groqApiKey', 'openaiApiKey'].some(k => state.meta.aiConfig[k])) {
    warnings.push('meta.aiConfig contains LLM API keys (stored in D1 like in the JSON file; prefer Worker secrets — audit S2)');
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------------------------------------------
// Rows, metrics, SQL
// ---------------------------------------------------------------------------------------------------------------
function rowsOf(state) {
  const codec = require('../../backend/infrastructure/persistence/state-codec');
  const snap = codec.encodeState(state);
  const rows = [];
  for (const [collection, c] of snap.collections) {
    for (const key of c.keys) rows.push({ collection, doc_key: key, pos: c.pos.get(key), doc: c.json.get(key) });
  }
  const meta = [...snap.meta.entries()].map(([key, value]) => ({ key, value }));
  return { rows, meta };
}

function sha(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// Per-collection fingerprint: counts, id set, ordered content hash, money totals, auth fields.
function metrics(rows, meta) {
  const byColl = new Map();
  for (const r of rows) {
    if (!byColl.has(r.collection)) byColl.set(r.collection, []);
    byColl.get(r.collection).push(r);
  }
  const out = { collections: {}, meta: {} };
  for (const [name, list] of [...byColl.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    list.sort((a, b) => Number(a.pos) - Number(b.pos));
    const docs = list.map(r => r.doc);
    const m = { count: list.length, orderedSha256: sha(JSON.stringify(list.map(r => [r.doc_key, r.doc]))), idsSha256: sha(list.map(r => r.doc_key).sort().join('\n')) };
    if (MONEY_COLLECTIONS.includes(name)) {
      const totals = {};
      for (const d of docs) {
        const o = JSON.parse(d);
        for (const [k, v] of Object.entries(o)) if (/amount|price|total/i.test(k) && typeof v === 'number') totals[k] = (totals[k] || 0) + v;
      }
      m.moneyTotals = totals;
    }
    if (name === 'users') {
      m.authSha256 = sha(JSON.stringify(docs.map(d => { const u = JSON.parse(d); return [u.id, u.email, u.passwordHash, u.sessionVersion, u.role, u.disabledAt || null]; })));
    }
    out.collections[name] = m;
  }
  for (const { key, value } of meta) out.meta[key] = sha(value);
  return out;
}

function q(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function buildSql({ rows, meta }, { id, sourceSha, mode, summary, nowIso }) {
  const out = [];
  out.push('-- SIGMACAR JSON → D1 import (scripts/d1/json-to-d1.js). Rows are never overwritten (ON CONFLICT DO NOTHING).');
  out.push(`-- source sha256 ${sourceSha}; mode ${mode}; generated ${nowIso}`);
  out.push(`INSERT INTO data_migrations (id, source_sha256, mode, applied_at, summary) VALUES (${q(id)}, ${q(sourceSha)}, ${q(mode)}, ${q(nowIso)}, ${q(JSON.stringify(summary))}) ON CONFLICT (id) DO NOTHING;`);
  for (const r of rows) {
    // rev = the revision this import commits, so running isolates pick the rows up incrementally (migration 0002)
    const stmt = `INSERT INTO state_documents (collection, doc_key, pos, doc, updated_at, rev) VALUES (${q(r.collection)}, ${q(r.doc_key)}, ${Number(r.pos)}, ${q(r.doc)}, ${q(nowIso)}, (SELECT rev + 1 FROM state_revision WHERE id = 1)) ON CONFLICT (collection, doc_key) DO NOTHING;`;
    if (Buffer.byteLength(stmt) > MAX_STATEMENT_BYTES) throw new Error(`Record ${r.collection}/${r.doc_key} is too large for a SQL file statement (${Buffer.byteLength(stmt)} bytes)`);
    out.push(stmt);
  }
  for (const m of meta) out.push(`INSERT INTO state_meta (key, value, updated_at) VALUES (${q(m.key)}, ${q(m.value)}, ${q(nowIso)}) ON CONFLICT (key) DO NOTHING;`);
  const collections = [...new Set(rows.map(r => r.collection))];
  for (const c of collections) {
    out.push(`INSERT INTO state_collection_revision (collection, rev) SELECT ${q(c)}, rev + 1 FROM state_revision WHERE id = 1 ON CONFLICT (collection) DO UPDATE SET rev = excluded.rev;`);
  }
  // Running Workers reload on their next request (the trigger accepts exactly rev + 1).
  out.push(`UPDATE state_revision SET rev = rev + 1, updated_at = ${q(nowIso)} WHERE id = 1;`);
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------------------------
// Wrangler
// ---------------------------------------------------------------------------------------------------------------
function wranglerArgs(a, extra) {
  const args = [...extra, '-c', a.config];
  if (a.local) {
    args.push('--local');
    if (a.persistTo) args.push('--persist-to', a.persistTo);
  } else if (a.env) {
    args.push('--env', a.env, '--remote');
  } else {
    throw new Error('Choose a target: --local or --env <staging|production>');
  }
  return args;
}

function wrangler(a, extra, { json = false } = {}) {
  const pkgDir = path.dirname(require.resolve('wrangler/package.json', { paths: [ROOT] }));
  const bin = path.join(pkgDir, require(path.join(pkgDir, 'package.json')).bin.wrangler);
  const r = spawnSync(process.execPath, [bin, ...wranglerArgs(a, extra)], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' }
  });
  if (r.status !== 0) {
    throw new Error(`wrangler ${extra.slice(0, 3).join(' ')} failed (exit ${r.status}):\n${(r.stderr || '').slice(-2000)}${(r.stdout || '').slice(-2000)}`);
  }
  if (!json) return r.stdout;
  const start = r.stdout.indexOf('[');
  return JSON.parse(r.stdout.slice(start));
}

function queryD1(a, sql) {
  const res = wrangler(a, ['d1', 'execute', 'DB', '--command', sql, '--json'], { json: true });
  return (res[0] && res[0].results) || [];
}

function readD1(a) {
  return {
    rows: queryD1(a, 'SELECT collection, doc_key, pos, doc FROM state_documents'),
    meta: queryD1(a, 'SELECT key, value FROM state_meta')
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------------------------
function compare(expected, actual) {
  const diffs = [];
  const names = new Set([...Object.keys(expected.collections), ...Object.keys(actual.collections)]);
  for (const n of [...names].sort()) {
    const e = expected.collections[n];
    const x = actual.collections[n];
    if (!e) { diffs.push(`${n}: present in D1 only (${x.count} rows)`); continue; }
    if (!x) { diffs.push(`${n}: missing in D1 (${e.count} rows expected)`); continue; }
    for (const k of ['count', 'idsSha256', 'orderedSha256', 'authSha256']) if (e[k] !== x[k]) diffs.push(`${n}: ${k} differs (${e[k]} ≠ ${x[k]})`);
    if (JSON.stringify(e.moneyTotals || {}) !== JSON.stringify(x.moneyTotals || {})) diffs.push(`${n}: money totals differ`);
  }
  for (const k of new Set([...Object.keys(expected.meta), ...Object.keys(actual.meta)])) {
    if (expected.meta[k] !== actual.meta[k]) diffs.push(`meta.${k} differs`);
  }
  return diffs;
}

function report({ title, a, src, selection, validation, expected, actual, diffs, sqlFile, nowIso }) {
  const L = [];
  L.push(`## ${title}`, '');
  L.push(`- Date: ${nowIso}`);
  L.push(`- Source: \`${path.relative(ROOT, a.source) || a.source}\` — ${src.bytes} bytes, sha256 \`${src.sha256}\` (opened read-only)`);
  L.push(`- Mode: ${a.catalogOnly ? 'catalog only' : 'full'}${a.excludeDemo ? ', demo accounts excluded' : ''}${a.merge ? ', merge' : ''}`);
  if (a.local || a.env) L.push(`- Target: ${a.local ? 'local D1 (Miniflare)' : `--env ${a.env} (remote)`}`);
  if (sqlFile) L.push(`- SQL file: \`${path.relative(ROOT, sqlFile)}\` (${fs.statSync(sqlFile).size} bytes)`);
  if (selection.dropped.collections.length) L.push(`- Not imported (catalog only): ${selection.dropped.collections.join(', ')}`);
  if (selection.dropped.demoUsers.length) L.push(`- Demo accounts excluded: ${selection.dropped.demoUsers.join(', ')}`);
  L.push('', `Validation: **${validation.errors.length} errors, ${validation.warnings.length} warnings**`);
  for (const e of validation.errors) L.push(`- ERROR ${e}`);
  for (const w of validation.warnings.slice(0, 50)) L.push(`- warning: ${w}`);
  if (validation.warnings.length > 50) L.push(`- … ${validation.warnings.length - 50} more warnings`);
  L.push('', '| Collection | Rows | Money totals | Verified in D1 |', '|---|---|---|---|');
  for (const [n, m] of Object.entries(expected.collections)) {
    const money = m.moneyTotals ? Object.entries(m.moneyTotals).map(([k, v]) => `${k} ${v.toLocaleString('en-US')}`).join('; ') : '';
    const ver = actual ? (diffs.some(d => d.startsWith(`${n}:`)) ? '❌' : '✅ count, ids, content+order hash' + (m.authSha256 ? ', auth fields' : '') + (m.moneyTotals ? ', money' : '')) : '—';
    L.push(`| ${n} | ${m.count} | ${money} | ${ver} |`);
  }
  L.push(`| meta keys | ${Object.keys(expected.meta).join(', ')} |  | ${actual ? (diffs.some(d => d.startsWith('meta.')) ? '❌' : '✅') : '—'} |`);
  if (actual) {
    L.push('', diffs.length ? `**Verification FAILED — ${diffs.length} difference(s):**` : '**Verification passed: D1 matches the source exactly.**');
    for (const d of diffs) L.push(`- ${d}`);
  }
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------------
function main(argv = process.argv.slice(2)) {
  const a = parseArgs(argv);
  if (a.help || !(a.validate || a.dryRun || a.execute || a.verify || a.exportJson)) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 19).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  if (a.env === 'production' && (a.execute || a.exportJson) && !a.confirmProduction && a.execute) {
    throw new Error('Refusing to import into production without --confirm-production (see docs/CLOUDFLARE_WORKERS_DEPLOYMENT.md).');
  }
  const nowIso = new Date().toISOString();

  if (a.exportJson) {
    if (fs.existsSync(a.exportJson) && !a.force) throw new Error(`${a.exportJson} exists (use --force to overwrite)`);
    const { rows, meta } = readD1(a);
    const codec = require('../../backend/infrastructure/persistence/state-codec');
    const state = codec.decodeRows(rows).collections;
    for (const m of meta) state[m.key] = JSON.parse(m.value);
    fs.mkdirSync(path.dirname(a.exportJson), { recursive: true });
    fs.writeFileSync(a.exportJson, JSON.stringify(state, null, 2), 'utf8');
    console.log(`Exported ${rows.length} rows from D1 to ${a.exportJson}`);
    return 0;
  }

  const src = loadNormalisedSource(a.source);
  const selection = selectState(src.state, a);
  const validation = validate(selection.state);
  if (a.excludeDemo && selection.dropped.demoUsers.length) {
    const refs = findReferences(selection.state, selection.dropped.demoUsers);
    if (refs.length) validation.errors.push(`excluded demo accounts are still referenced (${refs.length}): ${refs.slice(0, 8).join(', ')}${refs.length > 8 ? ' …' : ''} — use --catalog-only`);
  }
  const data = rowsOf(selection.state);
  const expected = metrics(data.rows, data.meta);
  const mode = [a.catalogOnly ? 'catalog' : 'full', a.excludeDemo ? 'no-demo' : 'with-demo'].join('+');
  const migrationId = `json-import:${src.sha256.slice(0, 16)}:${mode}`;

  let sqlFile = null;
  if (a.dryRun || a.execute) {
    if (validation.errors.length) {
      console.error(`Validation failed (${validation.errors.length} errors):\n- ${validation.errors.join('\n- ')}`);
      return 2;
    }
    const sql = buildSql(data, { id: migrationId, sourceSha: src.sha256, mode, summary: { rows: data.rows.length, collections: Object.keys(expected.collections).length }, nowIso });
    fs.mkdirSync(a.outDir, { recursive: true });
    sqlFile = path.join(a.outDir, `import-${src.sha256.slice(0, 12)}-${mode}.sql`);
    fs.writeFileSync(sqlFile, sql, 'utf8');
  }

  let actual = null;
  let diffs = [];
  if (a.execute) {
    wrangler(a, ['d1', 'migrations', 'apply', 'DB']);
    const existing = Number((queryD1(a, 'SELECT COUNT(*) AS n FROM state_documents')[0] || {}).n || 0);
    if (existing > 0 && !a.merge) throw new Error(`Target D1 already holds ${existing} rows. Re-run with --merge to add missing rows only (existing rows are never overwritten).`);
    const already = queryD1(a, `SELECT id FROM data_migrations WHERE id = ${q(migrationId)}`);
    if (already.length && !a.merge) throw new Error(`This source was already imported (${migrationId}).`);
    wrangler(a, ['d1', 'execute', 'DB', '--file', sqlFile, '--yes']);
    console.log(`Imported into ${a.local ? 'local D1' : a.env}: ${data.rows.length} rows, ${data.meta.length} meta values`);
  }
  if (a.execute || a.verify) {
    const d1 = readD1(a);
    actual = metrics(d1.rows, d1.meta);
    diffs = compare(expected, actual);
  }

  const title = a.verify || a.execute ? 'JSON → D1 import and verification' : (a.dryRun ? 'JSON → D1 dry run' : 'JSON store validation');
  const text = report({ title, a, src, selection, validation, expected, actual, diffs, sqlFile, nowIso });
  if (a.report) {
    fs.mkdirSync(path.dirname(a.report), { recursive: true });
    fs.writeFileSync(a.report, text, 'utf8');
  }
  console.log(text);
  if (validation.errors.length || diffs.length) return 2;
  return 0;
}

module.exports = { parseArgs, loadNormalisedSource, selectState, validate, findReferences, rowsOf, metrics, buildSql, compare, isDemoUser, CATALOG_COLLECTIONS };

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`json-to-d1: ${err.message}`);
    process.exitCode = 1;
  }
}
