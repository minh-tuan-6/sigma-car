// tests/e2e/ar-flow.e2e.js — real-browser end-to-end test of the AR page and its website integration.
//
// Runs the real server.js and drives the locally installed Google Chrome (or Edge) through playwright-core.
//   npm run test:e2e            (CHROME_PATH=... to pick a browser binary; E2E_HEADED=1 to watch)
//
// What this can and cannot prove:
//   * Desktop Chrome has no spatially tracked WebXR AR, so the correct behaviour here is the explicit 3D-preview
//     fallback. Real camera AR / hit-test / placement must be validated on a physical ARCore device
//     (see docs/AR_TEST_REPORT.md). The "WebXR wiring" case below mocks navigator.xr ONLY to verify that the page
//     requests the right session and handles a permission denial — it does not claim AR works.

const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

const results = [];
const measurements = {};
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✅ ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: String(err && err.stack || err) });
    console.log(`  ❌ ${name}\n     ${String(err && err.message || err).split('\n')[0]}`);
  }
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// glTF with a separate .bin and a texture that does not exist (missing-texture handling).
function externalGltf() {
  const pos = new Float32Array([-0.9, 0, -2.2, 0.9, 0, -2.2, 0.9, 1.4, 2.2, -0.9, 0, -2.2, 0.9, 1.4, 2.2, -0.9, 1.4, 2.2]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(uv.buffer)]);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Body' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ name: 'Ext_Body', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }], images: [{ uri: 'textures/missing.png' }],
    buffers: [{ uri: 'car.bin', byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 72 }, { buffer: 0, byteOffset: 72, byteLength: 48 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 6, type: 'VEC3', min: [-0.9, 0, -2.2], max: [0.9, 1.4, 2.2] },
      { bufferView: 1, componentType: 5126, count: 6, type: 'VEC2' }
    ]
  };
  return { json: JSON.stringify(json), bin };
}

function externalManifest(id, glbUrl) {
  return {
    success: true,
    data: {
      schemaVersion: 1, vehicleId: id, name: `External CDN test (${id})`,
      model: { glbUrl, scaleMode: 'fit-to-length', dimensionsMeters: { length: 4.4, width: 1.8, height: 1.4 } },
      colors: [{ index: 0, name: 'Đỏ', hex: '#DC2626' }, { index: 1, name: 'Xanh', hex: '#0284C7' }],
      variants: [], wheels: [], materials: { body: ['Ext_Body'], rims: [] }, animations: {}, hotspots: [],
      features: { changeColor: true, changeWheels: false, doorAnimations: false, hotspots: false }
    }
  };
}

async function waitForAr(page, predicate = 'ready', timeout = 60000) {
  if (predicate === 'ready') {
    await page.waitForFunction(() => window.__sigmaAr && window.__sigmaAr.vehicle && window.__sigmaAr.vehicle.loadedUrl && document.getElementById('ar-root').dataset.state === 'ready', null, { timeout });
  } else {
    await page.waitForFunction(() => document.getElementById('ar-root').dataset.state === 'error', null, { timeout });
  }
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__sigmaAr || null)));
}

(async () => {
  const exe = CANDIDATES.find(p => fs.existsSync(p));
  if (!exe) {
    console.log('SKIPPED: no Chrome/Edge binary found (set CHROME_PATH).');
    process.exit(2);
  }
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sigmacar-e2e-'));
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development', SIGMACAR_DATA_FILE: path.join(tmp, 'store.json'), RATE_LIMIT_MAX_REQUESTS_PER_MINUTE: '5000' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/api/v1/health`)).ok) break; } catch (_) {}
    await new Promise(r => setTimeout(r, 100));
  }

  const browser = await chromium.launch({
    executablePath: exe,
    headless: !process.env.E2E_HEADED,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const pageErrors = [];
  const consoleErrors = [];
  context.on('page', (p) => {
    p.on('pageerror', (e) => pageErrors.push(`${p.url()} :: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${p.url()} :: ${m.text()}`); });
  });

  // Fake external CDN (cross-origin HTTPS) served through request interception in the real browser.
  const ext = externalGltf();
  const cdnHits = [];
  await context.route('https://cdn.sigma-e2e.example/**', (route) => {
    const url = new URL(route.request().url());
    cdnHits.push(url.pathname);
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (url.pathname === '/cars/car.gltf') return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'model/gltf+json' }, body: ext.json });
    if (url.pathname === '/cars/car.bin') return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/octet-stream' }, body: ext.bin });
    return route.fulfill({ status: 404, headers: cors, body: '' });
  });
  await context.route('**/api/v1/vehicles/e2e-external/ar-manifest', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(externalManifest('e2e-external', 'https://cdn.sigma-e2e.example/cars/car.gltf')) }));
  // Playwright interception bypasses CORS, so the CORS failure uses a genuinely cross-origin server without ACAO.
  const noCors = require('http').createServer((req, res) => res.writeHead(200, { 'Content-Type': 'model/gltf-binary' }).end(fs.readFileSync(path.join(ROOT, 'assets/models/ar/tesla_cybertruck_ar_v1.glb'))));
  await new Promise(r => noCors.listen(0, '127.0.0.1', r));
  const noCorsUrl = `http://localhost:${noCors.address().port}/nocors/car.glb`;
  await context.route('**/api/v1/vehicles/e2e-nocors/ar-manifest', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(externalManifest('e2e-nocors', noCorsUrl)) }));

  const page = await context.newPage();
  console.log(`\n🧪 SIGMACAR AR end-to-end (${path.basename(exe)}, ${base})\n`);

  await step('1-3. Open vehicle detail and select a configuration (colour #2) through the site router', async () => {
    await page.goto(`${base}/#detail?carId=tesla-cybertruck&colorIdx=2`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.AppState && window.AppState.currentRoute === 'detail' && document.querySelector('[onclick*="openArLive"]'), null, { timeout: 30000 });
    const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('sigmacar_vehicle_configs_v1') || '{}')['tesla-cybertruck']);
    assert.strictEqual(saved && saved.colorIdx, 2, 'configuration must be persisted for the AR page');
  });

  let arState;
  await step('4-5. "Xem AR" opens the dedicated full-screen route /ar/:vehicleId with the configuration', async () => {
    await Promise.all([page.waitForURL(/\/ar\/tesla-cybertruck\?/), page.locator('[onclick*="openArLive"]').first().click()]);
    const u = new URL(page.url());
    assert.strictEqual(u.pathname, '/ar/tesla-cybertruck');
    assert.strictEqual(u.searchParams.get('color'), '2');
    assert.strictEqual(u.searchParams.get('return'), '/#detail');
    assert.strictEqual(await page.locator('#ar-root').count(), 1);
    assert.strictEqual(await page.locator('#app-views, .main-header').count(), 0, 'AR page is separate from the showroom shell');
  });

  await step('6. Loads the model (colour-variant GLB) with progress, real-world size and capabilities', async () => {
    arState = await waitForAr(page);
    assert.match(arState.vehicle.loadedUrl, /tesla_cybertruck_ar_ceramic_white\.glb$/, 'colour #2 → ceramic white variant');
    assert.ok(Math.abs(arState.vehicle.sizeMeters.length - 5.682) < 0.06);
    assert.strictEqual(arState.vehicle.capabilities.changeColor, true);
    assert.strictEqual(arState.vehicle.capabilities.changeWheels, true);
    assert.strictEqual(arState.vehicle.capabilities.doorAnimations, false);
    assert.strictEqual(arState.manifestSource, 'api');
    measurements.cybertruck = { capabilityMs: arState.metrics.capabilityMs, manifestMs: arState.metrics.manifestMs, modelMs: arState.metrics.modelMs, modelBytes: arState.metrics.modelBytes };
  });

  await step('7(desktop). No WebXR AR on desktop → explicit 3D preview, never presented as AR; QR hand-off rendered', async () => {
    assert.strictEqual(arState.experience.mode, 'preview-3d');
    assert.strictEqual(arState.experience.reason, 'DESKTOP');
    assert.strictEqual(await page.locator('#ar-mode-badge').textContent(), 'Xem 3D (không phải AR)');
    assert.ok(await page.locator('#ar-fallback').isVisible());
    assert.match(await page.locator('#ar-fallback-text').textContent(), /không thể chạy AR thật/);
    assert.ok(await page.locator('#ar-qr svg path').count() === 1, 'QR code rendered');
    assert.ok(!(await page.locator('#ar-primary').isVisible()), 'no "start AR" button where AR is impossible');
    const camPerm = await page.evaluate(() => navigator.permissions.query({ name: 'camera' }).then(p => p.state).catch(() => 'n/a'));
    assert.notStrictEqual(camPerm, 'granted', 'camera must not be requested on load');
  });

  await step('10a. Configure in AR page: colour swap (variant GLB), wheel finish, hotspot info, component pick', async () => {
    await page.click('#ar-btn-config');
    await page.locator('#ar-colors .ar-swatch').nth(3).click();
    await page.waitForFunction(() => /tactical_green/.test(window.__sigmaAr.vehicle.loadedUrl), null, { timeout: 30000 });
    await page.locator('#ar-wheels .ar-chip').nth(2).click();
    const cfg = await page.evaluate(() => JSON.parse(sessionStorage.getItem('sigmacar_vehicle_configs_v1'))['tesla-cybertruck']);
    assert.strictEqual(cfg.colorIdx, 3);
    assert.strictEqual(cfg.wheelId, 'wheel-22-forged');
    assert.match(await page.locator('#ar-config-summary').textContent(), /Mâm: 22" Forged/);
    await page.click('#ar-btn-config');

    const hs = page.locator('.ar-hotspot');
    assert.ok(await hs.count() > 0);
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.ar-hotspot')).some(b => b.style.opacity === '1'));
    await page.evaluate(() => Array.from(document.querySelectorAll('.ar-hotspot')).find(b => b.style.opacity === '1').click());
    assert.ok(await page.locator('#ar-info').isVisible());
    assert.ok((await page.locator('#ar-info-title').textContent()).length > 0);
    await page.click('#ar-info-close');

    // Tap the centre of the car → raycast component selection
    const box = await page.locator('#ar-stage canvas').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.5);
    await page.waitForTimeout(200);
    const info = await page.locator('#ar-info').isVisible();
    measurements.componentPickHit = info;
  });

  await step('10b. Screenshot in preview mode produces a downloadable JPEG', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#ar-btn-capture')]);
    const file = await dl.path();
    const head = fs.readFileSync(file).subarray(0, 3);
    assert.deepStrictEqual(Array.from(head), [0xff, 0xd8, 0xff], 'JPEG magic');
    measurements.screenshotBytes = fs.statSync(file).size;
  });

  await step('Performance sample (desktop, SwiftShader software GL — not representative of phones)', async () => {
    await page.waitForTimeout(4500);
    const s = await page.evaluate(() => JSON.parse(JSON.stringify(window.__sigmaAr.metrics)));
    measurements.previewFps = s.fps;
    measurements.cacheBytes = await page.evaluate(() => window.__sigmaAr.cache.bytes);
  });

  await step('11-12. Exit returns to the showroom page with configuration preserved', async () => {
    await Promise.all([page.waitForURL(/#detail\?/), page.click('#ar-back')]);
    const u = new URL(page.url());
    assert.strictEqual(u.pathname, '/');
    assert.match(u.hash, /carId=tesla-cybertruck/);
    // The site router normalises the hash to detail?carId=…; the configuration itself must be restored:
    await page.waitForFunction(() => window.AppState && window.AppState.currentRoute === 'detail');
    const appCfg = await page.evaluate(() => {
      const c = window.AppState.vehicleConfigs['tesla-cybertruck'];
      return c && { colorIdx: c.colorIdx, wheelId: c.wheelId };
    });
    assert.deepStrictEqual(appCfg, { colorIdx: 3, wheelId: 'wheel-22-forged' });
  });

  await step('Draco-compressed GLB with textures decodes in the browser (vinfast-vf9)', async () => {
    const p = await context.newPage();
    await p.goto(`${base}/ar/vinfast-vf9`);
    const st = await waitForAr(p);
    assert.match(st.vehicle.loadedUrl, /vinfast_vf9\.glb$/);
    assert.ok(st.vehicle.sizeMeters.length > 4 && st.vehicle.sizeMeters.length < 6);
    measurements.vf9 = { modelMs: st.metrics.modelMs, modelBytes: st.metrics.modelBytes };
    await p.close();
  });

  await step('External HTTPS CDN .gltf (+ .bin, CORS) loads; missing texture is reported, not fatal', async () => {
    const p = await context.newPage();
    await p.goto(`${base}/ar/e2e-external`);
    const st = await waitForAr(p);
    assert.strictEqual(st.vehicle.loadedUrl, 'https://cdn.sigma-e2e.example/cars/car.gltf');
    assert.ok(cdnHits.includes('/cars/car.bin'));
    assert.ok(Math.abs(st.vehicle.sizeMeters.length - 4.4) < 0.01, 'fit-to-length');
    assert.ok(st.metrics.warnings.some(w => /MISSING_RESOURCE|textures\/missing\.png/.test(w)) || cdnHits.includes('/cars/textures/missing.png'));
    assert.strictEqual(st.vehicle.capabilities.changeColor, true);
    await p.close();
  });

  await step('Model host without CORS → explicit NETWORK_OR_CORS error state with retry', async () => {
    const p = await context.newPage();
    await p.goto(`${base}/ar/e2e-nocors`);
    const st = await waitForAr(p, 'error');
    assert.strictEqual(st.metrics.error, 'NETWORK_OR_CORS');
    assert.ok(await p.locator('#ar-retry').isVisible());
    await p.close();
  });

  await step('Invalid and unknown vehicles fail safely', async () => {
    const p = await context.newPage();
    await p.goto(`${base}/ar/BAD%20ID!`);
    await waitForAr(p, 'error');
    assert.match(await p.locator('#ar-status-detail').textContent(), /INVALID_VEHICLE_ID/);
    await p.goto(`${base}/ar/no-such-car`);
    await waitForAr(p, 'error');
    assert.match(await p.locator('#ar-status-detail').textContent(), /NOT_FOUND/);
    await p.close();
  });

  await step('WebXR wiring (mocked navigator.xr): requests immersive-ar + hit-test on user gesture; handles denial', async () => {
    const p = await context.newPage();
    await p.addInitScript(() => {
      window.__xrRequests = [];
      Object.defineProperty(navigator, 'xr', {
        configurable: true,
        value: {
          isSessionSupported: async (mode) => mode === 'immersive-ar',
          requestSession: async (mode, init) => {
            window.__xrRequests.push({ mode, init: { requiredFeatures: init.requiredFeatures, optionalFeatures: init.optionalFeatures, hasDomOverlay: Boolean(init.domOverlay) } });
            throw new DOMException('Permission denied', 'NotAllowedError');
          }
        }
      });
    });
    await p.goto(`${base}/ar/tesla-cybertruck`);
    const st = await waitForAr(p);
    assert.strictEqual(st.experience.mode, 'webxr');
    assert.strictEqual(await p.evaluate(() => window.__xrRequests.length), 0, 'no XR/camera request before a user gesture');
    assert.match(await p.locator('#ar-primary').textContent(), /Bắt đầu AR/);
    await p.click('#ar-primary');
    await p.waitForFunction(() => window.__xrRequests.length === 1);
    const req = await p.evaluate(() => window.__xrRequests[0]);
    assert.strictEqual(req.mode, 'immersive-ar');
    assert.deepStrictEqual(req.init.requiredFeatures, ['hit-test']);
    assert.ok(req.init.optionalFeatures.includes('dom-overlay') && req.init.hasDomOverlay);
    await p.waitForFunction(() => document.getElementById('ar-status-title').textContent === 'Không mở được AR');
    assert.match(await p.locator('#ar-status-detail').textContent(), /Quyền camera/);
    assert.match(await p.locator('#ar-primary').textContent(), /Bắt đầu AR/, 'user can retry');
    await p.close();
  });

  await step('Legacy #ar-live links redirect to the dedicated AR page', async () => {
    const p = await context.newPage();
    await p.goto(`${base}/#ar-live?carId=tesla-cybertruck`);
    await p.waitForURL(/\/ar\/tesla-cybertruck/, { timeout: 30000 });
    await p.close();
  });

  await step('Regression: home, 3D showroom (#vr-ar) and cart still render', async () => {
    const p = await context.newPage();
    await p.goto(`${base}/#home`);
    await p.waitForFunction(() => window.AppState && window.AppState.currentRoute === 'home');
    await p.goto(`${base}/#vr-ar?carId=tesla-cybertruck`);
    await p.waitForFunction(() => window.AppState.currentRoute === 'vr-ar' && document.querySelector('#app-views canvas, canvas'), null, { timeout: 30000 });
    await p.goto(`${base}/#cart`);
    await p.waitForFunction(() => window.AppState.currentRoute === 'cart');
    await p.close();
  });

  await step('No uncaught page errors during the run', async () => {
    assert.deepStrictEqual(pageErrors, []);
  });

  await browser.close();
  noCors.close();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });

  const passed = results.filter(r => r.ok).length;
  const report = { browser: path.basename(exe), ranAt: new Date().toISOString(), passed, total: results.length, results, measurements, consoleErrors: consoleErrors.slice(0, 30) };
  fs.writeFileSync(path.join(os.tmpdir(), 'sigmacar-ar-e2e-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nE2E: ${passed}/${results.length} passed`);
  console.log('Measurements:', JSON.stringify(measurements));
  if (consoleErrors.length) console.log(`Console errors (${consoleErrors.length}):\n  ` + consoleErrors.slice(0, 10).join('\n  '));
  process.exit(passed === results.length ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
