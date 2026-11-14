// backend/infrastructure/persistence/d1-state-store.js
// Persistence driver that stores the storage engine's state in Cloudflare D1 (schema: backend/infrastructure/d1/migrations).
//
// The storage engine keeps its in-memory model and its transaction callbacks unchanged. This driver:
//   load()   — brings the in-memory copy up to date with D1 (one query when nothing changed; otherwise one batch that
//              returns a consistent snapshot of the changed collections)
//   commit() — writes the rows that changed since the last load/commit in ONE D1 batch (a transaction). The first
//              statement moves state_revision from `rev` to `rev + 1`; a trigger aborts the batch if another isolate
//              committed in between, and the engine re-runs the transaction on fresh data.
// All SQL uses bound parameters; collection names come from the application state, never from requests.

const codec = require('./state-codec');

const CONFLICT_MARKER = 'SIGMA_REVISION_CONFLICT';

function storageError(code, message, statusCode, cause) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

function errorText(err) {
  if (!err) return '';
  const parts = [String(err.message || err)];
  if (err.cause) parts.push(String(err.cause.message || err.cause));
  return parts.join(' | ');
}

function isConflict(err) {
  return errorText(err).includes(CONFLICT_MARKER);
}

class D1StateStore {
  constructor(db, { now = () => new Date().toISOString(), logger = console } = {}) {
    if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
      throw storageError('STORAGE_NOT_CONFIGURED', 'Chưa cấu hình cơ sở dữ liệu D1 (binding DB).', 503);
    }
    this.db = db;
    this.now = now;
    this.logger = logger;
    this.rev = null; // null = never loaded in this isolate
    this.snapshot = codec.emptySnapshot();
    this.stats = { loads: 0, fullLoads: 0, commits: 0, conflicts: 0, rowsRead: 0, rowsWritten: 0, rowsDeleted: 0 };
  }

  get kind() {
    return 'd1';
  }

  // Wraps D1 failures so callers get a stable code and no driver internals reach API clients.
  async _run(label, fn) {
    try {
      return await fn();
    } catch (err) {
      if (isConflict(err)) throw storageError('STORAGE_CONFLICT', 'Dữ liệu vừa được cập nhật bởi yêu cầu khác.', 409, err);
      const text = errorText(err);
      if (/UNIQUE constraint failed/i.test(text)) {
        throw storageError('DUPLICATE_RECORD', 'Dữ liệu trùng lặp với một bản ghi đã tồn tại.', 409, err);
      }
      if (/no such table/i.test(text)) {
        this.logger.error(`[D1StateStore] ${label}: schema missing — run the D1 migrations`);
        throw storageError('STORAGE_NOT_MIGRATED', 'Cơ sở dữ liệu D1 chưa được khởi tạo lược đồ.', 503, err);
      }
      this.logger.error(`[D1StateStore] ${label} failed: ${text.slice(0, 300)}`);
      throw storageError('STORAGE_UNAVAILABLE', 'Hệ thống lưu trữ tạm thời không khả dụng. Vui lòng thử lại sau.', 503, err);
    }
  }

  // Returns null when nothing changed, otherwise
  // { fullLoad, collections: {name: array}, meta: {key: value}, changed: Set<string>, empty: boolean }
  //
  // First load in an isolate: every row (one batch). Afterwards: one indexed query for the revision and, only when
  // another isolate committed, one batch that reads ONLY the rows written or deleted since this isolate's revision
  // (state_documents.rev / state_deletions.rev > local). Unchanged records keep their in-memory objects, so a reload
  // costs O(changes) in D1 rows read and CPU, not O(collection size). `current` is the engine's live state.
  async load({ force = false, current = null } = {}) {
    return this._run('load', async () => {
      if (this.rev === null || force) return this._fullLoad();

      const row = await this.db.prepare('SELECT rev FROM state_revision WHERE id = 1').first();
      this.stats.rowsRead += 1;
      const probeRev = row ? Number(row.rev) : 0;
      if (probeRev === this.rev) return null;
      if (probeRev < this.rev) return this._fullLoad(); // database restored to an older point (e.g. Time Travel)

      const since = this.rev;
      const results = await this.db.batch([
        this.db.prepare('SELECT rev FROM state_revision WHERE id = 1'),
        this.db.prepare('SELECT collection, doc_key, pos, doc, rev FROM state_documents WHERE rev > ?').bind(since),
        this.db.prepare('SELECT collection, doc_key, rev FROM state_deletions WHERE rev > ?').bind(since),
        this.db.prepare('SELECT key, value FROM state_meta')
      ]);
      const remoteRev = results[0].results && results[0].results[0] ? Number(results[0].results[0].rev) : 0;
      const upserts = results[1].results || [];
      const deletions = results[2].results || [];
      this.stats.rowsRead += 1 + upserts.length + deletions.length + (results[3].results || []).length;

      // Latest event per key wins (a key deleted and re-created, or the reverse, within the window).
      const events = new Map(); // collection -> Map(key -> {rev, row|null})
      const note = (collection, key, rev, rowData) => {
        if (!events.has(collection)) events.set(collection, new Map());
        const m = events.get(collection);
        const prev = m.get(key);
        if (!prev || rev >= prev.rev) m.set(key, { rev, row: rowData });
      };
      for (const d of deletions) note(d.collection, d.doc_key, Number(d.rev), null);
      for (const u of upserts) note(u.collection, u.doc_key, Number(u.rev), u);

      const collections = {};
      const changed = new Set();
      for (const [name, keyEvents] of events) {
        const snap = this.snapshot.collections.get(name) || { keys: [], json: new Map(), pos: new Map() };
        const json = new Map(snap.json);
        const pos = new Map(snap.pos);
        for (const [key, ev] of keyEvents) {
          if (ev.row) {
            json.set(key, ev.row.doc);
            pos.set(key, Number(ev.row.pos));
          } else {
            json.delete(key);
            pos.delete(key);
          }
        }
        const keys = [...json.keys()].sort((a, b) => (pos.get(a) - pos.get(b)) || (a < b ? -1 : a > b ? 1 : 0));

        // Reuse live objects for records this patch did not touch.
        const live = new Map();
        const arr = current && Array.isArray(current[name]) ? current[name] : [];
        const liveKeys = codec.keysForArray(arr);
        liveKeys.forEach((k, i) => live.set(k, arr[i]));
        collections[name] = keys.map(k => (keyEvents.has(k) || !live.has(k) ? JSON.parse(json.get(k)) : live.get(k)));

        if (keys.length) this.snapshot.collections.set(name, { keys, json, pos });
        else this.snapshot.collections.delete(name);
        changed.add(name);
      }

      const meta = {};
      const metaSnap = new Map();
      for (const r of results[3].results || []) {
        meta[r.key] = JSON.parse(r.value);
        metaSnap.set(r.key, r.value);
      }
      this.snapshot.meta = metaSnap;
      changed.add('meta');

      this.rev = remoteRev;
      this.stats.loads++;
      return { fullLoad: false, collections, meta, changed, empty: false };
    });
  }

  async _fullLoad() {
    const results = await this.db.batch([
      this.db.prepare('SELECT rev FROM state_revision WHERE id = 1'),
      this.db.prepare('SELECT collection, doc_key, pos, doc FROM state_documents'),
      this.db.prepare('SELECT key, value FROM state_meta')
    ]);
    const remoteRev = results[0].results && results[0].results[0] ? Number(results[0].results[0].rev) : 0;
    const rows = results[1].results || [];
    const decoded = codec.decodeRows(rows);
    const meta = {};
    const metaSnap = new Map();
    for (const r of results[2].results || []) {
      meta[r.key] = JSON.parse(r.value);
      metaSnap.set(r.key, r.value);
    }
    this.snapshot = { collections: decoded.snapshot, meta: metaSnap };
    this.rev = remoteRev;
    this.stats.loads++;
    this.stats.fullLoads++;
    this.stats.rowsRead += 1 + rows.length + metaSnap.size;
    const changed = new Set([...decoded.snapshot.keys(), 'meta']);
    return {
      fullLoad: true,
      collections: decoded.collections,
      meta,
      changed,
      empty: remoteRev === 0 && rows.length === 0 && metaSnap.size === 0
    };
  }

  // True when the in-memory state differs from what D1 holds (cost: one JSON.stringify of every record).
  hasChanges(state) {
    const d = codec.diffState(this.snapshot, state);
    return d.upserts.length + d.deletes.length + d.meta.length + d.metaDeletes.length > 0;
  }

  // Writes the difference between `state` and the last loaded/committed snapshot.
  // Returns { committed: false } when there is nothing to write. Throws STORAGE_CONFLICT on a lost race.
  async commit(state) {
    if (this.rev === null) {
      throw storageError('STORAGE_NOT_LOADED', 'Trạng thái chưa được tải từ D1.', 503);
    }
    const d = codec.diffState(this.snapshot, state);
    if (d.upserts.length + d.deletes.length + d.meta.length + d.metaDeletes.length === 0) {
      return { committed: false, rev: this.rev };
    }
    const nowIso = this.now();
    const nextRev = this.rev + 1;
    const db = this.db;
    const stmts = [db.prepare('UPDATE state_revision SET rev = ?, updated_at = ? WHERE id = 1').bind(nextRev, nowIso)];
    const upsert = 'INSERT INTO state_documents (collection, doc_key, pos, doc, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT (collection, doc_key) DO UPDATE SET pos = excluded.pos, doc = excluded.doc, updated_at = excluded.updated_at, rev = excluded.rev';
    // Deletes first: a record removed and re-added under the same unique value must not trip the unique indexes.
    for (const del of d.deletes) {
      stmts.push(db.prepare('DELETE FROM state_documents WHERE collection = ? AND doc_key = ?').bind(del.collection, del.key));
      stmts.push(db.prepare('INSERT INTO state_deletions (collection, doc_key, rev) VALUES (?, ?, ?) ON CONFLICT (collection, doc_key) DO UPDATE SET rev = excluded.rev').bind(del.collection, del.key, nextRev));
    }
    for (const u of d.upserts) {
      stmts.push(db.prepare(upsert).bind(u.collection, u.key, u.pos, u.doc, nowIso, nextRev));
    }
    for (const m of d.meta) {
      stmts.push(db.prepare('INSERT INTO state_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(m.key, m.value, nowIso));
    }
    for (const key of d.metaDeletes) {
      stmts.push(db.prepare('DELETE FROM state_meta WHERE key = ?').bind(key));
    }

    await this._run('commit', async () => {
      try {
        await db.batch(stmts);
      } catch (err) {
        if (isConflict(err)) this.stats.conflicts++;
        throw err;
      }
    });

    this.snapshot = d.next;
    this.rev = nextRev;
    this.stats.commits++;
    this.stats.rowsWritten += 1 + d.upserts.length + d.deletes.length * 2 + d.meta.length + d.metaDeletes.length;
    this.stats.rowsDeleted += d.deletes.length;
    return { committed: true, rev: nextRev, upserts: d.upserts.length, deletes: d.deletes.length, changed: [...d.changedCollections] };
  }
}

module.exports = {
  D1StateStore,
  CONFLICT_MARKER,
  isConflict,
  storageError
};
