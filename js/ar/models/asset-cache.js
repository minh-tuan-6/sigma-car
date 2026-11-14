// js/ar/models/asset-cache.js — Model Asset Cache.
// Two tiers: an in-memory LRU of ArrayBuffers (instant colour-variant swaps within a visit) and,
// when available, the Cache Storage API (survives reloads; models are immutable, versioned URLs).
// Concurrent requests for the same URL share one download.

export class AssetCache {
  constructor({ maxBytes = 200 * 1024 * 1024, cacheName = 'sigmacar-ar-models-v1', cachesImpl } = {}) {
    this.maxBytes = maxBytes;
    this.cacheName = cacheName;
    this.caches = cachesImpl !== undefined ? cachesImpl : (typeof caches !== 'undefined' ? caches : null);
    this._mem = new Map(); // url -> ArrayBuffer (Map preserves insertion order → LRU)
    this._bytes = 0;
    this._inflight = new Map();
    this.stats = { memoryHits: 0, persistentHits: 0, misses: 0 };
  }

  get sizeBytes() {
    return this._bytes;
  }

  has(url) {
    return this._mem.has(url);
  }

  get(url) {
    const buf = this._mem.get(url);
    if (!buf) return undefined;
    this._mem.delete(url);
    this._mem.set(url, buf); // refresh LRU position
    return buf;
  }

  set(url, buf) {
    if (!(buf instanceof ArrayBuffer)) return;
    if (buf.byteLength > this.maxBytes) return; // never cache something that would evict everything
    if (this._mem.has(url)) {
      this._bytes -= this._mem.get(url).byteLength;
      this._mem.delete(url);
    }
    this._mem.set(url, buf);
    this._bytes += buf.byteLength;
    while (this._bytes > this.maxBytes && this._mem.size > 1) {
      const [oldestUrl, oldest] = this._mem.entries().next().value;
      this._mem.delete(oldestUrl);
      this._bytes -= oldest.byteLength;
    }
  }

  async _readPersistent(url) {
    if (!this.caches) return undefined;
    try {
      const store = await this.caches.open(this.cacheName);
      const hit = await store.match(url);
      return hit ? await hit.arrayBuffer() : undefined;
    } catch (_) {
      return undefined; // private mode / quota / opaque errors → treat as miss
    }
  }

  async _writePersistent(url, buf) {
    if (!this.caches || typeof Response === 'undefined') return;
    try {
      const store = await this.caches.open(this.cacheName);
      await store.put(url, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } }));
    } catch (_) {
      // Quota exceeded etc. — caching is an optimisation only.
    }
  }

  /**
   * Returns the cached buffer or runs fetcher() once for all concurrent callers.
   * Callers receive the same ArrayBuffer; GLTFLoader.parse does not mutate it.
   */
  async getOrFetch(url, fetcher, { persistent = true } = {}) {
    const mem = this.get(url);
    if (mem) {
      this.stats.memoryHits++;
      return mem;
    }
    if (this._inflight.has(url)) return this._inflight.get(url);

    const p = (async () => {
      if (persistent) {
        const cached = await this._readPersistent(url);
        if (cached) {
          this.stats.persistentHits++;
          this.set(url, cached);
          return cached;
        }
      }
      this.stats.misses++;
      const buf = await fetcher();
      this.set(url, buf);
      if (persistent) this._writePersistent(url, buf);
      return buf;
    })();

    this._inflight.set(url, p);
    try {
      return await p;
    } finally {
      this._inflight.delete(url);
    }
  }

  clearMemory() {
    this._mem.clear();
    this._bytes = 0;
  }
}
