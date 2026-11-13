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

async function startTestServer({ mode = 'memory', reseed = true } = {}) {
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
