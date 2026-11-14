// tests/workers/harness.js
// Starts the two backends that the Workers tests compare, from the same data and the same JWT secret:
//   node   — node server.js with a JSON store file (current architecture)
//   worker — wrangler dev (workerd, the Workers runtime) with a local D1 database imported by scripts/d1/json-to-d1.js
// Local only; nothing is deployed. Requires the devDependency wrangler (npm ci).

process.env.SIGMACAR_LAZY_INIT = 'true';

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const JWT_SECRET = 'sigmacar-workers-contract-test-secret-0123456789';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(url, child, logs, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`process exited (${child.exitCode}):\n${logs.join('').slice(-3000)}`);
    try {
      const r = await fetch(url);
      if (r.status === 200) return;
    } catch (_) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`timeout waiting for ${url}:\n${logs.join('').slice(-3000)}`);
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

// The dev seed (demo accounts + catalog + sample records), as Node writes it when no store file exists.
function writeSeedFile(file) {
  const StorageEngine = require('../../backend/infrastructure/storage-engine');
  StorageEngine.configureStorage({ driver: null, mode: 'memory', allowDevSeed: true });
  StorageEngine.seedInitialData();
  StorageEngine.dbState.meta.lastSavedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(StorageEngine.dbState, null, 2));
}

function wranglerBin() {
  const pkgDir = path.dirname(require.resolve('wrangler/package.json', { paths: [ROOT] }));
  return path.join(pkgDir, require(path.join(pkgDir, 'package.json')).bin.wrangler);
}

async function startBackends({ seedFile } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigmacar-workers-'));
  const seed = seedFile || path.join(dir, 'seed.json');
  if (!seedFile) writeSeedFile(seed);
  const nodeStore = path.join(dir, 'node-store.json');
  fs.copyFileSync(seed, nodeStore);
  const persist = path.join(dir, 'd1');

  // Worker database: schema migration + import through the real tool (Miniflare D1).
  const imp = spawnSync(process.execPath, ['scripts/d1/json-to-d1.js', '--execute', '--local', '--persist-to', persist, '--source', seed, '--out-dir', path.join(dir, 'sql')], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
  });
  if (imp.status !== 0) throw new Error(`D1 import failed:\n${imp.stderr}\n${imp.stdout.slice(-2000)}`);

  const [nodePort, workerPort] = await Promise.all([freePort(), freePort()]);
  const nodeLogs = [];
  const workerLogs = [];
  const baseEnv = { ...process.env, SIGMACAR_LAZY_INIT: '' };
  delete baseEnv.SIGMACAR_LAZY_INIT;

  const node = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...baseEnv, PORT: String(nodePort), NODE_ENV: 'development', JWT_SECRET, SIGMACAR_DATA_FILE: nodeStore, SIGMACAR_ALLOW_DEV_SEED: 'false', SIGMACAR_STORAGE_MODE: 'json' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  node.stdout.on('data', d => nodeLogs.push(String(d)));
  node.stderr.on('data', d => nodeLogs.push(String(d)));

  const worker = spawn(process.execPath, [wranglerBin(), 'dev', '-c', 'wrangler.api.toml', '--ip', '127.0.0.1', '--port', String(workerPort),
    '--persist-to', persist, '--var', `JWT_SECRET:${JWT_SECRET}`, '--show-interactive-dev-session=false', '--log-level', 'warn'], {
    cwd: ROOT,
    env: { ...baseEnv, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  worker.stdout.on('data', d => workerLogs.push(String(d)));
  worker.stderr.on('data', d => workerLogs.push(String(d)));

  try {
    await Promise.all([
      waitFor(`http://127.0.0.1:${nodePort}/api/v1/health`, node, nodeLogs),
      waitFor(`http://127.0.0.1:${workerPort}/api/v1/health`, worker, workerLogs)
    ]);
  } catch (err) {
    killTree(node);
    killTree(worker);
    throw err;
  }

  return {
    dir,
    seed,
    persist,
    node: { name: 'node', base: `http://127.0.0.1:${nodePort}`, logs: nodeLogs },
    worker: { name: 'worker', base: `http://127.0.0.1:${workerPort}`, logs: workerLogs },
    d1(sql) {
      const r = spawnSync(process.execPath, [wranglerBin(), 'd1', 'execute', 'DB', '--local', '--persist-to', persist, '-c', 'wrangler.api.toml', '--command', sql, '--json'], {
        cwd: ROOT, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
      });
      if (r.status !== 0) throw new Error(r.stderr);
      return JSON.parse(r.stdout.slice(r.stdout.indexOf('[')))[0].results;
    },
    async stop() {
      killTree(node);
      killTree(worker);
      await new Promise(r => setTimeout(r, 500));
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* workerd may still hold files on Windows */ }
    }
  };
}

module.exports = { startBackends, JWT_SECRET, ROOT, freePort, waitFor, killTree, wranglerBin };
