// tests/e2e/ar-flow.e2e.js — real-browser end-to-end test of the Apple-only AR page and its website integration.
//
// Runs the real server.js and drives the locally installed Google Chrome (or Edge) through playwright-core.
//   npm run test:e2e            (CHROME_PATH=... to pick a browser binary; E2E_HEADED=1 to watch)
//
// What this can and cannot prove:
//   * Chrome is not iOS. "iPhone"/"iPad" cases emulate the user agent + touch and make WebKit's
//     relList.supports('ar') return true, then RECORD the AR Quick Look launch (anchor rel="ar", href, <img> child,
//     download attribute, fragment parameters) instead of performing it. The USDZ that would be opened is fetched
//     and validated structurally. Whether Quick Look / ARKit renders, places and tracks the car correctly can only
//     be verified on a physical iPhone/iPad (docs/AR_TEST_REPORT.md).

const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  iphoneInApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
};

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

function externalManifest(id, glbUrl, usdz = []) {
  return {
    success: true,
    data: {
      schemaVersion: 2, vehicleId: id, name: `External CDN test (${id})`,
      model: { glbUrl, scaleMode: 'fit-to-length', dimensionsMeters: { length: 4.4, width: 1.8, height: 1.4 } },
      colors: [{ index: 0, name: 'Đỏ', hex: '#DC2626' }, { index: 1, name: 'Xanh', hex: '#0284C7' }],
      variants: [], materials: { body: ['Ext_Body'] },
      appleAr: { usdz, onDeviceConversion: true },
      features: { changeColor: true, quickLook: true }
    }
  };
}

// Emulates the WebKit capability and records Quick Look launches (Chrome cannot run Quick Look).
function appleInit({ quickLook = true, touchPoints = 5 } = {}) {
  return ({ quickLook, touchPoints }) => {
    window.__qlLaunches = [];
    window.__xrCalls = 0;
    window.__gumCalls = 0;
    if (quickLook) {
      const orig = DOMTokenList.prototype.supports;
      DOMTokenList.prototype.supports = function (token) {
        if (token === 'ar') return true;
        try { return orig.call(this, token); } catch (_) { return false; }
      };
    }
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { configurable: true, get: () => touchPoints });
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.getAttribute('rel') === 'ar') {
        window.__qlLaunches.push({
          href: this.getAttribute('href'),
          download: this.getAttribute('download'),
          firstChild: this.firstElementChild ? this.firstElementChild.tagName : null,
          connected: this.isConnected,
          userActivation: navigator.userActivation ? navigator.userActivation.isActive : null
        });
        return undefined;
      }
      return origClick.call(this);
    };
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async () => { window.__gumCalls++; throw new DOMException('blocked by test', 'NotAllowedError'); };
    }
  };
}

// Android with a WebXR runtime that *claims* immersive-ar: the page must ignore it.
function androidInit() {
  return () => {
    window.__qlLaunches = [];
    window.__xrCalls = 0;
    window.__gumCalls = 0;
    Object.defineProperty(navigator, 'xr', {
      configurable: true,
      value: {
        isSessionSupported: async () => { window.__xrCalls++; return true; },
        requestSession: async () => { window.__xrCalls++; throw new Error('must not be called'); }
      }
    });
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async () => { window.__gumCalls++; throw new DOMException('blocked by test', 'NotAllowedError'); };
    }
  };
}

async function waitForAr(page, predicate = 'ready', timeout = 60000) {
  if (predicate === 'ready') {
    await page.waitForFunction(() => window.__sigmaAr && window.__sigmaAr.vehicle && window.__sigmaAr.vehicle.loadedUrl && document.getElementById('ar-root').dataset.state === 'ready', null, { timeout });
  } else if (predicate === 'ar-settled') {
    await page.waitForFunction(() => window.__sigmaAr && ['ready', 'unavailable', 'unsupported'].includes(window.__sigmaAr.ar.state), null, { timeout });
  } else {
    await page.waitForFunction(() => document.getElementById('ar-root').dataset.state === 'error', null, { timeout });
  }
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__sigmaAr || null)));
}

async function readBytes(page, url) {
  const b64 = await page.evaluate(async (u) => {
    const buf = new Uint8Array(await (await fetch(u)).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, url);
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

(async () => {
  const exe = CANDIDATES.find(p => fs.existsSync(p));
  if (!exe) {
    console.log('SKIPPED: no Chrome/Edge binary found (set CHROME_PATH).');
    process.exit(2);
  }
  const { inspectUsdz } = await import(pathToFileURL(path.join(ROOT, 'js/ar/apple/usdz-builder.js')).href);
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
  const pageErrors = [];
  const consoleErrors = [];
  const watch = (ctx) => ctx.on('page', (p) => {
    p.on('pageerror', (e) => pageErrors.push(`${p.url()} :: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${p.url()} :: ${m.text()}`); });
  });

  // Fake external CDN (cross-origin HTTPS) served through request interception in the real browser.
  const ext = externalGltf();
  const cdnHits = [];
  const cybertruckUsdz = fs.readFileSync(path.join(ROOT, 'assets/models/usdz/tesla-cybertruck/0.usdz'));
  async function routeCdn(ctx) {
    await ctx.route('https://cdn.sigma-e2e.example/**', (route) => {
      const url = new URL(route.request().url());
      cdnHits.push(url.pathname);
      const cors = { 'Access-Control-Allow-Origin': '*' };
      if (url.pathname === '/cars/car.gltf') return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'model/gltf+json' }, body: ext.json });
      if (url.pathname === '/cars/car.bin') return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/octet-stream' }, body: ext.bin });
      if (url.pathname === '/cars/red.usdz') return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'model/vnd.usdz+zip' }, body: cybertruckUsdz });
      if (url.pathname === '/cars/blue.usdz') return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'text/html' }, body: '<!DOCTYPE html><html>SPA</html>' });
      return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await ctx.route('**/api/v1/vehicles/e2e-external/ar-manifest', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(externalManifest('e2e-external', 'https://cdn.sigma-e2e.example/cars/car.gltf', [
        { colorIndex: 0, url: 'https://cdn.sigma-e2e.example/cars/red.usdz' },
        { colorIndex: 1, url: 'https://cdn.sigma-e2e.example/cars/blue.usdz' }
      ]))
    }));
    await ctx.route('**/api/v1/vehicles/e2e-nocors/ar-manifest', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(externalManifest('e2e-nocors', noCorsUrl)) }));
  }
  // Playwright interception bypasses CORS, so the CORS failure uses a genuinely cross-origin server without ACAO.
  const noCors = require('http').createServer((req, res) => res.writeHead(200, { 'Content-Type': 'model/gltf-binary' }).end(fs.readFileSync(path.join(ROOT, 'assets/models/ar/tesla_cybertruck_ar_v1.glb'))));
  await new Promise(r => noCors.listen(0, '127.0.0.1', r));
  const noCorsUrl = `http://localhost:${noCors.address().port}/nocors/car.glb`;

  async function newContext(kind) {
    const opts = {
      desktop: { viewport: { width: 1280, height: 800 } },
      iphone: { viewport: { width: 390, height: 844 }, userAgent: UA.iphone, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
      ipad: { viewport: { width: 1024, height: 1366 }, userAgent: UA.ipadDesktop, isMobile: false, hasTouch: true, deviceScaleFactor: 2 },
      iphoneInApp: { viewport: { width: 390, height: 844 }, userAgent: UA.iphoneInApp, isMobile: true, hasTouch: true },
      android: { viewport: { width: 412, height: 915 }, userAgent: UA.android, isMobile: true, hasTouch: true }
    }[kind];
    const ctx = await browser.newContext(opts);
    watch(ctx);
    await routeCdn(ctx);
    if (kind === 'iphone' || kind === 'ipad') await ctx.addInitScript(appleInit(), { quickLook: true, touchPoints: 5 });
    if (kind === 'iphoneInApp') await ctx.addInitScript(appleInit(), { quickLook: false, touchPoints: 5 });
    if (kind === 'android') await ctx.addInitScript(androidInit());
    if (kind === 'desktop') await ctx.addInitScript(appleInit(), { quickLook: false, touchPoints: 0 });
    return ctx;
  }

  const desktop = await newContext('desktop');
  const page = await desktop.newPage();
  console.log(`\n🧪 SIGMACAR Apple AR end-to-end (${path.basename(exe)}, ${base})\n`);

  await step('Detail page: select colour #2; "Xem AR" button keeps its appearance and opens /ar/:vehicleId', async () => {
    await page.goto(`${base}/#detail?carId=tesla-cybertruck&colorIdx=2`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.AppState && window.AppState.currentRoute === 'detail' && document.querySelector('[onclick*="openArLive"]'), null, { timeout: 30000 });
    const btn = page.locator('[onclick*="openArLive"]').first();
    measurements.arButton = { text: (await btn.textContent()).trim().replace(/\s+/g, ' '), className: await btn.getAttribute('class') };
    await Promise.all([page.waitForURL(/\/ar\/tesla-cybertruck\?/), btn.click()]);
    const u = new URL(page.url());
    assert.strictEqual(u.pathname, '/ar/tesla-cybertruck');
    assert.strictEqual(u.searchParams.get('color'), '2');
    assert.strictEqual(u.searchParams.get('return'), '/#detail');
    assert.strictEqual(await page.locator('#app-views, .main-header').count(), 0, 'AR page is separate from the website shell');
  });

  let st;
  await step('Desktop: loads the selected colour, shows the compatibility message + QR, never launches AR or the camera', async () => {
    st = await waitForAr(page);
    assert.match(st.vehicle.loadedUrl, /tesla_cybertruck_ar_ceramic_white\.glb$/, 'colour #2 → ceramic white variant');
    assert.ok(Math.abs(st.vehicle.sizeMeters.length - 5.682) < 0.06, 'real-world length');
    assert.strictEqual(st.support.canLaunchAr, false);
    assert.strictEqual(st.support.reason, 'DESKTOP');
    assert.strictEqual(st.ar.state, 'unsupported');
    assert.match(await page.locator('#ar-notice-text').textContent(), /AR Camera chỉ khả dụng trên iPhone\/iPad tương thích/);
    assert.strictEqual(await page.locator('#ar-qr svg path').count(), 1, 'QR code to open the page on an iPhone/iPad');
    assert.ok(!(await page.locator('#ar-launch').isVisible()), 'no AR button on desktop');
    await page.waitForTimeout(300);
    const calls = await page.evaluate(() => ({ ql: window.__qlLaunches.length, gum: window.__gumCalls }));
    assert.deepStrictEqual(calls, { ql: 0, gum: 0 });
    measurements.desktopCybertruck = { manifestMs: st.metrics.manifestMs, modelMs: st.metrics.modelMs, modelBytes: st.metrics.modelBytes };
  });

  await step('Full-screen, vehicle-first layout: canvas fills the viewport; only close, colour bar and notice are shown', async () => {
    const box = await page.locator('#ar-stage canvas').boundingBox();
    const vp = page.viewportSize();
    assert.ok(Math.abs(box.width - vp.width) <= 1 && Math.abs(box.height - vp.height) <= 1, `canvas ${box.width}x${box.height} vs ${vp.width}x${vp.height}`);
    const visibleButtons = await page.evaluate(() => Array.from(document.querySelectorAll('button, a')).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    }).map(el => el.id || el.className));
    assert.deepStrictEqual(visibleButtons.filter(x => x !== 'ar-swatch'), ['ar-close'], `unexpected controls: ${visibleButtons}`);
    assert.strictEqual(visibleButtons.filter(x => x === 'ar-swatch').length, 4);
    assert.strictEqual(await page.locator('nav, header, .ar-diagnostics, [id*="debug"]').count(), 0);
  });

  await step('Colour bar: switching colour loads that colour\'s authored GLB, persists the choice, and labels it', async () => {
    await page.locator('#ar-colors .ar-swatch').nth(3).click();
    await page.waitForFunction(() => /tactical_green/.test(window.__sigmaAr.vehicle.loadedUrl) && window.__sigmaAr.colorIdx === 3, null, { timeout: 30000 });
    const cfg = await page.evaluate(() => JSON.parse(sessionStorage.getItem('sigmacar_vehicle_configs_v1'))['tesla-cybertruck']);
    assert.strictEqual(cfg.colorIdx, 3);
    assert.strictEqual(await page.locator('#ar-colors .ar-swatch[aria-checked="true"]').count(), 1);
    assert.match(await page.locator('#ar-color-name').textContent(), /Tactical Green/);
  });

  await step('Close returns to the showroom detail page with the colour chosen in AR', async () => {
    await Promise.all([page.waitForURL(/#detail\?/), page.click('#ar-close')]);
    const u = new URL(page.url());
    assert.strictEqual(u.pathname, '/');
    assert.match(u.hash, /carId=tesla-cybertruck/);
    await page.waitForFunction(() => window.AppState && window.AppState.currentRoute === 'detail');
    const c = await page.evaluate(() => window.AppState.vehicleConfigs['tesla-cybertruck'].colorIdx);
    assert.strictEqual(c, 3);
  });

  await step('Paint tint path (no per-colour GLB): colour change re-tints body paint in place, no model reload', async () => {
    const p = await desktop.newPage();
    await p.goto(`${base}/ar/honda-civic-eg6-1991?color=0`);
    const s0 = await waitForAr(p);
    assert.strictEqual(s0.vehicle.capabilities.changeColor, true);
    const misses0 = s0.cache.misses;
    await p.locator('#ar-colors .ar-swatch').nth(3).click();
    await p.waitForFunction(() => window.__sigmaAr.colorIdx === 3);
    const s1 = await p.evaluate(() => JSON.parse(JSON.stringify(window.__sigmaAr)));
    assert.strictEqual(s1.vehicle.loadedUrl, s0.vehicle.loadedUrl, 'same model');
    assert.strictEqual(s1.cache.misses, misses0, 'no new download');
    await p.close();
  });

  const iphone = await newContext('iphone');
  await step('iPhone (Safari, rel="ar" supported): pre-built USDZ for the selected colour, launched from the tap', async () => {
    const p = await iphone.newPage();
    await p.goto(`${base}/ar/tesla-cybertruck?color=1&return=%2F%23detail`);
    const s = await waitForAr(p, 'ar-settled');
    assert.strictEqual(s.support.canLaunchAr, true);
    assert.strictEqual(s.support.device.kind, 'iphone');
    assert.strictEqual(s.ar.state, 'ready');
    assert.strictEqual(s.ar.kind, 'prebuilt');
    assert.match(s.ar.url, /\/assets\/models\/usdz\/tesla-cybertruck\/1\.usdz\?v=[0-9a-f]{12}$/);
    assert.strictEqual(s.metrics.usdz.probe.status, 'valid');
    assert.ok(await p.locator('#ar-launch').isVisible());
    assert.ok(!(await p.locator('#ar-notice').isVisible()), 'no compatibility notice on a supported iPhone');
    assert.strictEqual(await p.evaluate(() => window.__qlLaunches.length), 0, 'Quick Look is never opened without a tap');
    await p.locator('#ar-launch').tap();
    const launches = await p.evaluate(() => window.__qlLaunches);
    assert.strictEqual(launches.length, 1);
    const l = launches[0];
    assert.strictEqual(l.firstChild, 'IMG', 'WebKit requires an <img> child');
    assert.strictEqual(l.download, null, 'https USDZ needs no download attribute');
    assert.strictEqual(l.userActivation, true, 'launched inside the user gesture');
    const [file, frag] = l.href.split('#');
    assert.ok(file.endsWith(s.ar.url.replace(base, '')) || file === s.ar.url);
    const params = new URLSearchParams(frag);
    assert.strictEqual(params.get('allowsContentScaling'), '0', 'real-world scale is locked');
    assert.match(params.get('canonicalWebPageURL'), /\/ar\/tesla-cybertruck\?color=1$/);
    const bytes = await readBytes(p, s.ar.url);
    const check = inspectUsdz(bytes);
    assert.ok(check.ok, check.problems.join(','));
    assert.strictEqual(check.firstFile, 'model.usda');
    const text = Buffer.from(bytes).toString('latin1');
    assert.match(text, /metersPerUnit = 1/);
    assert.match(text, /preliminary:planeAnchoring:alignment = "horizontal"/);
    assert.strictEqual(await p.evaluate(() => window.__gumCalls), 0, 'the page never opens the camera itself');
    measurements.prebuiltUsdzBytes = bytes.length;

    // Colour change → the matching USDZ, no stale file.
    await p.locator('#ar-colors .ar-swatch').nth(3).tap();
    await p.waitForFunction(() => window.__sigmaAr.ar.state === 'ready' && window.__sigmaAr.ar.colorIdx === 3, null, { timeout: 30000 });
    assert.match(await p.evaluate(() => window.__sigmaAr.ar.url), /tesla-cybertruck\/3\.usdz/);
    await p.close();
  });

  await step('iPhone, no USDZ file: converts the shown model (selected paint) on the device and launches a blob USDZ', async () => {
    const p = await iphone.newPage();
    await p.goto(`${base}/ar/honda-civic-eg6-1991?color=3`);
    const s = await waitForAr(p, 'ar-settled', 90000);
    assert.strictEqual(s.ar.state, 'ready', JSON.stringify(s.metrics.warnings));
    assert.strictEqual(s.ar.kind, 'generated');
    assert.match(s.ar.url, /^blob:/);
    measurements.onDeviceConversion = { vehicle: 'honda-civic-eg6-1991', ms: s.metrics.usdz.report.ms, bytes: s.metrics.usdz.bytes, estimatedBytes: s.metrics.usdz.report.estimatedBytes };
    await p.locator('#ar-launch').tap();
    const l = (await p.evaluate(() => window.__qlLaunches))[0];
    assert.match(l.href, /^blob:.*#allowsContentScaling=0&canonicalWebPageURL=/);
    assert.strictEqual(l.download, 'honda-civic-eg6-1991.usdz', 'blob USDZ needs the download attribute');
    const bytes = await readBytes(p, s.ar.url);
    const check = inspectUsdz(bytes);
    assert.ok(check.ok, check.problems.join(','));
    // The selected colour must be the diffuse colour of the paint material only (USD stores linear RGB).
    const colorHex = (await (await fetch(`${base}/api/v1/vehicles/honda-civic-eg6-1991/ar-manifest`)).json()).data.colors[3].hex;
    const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const want = [1, 3, 5].map(i => toLinear(parseInt(colorHex.slice(i, i + 2), 16) / 255));
    const text = Buffer.from(bytes).toString('latin1');
    const diffuse = Array.from(text.matchAll(/color3f inputs:diffuseColor = \(([^)]*)\)/g)).map(m => m[1].split(',').map(Number));
    const painted = diffuse.filter(v => v.every((x, i) => Math.abs(x - want[i]) < 0.002));
    measurements.onDeviceConversion.paint = { hex: colorHex, linear: want.map(x => +x.toFixed(4)), materials: diffuse.length, painted: painted.length };
    assert.ok(painted.length >= 1, `selected paint ${colorHex} present in the USDZ`);
    assert.ok(painted.length < diffuse.length, 'other materials keep their own colours');

    // Switching back to an already converted colour reuses the cached file.
    const firstUrl = s.ar.url;
    await p.locator('#ar-colors .ar-swatch').nth(0).tap();
    await p.waitForFunction(() => window.__sigmaAr.ar.state === 'ready' && window.__sigmaAr.ar.colorIdx === 0, null, { timeout: 60000 });
    await p.locator('#ar-colors .ar-swatch').nth(3).tap();
    await p.waitForFunction(() => window.__sigmaAr.ar.state === 'ready' && window.__sigmaAr.ar.colorIdx === 3, null, { timeout: 60000 });
    assert.strictEqual(await p.evaluate(() => window.__sigmaAr.ar.url), firstUrl, 'cached per colour');
    await p.close();
  });

  await step('iPhone, model too detailed to convert on the device: AR disabled with the reason (no crash, no fake)', async () => {
    const p = await iphone.newPage();
    await p.goto(`${base}/ar/vinfast-vf9`);
    const s = await waitForAr(p, 'ar-settled', 90000);
    assert.strictEqual(s.ar.state, 'unavailable');
    assert.strictEqual(s.ar.error, 'MODEL_TOO_LARGE_FOR_CONVERSION');
    assert.ok(await p.locator('#ar-launch').isDisabled());
    assert.match(await p.locator('#ar-launch-note').textContent(), /cần tệp USDZ dựng sẵn/);
    await p.close();
  });

  await step('External USDZ URLs: valid CDN file is used as-is; an HTML response is rejected and conversion takes over', async () => {
    const p = await iphone.newPage();
    await p.goto(`${base}/ar/e2e-external?color=0`);
    let s = await waitForAr(p, 'ar-settled');
    assert.strictEqual(s.vehicle.loadedUrl, 'https://cdn.sigma-e2e.example/cars/car.gltf', 'external glTF + .bin loaded');
    assert.ok(cdnHits.includes('/cars/car.bin'));
    assert.strictEqual(s.ar.kind, 'external');
    assert.strictEqual(s.ar.url, 'https://cdn.sigma-e2e.example/cars/red.usdz');
    await p.locator('#ar-colors .ar-swatch').nth(1).tap();
    await p.waitForFunction(() => window.__sigmaAr.ar.state !== 'preparing' && window.__sigmaAr.ar.colorIdx === 1, null, { timeout: 30000 });
    s = await p.evaluate(() => JSON.parse(JSON.stringify(window.__sigmaAr)));
    assert.strictEqual(s.ar.kind, 'generated');
    assert.ok(s.metrics.warnings.some(w => /USDZ_INVALID: .*blue\.usdz \(HTML_INSTEAD_OF_USDZ\)/.test(w)));
    await p.close();
  });

  await step('iPad (iPadOS desktop-class user agent, touch) is detected as Apple AR capable', async () => {
    const ctx = await newContext('ipad');
    const p = await ctx.newPage();
    await p.goto(`${base}/ar/tesla-cybertruck`);
    const s = await waitForAr(p, 'ar-settled');
    assert.strictEqual(s.support.device.kind, 'ipad');
    assert.strictEqual(s.support.canLaunchAr, true);
    assert.strictEqual(s.ar.state, 'ready');
    await ctx.close();
  });

  await step('iPhone in-app browser without rel="ar": no launch, asks to open in Safari', async () => {
    const ctx = await newContext('iphoneInApp');
    const p = await ctx.newPage();
    await p.goto(`${base}/ar/tesla-cybertruck`);
    const s = await waitForAr(p, 'ar-settled');
    assert.strictEqual(s.support.reason, 'APPLE_NO_QUICK_LOOK');
    assert.ok(!(await p.locator('#ar-launch').isVisible()));
    assert.match(await p.locator('#ar-notice-text').textContent(), /Safari/);
    await ctx.close();
  });

  await step('Android (even with a WebXR runtime claiming immersive-ar): no ARCore/WebXR/Scene Viewer, simple message', async () => {
    const ctx = await newContext('android');
    const p = await ctx.newPage();
    const navigations = [];
    p.on('framenavigated', (f) => { if (f === p.mainFrame()) navigations.push(f.url()); });
    await p.goto(`${base}/ar/tesla-cybertruck`);
    const s = await waitForAr(p, 'ar-settled');
    assert.strictEqual(s.support.reason, 'ANDROID');
    assert.strictEqual(s.ar.state, 'unsupported');
    assert.strictEqual(await p.locator('#ar-notice-text').textContent(), 'AR Camera chỉ khả dụng trên iPhone/iPad tương thích.');
    assert.ok(!(await p.locator('#ar-launch').isVisible()));
    assert.ok(!(await p.locator('#ar-qr-wrap').isVisible()), 'no QR on a phone');
    await p.locator('#ar-colors .ar-swatch').nth(1).tap();
    await p.waitForFunction(() => window.__sigmaAr.colorIdx === 1, null, { timeout: 30000 });
    const calls = await p.evaluate(() => ({ xr: window.__xrCalls, gum: window.__gumCalls, ql: window.__qlLaunches.length }));
    assert.deepStrictEqual(calls, { xr: 0, gum: 0, ql: 0 });
    assert.ok(navigations.every(u => !u.startsWith('intent:')), 'no Scene Viewer intent');
    await ctx.close();
  });

  await step('Model loading errors: host without CORS, invalid id and unknown vehicle fail with explicit states', async () => {
    const p = await desktop.newPage();
    await p.goto(`${base}/ar/e2e-nocors`);
    let s = await waitForAr(p, 'error');
    assert.strictEqual(s.metrics.error, 'NETWORK_OR_CORS');
    assert.ok(await p.locator('#ar-retry').isVisible());
    await p.goto(`${base}/ar/BAD%20ID!`);
    await waitForAr(p, 'error');
    assert.match(await p.locator('#ar-status-detail').textContent(), /INVALID_VEHICLE_ID/);
    await p.goto(`${base}/ar/no-such-car`);
    await waitForAr(p, 'error');
    assert.match(await p.locator('#ar-status-detail').textContent(), /NOT_FOUND/);
    await p.close();
  });

  await step('3D showroom: AR mode button opens the dedicated AR page; viewer refuses WebXR immersive-ar', async () => {
    const p = await desktop.newPage();
    await p.addInitScript(() => {
      window.__xrRequests = 0;
      Object.defineProperty(navigator, 'xr', {
        configurable: true,
        value: { isSessionSupported: async () => true, requestSession: async () => { window.__xrRequests++; throw new Error('no'); } }
      });
    });
    await p.goto(`${base}/#vr-ar?carId=tesla-cybertruck`);
    await p.waitForFunction(() => window.AppState.currentRoute === 'vr-ar' && window._activeCar3DViewer, null, { timeout: 30000 });
    const res = await p.evaluate(async () => {
      const r = await window._activeCar3DViewer.enterWebXR({ ar: true });
      const c = await window._activeCar3DViewer.checkWebXRSupport();
      return { r, c, xr: window.__xrRequests };
    });
    assert.strictEqual(res.r.mode, 'apple-quick-look-only');
    assert.strictEqual(res.c.supported, false);
    assert.strictEqual(res.xr, 0);
    await Promise.all([p.waitForURL(/\/ar\/tesla-cybertruck/), p.click('#btn-mode-ar')]);
    await p.close();
  });

  await step('Legacy #ar-live links redirect to the dedicated AR page', async () => {
    const p = await desktop.newPage();
    await p.goto(`${base}/#ar-live?carId=tesla-cybertruck`);
    await p.waitForURL(/\/ar\/tesla-cybertruck/, { timeout: 30000 });
    await p.close();
  });

  await step('Regression: home, 3D showroom (#vr-ar), 360°/VR controls and cart still render', async () => {
    const p = await desktop.newPage();
    await p.goto(`${base}/#home`);
    await p.waitForFunction(() => window.AppState && window.AppState.currentRoute === 'home');
    await p.goto(`${base}/#vr-ar?carId=tesla-cybertruck`);
    await p.waitForFunction(() => window.AppState.currentRoute === 'vr-ar' && document.querySelector('#app-views canvas, canvas'), null, { timeout: 30000 });
    assert.ok(await p.locator('#btn-mode-360').count() === 1 && await p.locator('#btn-vr-hud-webxr').count() === 1);
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
