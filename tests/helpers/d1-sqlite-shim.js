// tests/helpers/d1-sqlite-shim.js
// In-process stand-in for a Cloudflare D1 binding, backed by node:sqlite (SQLite, like D1), for fast tests under Node.
// Mirrors the D1 Worker API surface the backend uses: prepare().bind().all()/first()/run(), batch() (one transaction:
// any failing statement rolls back the whole batch), exec(). Real D1 behaviour is covered by tests/workers/*.
//
// Test hooks: beforeBatch(fn) runs before a batch starts (simulate another isolate committing first);
// failNext(n, message) makes the next n batch/all/first/run calls fail like an unavailable database.

const fs = require('fs');
const path = require('path');

let DatabaseSync = null;
function loadSqlite() {
  if (!DatabaseSync) {
    const originalEmit = process.emitWarning;
    process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : originalEmit.call(process, w, ...rest));
    try {
      ({ DatabaseSync } = require('node:sqlite'));
    } finally {
      process.emitWarning = originalEmit;
    }
  }
  return DatabaseSync;
}

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'backend', 'infrastructure', 'd1', 'migrations');

function d1Error(err) {
  const e = new Error(`D1_ERROR: ${err && err.message}`);
  e.cause = err;
  return e;
}

function toParam(v) {
  if (v === undefined) throw new Error('D1_TYPE_ERROR: Type \'undefined\' not supported for value \'undefined\'');
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return v;
}

class ShimStatement {
  constructor(shim, sql, params = []) {
    this.shim = shim;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new ShimStatement(this.shim, this.sql, params.map(toParam));
  }

  _execSync() {
    const st = this.shim.db.prepare(this.sql);
    const isRead = /^\s*(SELECT|WITH|PRAGMA)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql);
    if (isRead) {
      const rows = st.all(...this.params).map(r => ({ ...r }));
      return { results: rows, success: true, meta: { changes: 0, rows_read: rows.length } };
    }
    const info = st.run(...this.params);
    return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }

  async _exec() {
    this.shim._maybeFail();
    try {
      return this._execSync();
    } catch (err) {
      throw d1Error(err);
    }
  }

  async all() {
    return this._exec();
  }

  async run() {
    return this._exec();
  }

  async first(column) {
    const res = await this._exec();
    const row = res.results[0];
    if (!row) return null;
    return column ? (row[column] === undefined ? null : row[column]) : row;
  }

  async raw() {
    const res = await this._exec();
    return res.results.map(r => Object.values(r));
  }
}

class D1SqliteShim {
  constructor({ file = ':memory:', migrate = true } = {}) {
    const Db = loadSqlite();
    this.db = new Db(file);
    this.batchCount = 0;
    this.statementCount = 0;
    this._beforeBatch = null;
    this._failures = 0;
    this._failMessage = 'network connection lost';
    if (migrate) this.applyMigrations();
  }

  // Like `wrangler d1 migrations apply`: each file once, tracked in d1_migrations.
  applyMigrations() {
    this.db.exec('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT)');
    const done = new Set(this.db.prepare('SELECT name FROM d1_migrations').all().map(r => r.name));
    for (const f of fs.readdirSync(MIGRATIONS_DIR).filter(n => n.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      this.db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
      this.db.prepare('INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)').run(f, new Date().toISOString());
    }
  }

  beforeBatch(fn) {
    this._beforeBatch = fn;
  }

  failNext(n = 1, message = 'network connection lost') {
    this._failures = n;
    this._failMessage = message;
  }

  _maybeFail() {
    if (this._failures > 0) {
      this._failures--;
      throw new Error(`D1_ERROR: ${this._failMessage}`);
    }
  }

  prepare(sql) {
    return new ShimStatement(this, sql);
  }

  async batch(statements) {
    if (this._beforeBatch) {
      const fn = this._beforeBatch;
      this._beforeBatch = null; // one-shot, and avoids recursion if the hook itself commits
      await fn(statements);
    }
    this._maybeFail();
    this.batchCount++;
    this.statementCount += statements.length;
    this.db.exec('BEGIN');
    try {
      const out = statements.map(s => s._execSync());
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw d1Error(err);
    }
  }

  async exec(sql) {
    this._maybeFail();
    try {
      this.db.exec(sql);
      return { count: 1, duration: 0 };
    } catch (err) {
      throw d1Error(err);
    }
  }

  close() {
    this.db.close();
  }
}

module.exports = { D1SqliteShim, MIGRATIONS_DIR };
