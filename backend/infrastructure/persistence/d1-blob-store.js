// backend/infrastructure/persistence/d1-blob-store.js
// Stores private media bytes in D1 (table media_blobs) for the Cloudflare Workers runtime, which has no persistent
// disk. Files (<= 5 MB, enforced by media-storage.js) are split into 512 KiB chunks stored as base64 text, well below
// the 2,000,000-byte D1 row limit. Writes of one file are a single atomic batch.

const { storageError } = require('./d1-state-store');

const CHUNK_BYTES = 512 * 1024;

class D1BlobStore {
  constructor(db, { now = () => new Date().toISOString(), logger = console } = {}) {
    if (!db || typeof db.prepare !== 'function') {
      throw storageError('STORAGE_NOT_CONFIGURED', 'Chưa cấu hình cơ sở dữ liệu D1 (binding DB).', 503);
    }
    this.db = db;
    this.now = now;
    this.logger = logger;
  }

  get kind() {
    return 'd1_blob';
  }

  async _run(label, fn) {
    try {
      return await fn();
    } catch (err) {
      this.logger.error(`[D1BlobStore] ${label} failed: ${String(err && err.message).slice(0, 200)}`);
      throw storageError('MEDIA_STORAGE_UNAVAILABLE', 'Kho lưu trữ tệp tạm thời không khả dụng. Vui lòng thử lại sau.', 503, err);
    }
  }

  async write(key, buffer) {
    const buf = Buffer.from(buffer);
    const nowIso = this.now();
    const stmts = [this.db.prepare('DELETE FROM media_blobs WHERE storage_key = ?').bind(key)];
    const count = Math.max(1, Math.ceil(buf.length / CHUNK_BYTES));
    for (let i = 0; i < count; i++) {
      const part = buf.subarray(i * CHUNK_BYTES, Math.min(buf.length, (i + 1) * CHUNK_BYTES));
      stmts.push(this.db.prepare('INSERT INTO media_blobs (storage_key, chunk_index, data_b64, bytes, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(key, i, part.toString('base64'), part.length, nowIso));
    }
    await this._run('write', () => this.db.batch(stmts));
    return { key, chunks: count, bytes: buf.length };
  }

  async read(key) {
    const res = await this._run('read', () => this.db
      .prepare('SELECT chunk_index, data_b64, bytes FROM media_blobs WHERE storage_key = ? ORDER BY chunk_index')
      .bind(key).all());
    const rows = (res && res.results) || [];
    if (rows.length === 0) return null;
    const parts = [];
    for (let i = 0; i < rows.length; i++) {
      if (Number(rows[i].chunk_index) !== i) return null; // incomplete file: treat as missing rather than corrupt bytes
      const part = Buffer.from(String(rows[i].data_b64), 'base64');
      if (part.length !== Number(rows[i].bytes)) return null;
      parts.push(part);
    }
    return Buffer.concat(parts);
  }

  async delete(key) {
    await this._run('delete', () => this.db.prepare('DELETE FROM media_blobs WHERE storage_key = ?').bind(key).run());
  }
}

module.exports = { D1BlobStore, CHUNK_BYTES };
