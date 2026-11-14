// tests/helpers/isolated-store.js
// Require this FIRST in a test that loads the storage engine without startTestServer(): it points SIGMACAR_DATA_FILE at
// a temporary copy of data/sigmacar_store.json so the test can never rewrite the repository's seed file.
// (The engine ignores SIGMACAR_STORAGE_MODE by design — see backend/config/index.js `storage` — but honours the path.)

const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.SIGMACAR_DATA_FILE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigmacar-test-store-'));
  const target = path.join(dir, 'sigmacar_store.json');
  const seed = path.resolve(__dirname, '..', '..', 'data', 'sigmacar_store.json');
  if (fs.existsSync(seed)) fs.copyFileSync(seed, target);
  process.env.SIGMACAR_DATA_FILE = target;
  process.on('exit', () => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  });
}

module.exports = { dataFile: process.env.SIGMACAR_DATA_FILE };
