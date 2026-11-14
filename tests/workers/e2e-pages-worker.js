// tests/workers/e2e-pages-worker.js — npm run test:e2e:workers
// Browser E2E through the target production path, locally:
//   Chrome → wrangler pages dev dist (static site + functions/api/v1/[[path]].js)
//          → service binding SIGMA_API → wrangler dev -c wrangler.api.toml (Worker, workerd) → local D1
// Runs `npm run build` first, then tests/e2e/ar-flow.e2e.js with E2E_BASE_URL. Nothing is deployed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

function wranglerBin() {
  const pkgDir = path.dirname(require.resolve('wrangler/package.json', { paths: [ROOT] }));
  return path.join(pkgDir, require(path.join(pkgDir, 'package.json')).bin.wrangler);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function waitFor(url, child, logs, okStatus = (s) => s === 200) {
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) throw new Error(`exited ${child.exitCode}:\n${logs.join('').slice(-3000)}`);
    try {
      const r = await fetch(url);
      if (okStatus(r.status)) return r;
    } catch (_) { /* starting */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`timeout: ${url}\n${logs.join('').slice(-3000)}`);
}

async function main() {
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' };
  const build = spawnSync(process.execPath, ['scripts/build_dist.js'], { cwd: ROOT, stdio: 'inherit' });
  if (build.status !== 0) throw new Error('npm run build failed');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigmacar-pages-worker-'));
  const persistWorker = path.join(dir, 'worker');
  const mig = spawnSync(process.execPath, [wranglerBin(), 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistWorker, '-c', 'wrangler.api.toml'], { cwd: ROOT, env, encoding: 'utf8' });
  if (mig.status !== 0) throw new Error(`migrations failed: ${mig.stderr}`);

  const [workerPort, pagesPort] = await Promise.all([freePort(), freePort()]);
  const wLogs = [];
  const pLogs = [];
  // --node-backend: same Pages dev server, but the previous architecture behind it (HTTP proxy → node server.js).
  // Used as the control run to tell Worker effects from `wrangler pages dev` effects.
  const nodeBackend = process.argv.includes('--node-backend');
  const worker = nodeBackend
    ? spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(workerPort), NODE_ENV: 'development', SIGMACAR_DATA_FILE: path.join(dir, 'node-store.json'), RATE_LIMIT_MAX_REQUESTS_PER_MINUTE: '5000' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    : spawn(process.execPath, [wranglerBin(), 'dev', '-c', 'wrangler.api.toml', '--ip', '127.0.0.1', '--port', String(workerPort), '--persist-to', persistWorker,
      '--var', 'JWT_SECRET:sigmacar-e2e-pages-worker-secret-0123456789abcdef', '--var', 'RATE_LIMIT_MAX_REQUESTS_PER_MINUTE:5000', '--show-interactive-dev-session=false'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', d => wLogs.push(String(d)));
  worker.stderr.on('data', d => wLogs.push(String(d)));
  let pages = null;
  try {
    await waitFor(`http://127.0.0.1:${workerPort}/api/v1/health`, worker, wLogs);
    const upstream = nodeBackend
      ? ['--binding', `SIGMA_BACKEND_ORIGIN=http://127.0.0.1:${workerPort}`, '--binding', 'SIGMA_BACKEND_ALLOW_HTTP=true']
      : ['--service', 'SIGMA_API=sigmacar-api'];
    pages = spawn(process.execPath, [wranglerBin(), 'pages', 'dev', 'dist', '--ip', '127.0.0.1', '--port', String(pagesPort), '--persist-to', path.join(dir, 'pages'),
      ...upstream, '--compatibility-date', '2026-10-01', '--show-interactive-dev-session=false'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    pages.stdout.on('data', d => pLogs.push(String(d)));
    pages.stderr.on('data', d => pLogs.push(String(d)));
    const health = await waitFor(`http://127.0.0.1:${pagesPort}/api/v1/health`, pages, pLogs);
    const body = await health.json();
    if (!body.data || body.data.storageMode !== (nodeBackend ? 'json' : 'd1') || health.headers.get('x-sigma-proxy') !== '1') {
      throw new Error(`/api/v1/health on Pages did not come from the expected backend: ${JSON.stringify(body)}`);
    }
    console.log(`Pages (${pagesPort}) → ${nodeBackend ? 'HTTP proxy → node server.js' : 'SIGMA_API binding → Worker → local D1'} (${workerPort}): ready`);

    if (process.argv.includes('--probe')) {
      // Timing probe of the local stack (no browser): API through the binding vs static files from wrangler pages dev.
      const base = `http://127.0.0.1:${pagesPort}`;
      const time = async (label, url, n = 1) => {
        const t = [];
        let bytes = 0;
        for (let i = 0; i < n; i++) {
          const s = Date.now();
          const r = await fetch(base + url);
          bytes = (await r.arrayBuffer()).byteLength;
          t.push(Date.now() - s);
          if (r.status >= 400) throw new Error(`${url} → ${r.status}`);
        }
        console.log(`${label.padEnd(44)} ${String(bytes).padStart(9)} B  ${t.join(' / ')} ms`);
      };
      await time('API health (Pages → binding → Worker)', '/api/v1/health', 5);
      await time('API vehicles list', '/api/v1/vehicles', 3);
      await time('API AR manifest cybertruck', '/api/v1/vehicles/tesla-cybertruck/ar-manifest', 3);
      await time('static /ar/tesla-cybertruck', '/ar/tesla-cybertruck', 3);
      await time('static GLB vinfast_vf9.glb', '/assets/models/vinfast_vf9.glb', 3);
      await time('static USDZ cybertruck 0.usdz', '/assets/models/usdz/tesla-cybertruck/0.usdz', 3);
      const s = Date.now();
      await Promise.all(Array.from({ length: 8 }, () => fetch(`${base}/assets/models/vinfast_vf9.glb`).then(r => r.arrayBuffer())));
      console.log(`8 parallel GLB downloads: ${Date.now() - s} ms`);
      return 0;
    }

    const e2e = spawnSync(process.execPath, ['tests/e2e/ar-flow.e2e.js'], {
      cwd: ROOT, stdio: 'inherit', env: { ...process.env, E2E_BASE_URL: `http://127.0.0.1:${pagesPort}` }
    });
    return e2e.status === null ? 1 : e2e.status;
  } finally {
    if (process.env.E2E_STACK_LOGS) {
      fs.writeFileSync(path.join(process.env.E2E_STACK_LOGS, 'pages.log'), pLogs.join(''));
      fs.writeFileSync(path.join(process.env.E2E_STACK_LOGS, 'worker.log'), wLogs.join(''));
    }
    killTree(pages);
    killTree(worker);
    await new Promise(r => setTimeout(r, 500));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* files may still be locked on Windows */ }
  }
}

main().then(code => { process.exitCode = code; }, err => { console.error(err.message); process.exitCode = 1; });
