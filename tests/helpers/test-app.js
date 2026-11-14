// tests/helpers/test-app.js
// Isolated ephemeral-port HTTP server + storage harness for SIGMACAR test suites

const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Guarantee isolated storage before server/storage modules initialize
process.env.SIGMACAR_STORAGE_MODE = process.env.SIGMACAR_STORAGE_MODE || 'memory';
process.env.SIGMACAR_ALLOW_DEV_SEED = process.env.SIGMACAR_ALLOW_DEV_SEED || 'true';
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'sigmacar-isolated-test-suite-secret-key-2026-min-32-chars';
}

function assertLocalTestUrl(urlStr) {
  if (!urlStr) return;
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch (_) {
    throw new Error(`Invalid TEST_API_URL: ${urlStr}`);
  }
  const allowedHosts = ['localhost', '127.0.0.1', '::1'];
  if (!allowedHosts.includes(parsed.hostname)) {
    throw new Error(`SECURITY GUARD: Refusing to run automated tests against non-local target "${urlStr}".`);
  }
}

function createTempStorePath(prefix = 'sigmacar-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    dataFile: path.join(dir, 'store.json'),
    cleanup() {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_) {}
    }
  };
}

function createMockFs({ failWriteOnCall = null, errCode = 'ENOSPC', errMessage = 'No space left on device' } = {}) {
  const store = new Map();
  const dirs = new Set();
  let writeCount = 0;

  return {
    store,
    getWriteCount: () => writeCount,
    existsSync(target) {
      const p = path.resolve(target);
      return store.has(p) || dirs.has(p);
    },
    mkdirSync(target) {
      dirs.add(path.resolve(target));
    },
    readFileSync(target) {
      const p = path.resolve(target);
      if (!store.has(p)) {
        const err = new Error(`ENOENT: no such file ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
      return store.get(p);
    },
    writeFileSync(target, content) {
      writeCount++;
      if (failWriteOnCall && writeCount >= failWriteOnCall) {
        const err = new Error(errMessage);
        err.code = errCode;
        throw err;
      }
      store.set(path.resolve(target), String(content));
    },
    renameSync(from, to) {
      const src = path.resolve(from);
      const dst = path.resolve(to);
      if (!store.has(src)) throw new Error(`ENOENT rename source ${src}`);
      store.set(dst, store.get(src));
      store.delete(src);
    },
    unlinkSync(target) {
      store.delete(path.resolve(target));
    }
  };
}

// SIGMACAR_TEST_RUNTIME=worker: /api/v1/* is served by the Cloudflare Worker runtime (backend/cloudflare/runtime.js)
// with D1 persistence (D1StateStore on a node:sqlite D1 shim) — the same suites then verify the Workers code path.
// Other paths (static files) still go to server.js, as Pages serves them in production.
async function startWorkerRuntimeServer({ reseed = true } = {}) {
  const { D1SqliteShim } = require('./d1-sqlite-shim');
  const runtime = require('../../backend/cloudflare/runtime');
  const StorageEngine = require('../../backend/infrastructure/storage-engine');
  const Security = require('../../backend/infrastructure/security');
  const nodeServer = require('../../server');
  const staticListener = nodeServer.listeners('request')[0];

  const shim = new D1SqliteShim();
  const env = { DB: shim };
  const lazyBefore = process.env.SIGMACAR_LAZY_INIT;
  // First request initialises the runtime and loads (dev-seeds) the empty database.
  await runtime.handle(new Request('http://127.0.0.1/api/v1/health'), env);
  // The runtime sets SIGMACAR_LAZY_INIT (a Worker safeguard); do not leak it into child processes that suites spawn.
  if (lazyBefore === undefined) delete process.env.SIGMACAR_LAZY_INIT; else process.env.SIGMACAR_LAZY_INIT = lazyBefore;
  // The Node harness inherits the boot normalisation (branch inventory, promotions, accessories, policies) from the
  // JSON file the engine loads at module load; on Workers that normalisation runs when an isolate loads D1.
  if (reseed) {
    StorageEngine.seedInitialData();
    StorageEngine.ensureExtendedCollections();
    await StorageEngine.flushToDriver();
  }
  Security.resetRateLimit();

  const SKIP = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'cf-connecting-ip']);
  const server = http.createServer(async (req, res) => {
    if (!req.url.startsWith('/api/v1/')) return staticListener(req, res);
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (SKIP.has(k) || v === undefined) continue;
        if (Array.isArray(v)) v.forEach(x => headers.append(k, x)); else headers.set(k, v);
      }
      // What the Pages Function forwards: the real client address.
      headers.set('cf-connecting-ip', (req.socket.remoteAddress || '127.0.0.1').replace(/^::ffff:/, ''));
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
      const response = await runtime.handle(request, env);
      const out = [];
      response.headers.forEach((value, name) => out.push([name, value]));
      const body = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, Object.fromEntries(out));
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`worker test bridge error: ${err.message}`);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address();
  const rootUrl = `http://127.0.0.1:${addr.port}`;
  return {
    rootUrl,
    baseUrl: `${rootUrl}/api/v1`,
    server,
    storageEngine: StorageEngine,
    security: Security,
    d1: shim,
    runtime: 'worker',
    external: false,
    reset() {
      StorageEngine.seedInitialData();
      StorageEngine.ensureExtendedCollections();
      Security.resetRateLimit();
      return StorageEngine.flushToDriver();
    },
    async close() {
      await new Promise(resolve => server.close(resolve));
    }
  };
}

async function startTestServer({ mode = 'memory', reseed = true } = {}) {
  if (process.env.SIGMACAR_TEST_RUNTIME === 'worker' && !process.env.TEST_API_URL) {
    return startWorkerRuntimeServer({ reseed });
  }
  if (process.env.TEST_API_URL) {
    assertLocalTestUrl(process.env.TEST_API_URL);
    const parsed = new URL(process.env.TEST_API_URL);
    return {
      rootUrl: `${parsed.protocol}//${parsed.host}`,
      baseUrl: process.env.TEST_API_URL.replace(/\/$/, ''),
      external: true,
      async reset() {},
      async close() {}
    };
  }

  const StorageEngine = require('../../backend/infrastructure/storage-engine');
  const Security = require('../../backend/infrastructure/security');

  let tempStore = null;
  if (mode === 'temp-file') {
    tempStore = createTempStorePath();
    StorageEngine.configureStorage({
      mode: 'json',
      dataFile: tempStore.dataFile,
      allowDevSeed: true
    });
  } else {
    StorageEngine.configureStorage({
      mode: 'memory',
      allowDevSeed: true
    });
  }

  if (reseed) {
    StorageEngine.seedInitialData();
    StorageEngine.saveToDisk();
  }
  Security.resetRateLimit();

  const server = require('../../server');
  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  }

  const addr = server.address();
  const rootUrl = `http://127.0.0.1:${addr.port}`;
  const baseUrl = `${rootUrl}/api/v1`;

  return {
    rootUrl,
    baseUrl,
    server,
    storageEngine: StorageEngine,
    security: Security,
    external: false,
    reset() {
      StorageEngine.seedInitialData();
      StorageEngine.saveToDisk();
      Security.resetRateLimit();
    },
    async close() {
      if (server && server.listening) {
        await new Promise(resolve => server.close(resolve));
      }
      if (tempStore) {
        tempStore.cleanup();
      }
    }
  };
}

module.exports = {
  assertLocalTestUrl,
  createTempStorePath,
  createMockFs,
  startTestServer
};
