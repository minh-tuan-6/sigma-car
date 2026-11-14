// Unit tests for the Apple-only AR engine (js/ar/**). Browser ES modules are imported dynamically; `three`
// resolves to the same pinned version that is vendored for the browser (node_modules/three@0.170.0).
// AR Quick Look / ARKit behaviour itself cannot run here; see tests/e2e/ar-flow.e2e.js and docs/AR_TEST_REPORT.md.

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

describe('AR: showroom entry point', () => {
  it('opens the dedicated AR page for the displayed car even when the preview viewer is unavailable', () => {
    const source = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    const start = source.indexOf("    document.getElementById('btn-mode-ar')?.addEventListener");
    const end = source.indexOf("    document.getElementById('btn-vr-hud-webxr')", start);
    assert.ok(start >= 0 && end > start);
    for (const hasViewer of [true, false]) {
      const calls = [];
      let click;
      require('node:vm').runInNewContext(source.slice(start, end), {
        document: { getElementById: () => ({ addEventListener: (type, fn) => { click = fn; } }) },
        viewer: hasViewer ? { stopCamera: () => calls.push('stop') } : null,
        car: { id: 'tesla-cybertruck' },
        window: { openArLive: (id) => calls.push(id) }
      });
      click();
      assert.deepStrictEqual(calls, hasViewer ? ['stop', 'tesla-cybertruck'] : ['tesla-cybertruck']);
    }
  });
});

let THREE, urlPolicy, fetchMod, AssetCache, validator, normalizeVehicle, MaterialConfigurator, VehicleController,
  appleSupport, quickLook, usdzBuilder, UsdzResolver, manifestSchema, manifestClient, configSync, tracker, GLTFLoader;

before(async () => {
  THREE = await import('three');
  ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
  urlPolicy = await mod('js/ar/models/url-policy.js');
  fetchMod = await mod('js/ar/models/fetch-with-progress.js');
  ({ AssetCache } = await mod('js/ar/models/asset-cache.js'));
  validator = await mod('js/ar/models/model-validator.js');
  ({ normalizeVehicle } = await mod('js/ar/models/model-normalizer.js'));
  ({ MaterialConfigurator } = await mod('js/ar/vehicle/material-configurator.js'));
  ({ VehicleController } = await mod('js/ar/vehicle/vehicle-controller.js'));
  appleSupport = await mod('js/ar/apple/apple-ar-support.js');
  quickLook = await mod('js/ar/apple/quick-look.js');
  usdzBuilder = await mod('js/ar/apple/usdz-builder.js');
  ({ UsdzResolver } = await mod('js/ar/apple/usdz-resolver.js'));
  manifestSchema = await mod('js/ar/manifest/manifest-schema.js');
  manifestClient = await mod('js/ar/manifest/manifest-client.js');
  configSync = await mod('js/ar/config/config-sync.js');
  tracker = await mod('js/ar/core/resource-tracker.js');
});

// ---------------------------------------------------------------- helpers
const BASE = 'https://sigma-car.pages.dev/ar/tesla-cybertruck';
function mockResponse({ status = 200, body = new Uint8Array(0), type = 'model/gltf-binary', length, chunks } = {}) {
  const parts = chunks || [body];
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  let i = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => ({ 'content-type': type, 'content-length': String(length ?? total) })[n.toLowerCase()] ?? null },
    body: { getReader: () => ({ read: async () => (i < parts.length ? { done: false, value: parts[i++] } : { done: true }), cancel: async () => {} }) },
    arrayBuffer: async () => body.buffer
  };
}
function vehicleBox({ x, y, z }, materialName = 'Body_Paint') {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), new THREE.MeshStandardMaterial({ name: materialName }));
  const root = new THREE.Group();
  root.add(mesh);
  return root;
}

// ---------------------------------------------------------------- URL policy
describe('AR: model URL policy', () => {
  it('accepts external HTTPS and same-origin model URLs; resolves relative paths', () => {
    const ext = urlPolicy.validateModelUrl('https://cdn.example.com/cars/cybertruck.glb', { baseUrl: BASE });
    assert.deepStrictEqual([ext.ok, ext.kind, ext.crossOrigin], [true, 'glb', true]);
    const rel = urlPolicy.validateModelUrl('assets/models/ar/tesla_cybertruck_ar_v1.glb', { baseUrl: 'https://sigma-car.pages.dev/' });
    assert.strictEqual(rel.url, 'https://sigma-car.pages.dev/assets/models/ar/tesla_cybertruck_ar_v1.glb');
    assert.strictEqual(rel.crossOrigin, false);
    assert.strictEqual(urlPolicy.validateModelUrl('https://storage.example.com/models/car.gltf?v=2').kind, 'gltf');
    assert.ok(urlPolicy.validateModelUrl('http://localhost:3000/x.glb').ok, 'dev loopback allowed');
  });

  it('rejects unsafe or unsupported URLs', () => {
    const reasons = {
      'javascript:alert(1)//x.glb': 'INSECURE_OR_UNSUPPORTED_PROTOCOL',
      'http://cdn.example.com/car.glb': 'INSECURE_OR_UNSUPPORTED_PROTOCOL',
      'https://cdn.example.com/car.obj': 'UNSUPPORTED_EXTENSION',
      'https://user:pw@cdn.example.com/car.glb': 'CREDENTIALS_IN_URL',
      '//evil.example/car.glb': 'PROTOCOL_RELATIVE_URL',
      '': 'EMPTY_URL'
    };
    for (const [u, reason] of Object.entries(reasons)) {
      assert.strictEqual(urlPolicy.validateModelUrl(u, { baseUrl: BASE }).reason, reason, u);
    }
    assert.strictEqual(urlPolicy.validateModelUrl('https://other.example/car.glb', { baseUrl: BASE, allowedHosts: ['cdn.example.com'] }).reason, 'HOST_NOT_ALLOWED');
  });

  it('guards resources referenced inside glTF files', () => {
    const base = 'https://cdn.example.com/cars/';
    assert.ok(urlPolicy.isAllowedResourceUrl('blob:https://sigma-car.pages.dev/abc', { baseUrl: base }));
    assert.ok(urlPolicy.isAllowedResourceUrl('car.bin', { baseUrl: base }));
    assert.ok(urlPolicy.isAllowedResourceUrl('data:application/octet-stream;base64,AAAA', { baseUrl: base }));
    assert.ok(!urlPolicy.isAllowedResourceUrl('data:text/html;base64,PHNjcmlwdD4=', { baseUrl: base }));
    assert.ok(!urlPolicy.isAllowedResourceUrl('http://insecure.example/t.png', { baseUrl: base }));
    assert.strictEqual(urlPolicy.resourceBaseOf('https://cdn.example.com/cars/x/car.gltf?sig=1'), 'https://cdn.example.com/cars/x/');
  });
});

// ---------------------------------------------------------------- download + cache
describe('AR: model download (progress, retry, timeout, cancel) and cache', () => {
  it('streams with progress events and returns the exact bytes', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    const progress = [];
    const buf = await fetchMod.fetchArrayBuffer('https://cdn.x/car.glb', { fetchImpl: async () => mockResponse({ chunks }), onProgress: (p) => progress.push(p) });
    assert.deepStrictEqual(Array.from(new Uint8Array(buf)), [1, 2, 3, 4, 5]);
    assert.deepStrictEqual(progress.map(p => p.loaded), [3, 5]);
    assert.strictEqual(progress[1].total, 5);
  });

  it('retries transient 503 and succeeds; never retries 404', async () => {
    let n = 0;
    const flaky = async () => (++n < 3 ? mockResponse({ status: 503 }) : mockResponse({ body: new Uint8Array([9]) }));
    const buf = await fetchMod.fetchArrayBuffer('https://cdn.x/a.glb', { fetchImpl: flaky, retries: 2, retryDelayMs: 1 });
    assert.strictEqual(n, 3);
    assert.strictEqual(buf.byteLength, 1);

    let m = 0;
    await assert.rejects(
      fetchMod.fetchArrayBuffer('https://cdn.x/missing.glb', { fetchImpl: async () => { m++; return mockResponse({ status: 404 }); }, retries: 3, retryDelayMs: 1 }),
      (e) => e.code === 'NOT_FOUND' && e.status === 404
    );
    assert.strictEqual(m, 1);
  });

  it('detects an SPA index.html served instead of a model (Cloudflare Pages /* rewrite)', async () => {
    await assert.rejects(
      fetchMod.fetchArrayBuffer('https://x/assets/models/nope.glb', { fetchImpl: async () => mockResponse({ type: 'text/html; charset=utf-8' }) }),
      (e) => e.code === 'NOT_A_MODEL'
    );
    // Verified with `wrangler pages dev`: a missing .glb returns index.html labelled model/gltf-binary by _headers.
    const html = new TextEncoder().encode('\n<!DOCTYPE html><html lang="vi"><head>');
    await assert.rejects(
      fetchMod.fetchArrayBuffer('https://x/assets/models/nope.glb', { fetchImpl: async () => mockResponse({ body: html, type: 'model/gltf-binary' }) }),
      (e) => e.code === 'NOT_A_MODEL'
    );
  });

  it('times out, can be cancelled, and enforces a size cap', async () => {
    const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    await assert.rejects(fetchMod.fetchArrayBuffer('https://x/a.glb', { fetchImpl: hang, timeoutMs: 30, retries: 0 }), (e) => e.code === 'TIMEOUT');

    const ac = new AbortController();
    const p = fetchMod.fetchArrayBuffer('https://x/a.glb', { fetchImpl: hang, signal: ac.signal, timeoutMs: 10000 });
    ac.abort();
    await assert.rejects(p, (e) => e.code === 'ABORTED');

    await assert.rejects(
      fetchMod.fetchArrayBuffer('https://x/a.glb', { fetchImpl: async () => mockResponse({ length: 500 * 1024 * 1024 }) }),
      (e) => e.code === 'TOO_LARGE'
    );
  });

  it('maps fetch TypeError (DNS/offline/CORS) to NETWORK_OR_CORS', async () => {
    await assert.rejects(
      fetchMod.fetchArrayBuffer('https://x/a.glb', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); }, retries: 0 }),
      (e) => e.code === 'NETWORK_OR_CORS' && e.retriable === true
    );
  });

  it('cache de-duplicates concurrent downloads, evicts LRU, and uses persistent storage when present', async () => {
    const cache = new AssetCache({ maxBytes: 10, cachesImpl: null });
    let calls = 0;
    const fetcher = async () => { calls++; await new Promise(r => setTimeout(r, 5)); return new ArrayBuffer(4); };
    const [a, b] = await Promise.all([cache.getOrFetch('u1', fetcher), cache.getOrFetch('u1', fetcher)]);
    assert.strictEqual(a, b);
    assert.strictEqual(calls, 1);
    await cache.getOrFetch('u2', async () => new ArrayBuffer(4));
    cache.get('u1'); // touch u1 → u2 becomes least recent
    await cache.getOrFetch('u3', async () => new ArrayBuffer(4));
    assert.ok(cache.has('u1') && cache.has('u3') && !cache.has('u2'));

    const store = new Map();
    const cachesImpl = { open: async () => ({ match: async (u) => store.get(u), put: async (u, r) => store.set(u, r) }) };
    const p1 = new AssetCache({ cachesImpl });
    await p1.getOrFetch('https://x/m.glb', async () => new Uint8Array([7, 7]).buffer);
    await new Promise(r => setTimeout(r, 5));
    const p2 = new AssetCache({ cachesImpl });
    const again = await p2.getOrFetch('https://x/m.glb', async () => { throw new Error('should not refetch'); });
    assert.deepStrictEqual(Array.from(new Uint8Array(again)), [7, 7]);
    assert.strictEqual(p2.stats.persistentHits, 1);
  });
});

// ---------------------------------------------------------------- validation + normalisation
describe('AR: model validation and normalisation', () => {
  const cyber = () => {
    const b = fs.readFileSync(path.join(ROOT, 'assets/models/ar/tesla_cybertruck_ar_v1.glb'));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };

  it('reads the real Cybertruck GLB container and its material names', () => {
    const info = validator.inspectGltfJson(validator.readGlbJson(cyber()));
    assert.ok(info.meshCount > 0);
    assert.ok(info.materialNames.includes('Material_Body'));
    assert.deepStrictEqual(info.animationNames, []);
  });

  it('rejects non-GLB, truncated, wrong-version and unsupported-extension payloads', () => {
    assert.throws(() => validator.readGlbJson(new TextEncoder().encode('<!DOCTYPE html><html>').buffer), (e) => e.code === 'INVALID_MODEL');
    assert.throws(() => validator.readGlbJson(cyber().slice(0, 1000)), (e) => e.code === 'TRUNCATED_MODEL');
    const v1 = cyber();
    new DataView(v1).setUint32(4, 1, true);
    assert.throws(() => validator.readGlbJson(v1), (e) => e.code === 'UNSUPPORTED_VERSION');
    assert.throws(() => validator.inspectGltfJson({ asset: { version: '2.0' }, meshes: [{}], extensionsRequired: ['EXT_unknown_magic'] }), (e) => e.code === 'UNSUPPORTED_EXTENSION');
    assert.throws(() => validator.inspectGltfJson({ asset: { version: '2.0' }, meshes: [] }), (e) => e.code === 'EMPTY_MODEL');
  });

  it('rotates a sideways car, rescales cm-authored geometry to the declared length, and grounds it at y=0', () => {
    const root = vehicleBox({ x: 450, y: 140, z: 180 }); // centimetres, length along X, centred at origin (half below ground)
    const res = normalizeVehicle(root, { dimensionsMeters: { length: 4.5, width: 1.8, height: 1.4 }, scaleMode: 'fit-to-length' });
    assert.deepStrictEqual(res.rotations, ['length-x→z']);
    assert.ok(Math.abs(res.sizeMeters.length - 4.5) < 1e-3);
    assert.ok(Math.abs(res.sizeMeters.width - 1.8) < 1e-3);
    const box = new THREE.Box3().setFromObject(res.pivot, true);
    assert.ok(Math.abs(box.min.y) < 1e-6, 'tyres touch the ground plane');
    assert.ok(Math.abs(box.getCenter(new THREE.Vector3()).x) < 1e-6 && Math.abs(box.getCenter(new THREE.Vector3()).z) < 1e-6);
  });

  it('fixes Z-up exports and flags certified-scale mismatches instead of trusting them', () => {
    const zUp = normalizeVehicle(vehicleBox({ x: 1.8, y: 4.6, z: 1.4 }), { scaleMode: 'as-authored' });
    assert.ok(zUp.rotations.includes('z-up→y-up'));
    assert.ok(Math.abs(zUp.sizeMeters.length - 4.6) < 1e-3);

    const wrong = normalizeVehicle(vehicleBox({ x: 1, y: 0.5, z: 2 }), { scaleMode: 'certified', dimensionsMeters: { length: 5, width: 2, height: 1.8 } });
    assert.strictEqual(wrong.scaleMode, 'fit-to-length');
    assert.ok(wrong.warnings.some(w => w.startsWith('CERTIFIED_SCALE_MISMATCH')));
    assert.ok(Math.abs(wrong.sizeMeters.length - 5) < 1e-3);

    const toy = normalizeVehicle(vehicleBox({ x: 0.02, y: 0.01, z: 0.045 }), { scaleMode: 'as-authored' });
    assert.ok(toy.warnings.some(w => w.startsWith('ASSUMED_LENGTH')));
    assert.ok(Math.abs(toy.sizeMeters.length - 4.5) < 1e-3);
  });

  it('rejects degenerate (zero-size) models', () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3))));
    assert.throws(() => normalizeVehicle(g, {}), (e) => e.code === 'INVALID_BOUNDS');
  });

  it('resource tracker disposes geometries, materials and textures exactly once', () => {
    const tex = new THREE.Texture();
    let texDisposed = 0;
    tex.addEventListener('dispose', () => texDisposed++);
    const mat = new THREE.MeshStandardMaterial({ map: tex });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(), mat), new THREE.Mesh(new THREE.BoxGeometry(), mat));
    const stats = tracker.disposeObject3D(g);
    assert.deepStrictEqual(stats, { geometries: 2, materials: 1, textures: 1 });
    assert.strictEqual(texDisposed, 1);

    const t = new tracker.ResourceTracker();
    const order = [];
    t.add(() => order.push('a'));
    t.add(() => { throw new Error('isolated'); });
    t.add(() => order.push('c'));
    t.disposeAll();
    t.disposeAll();
    assert.deepStrictEqual(order, ['c', 'a']);
  });
});

// ---------------------------------------------------------------- paint
describe('AR: vehicle paint configuration', () => {
  it('re-tints only the declared body paint; glass, rims and lights keep colour, metalness and roughness', () => {
    const root = new THREE.Group();
    const body = new THREE.MeshPhysicalMaterial({ name: 'Material_Body', color: 0x999999, metalness: 0.9, roughness: 0.35, clearcoat: 1 });
    const rims = new THREE.MeshStandardMaterial({ name: 'Material_Rims', color: 0xcccccc, roughness: 0.22, metalness: 0.92 });
    const glass = new THREE.MeshStandardMaterial({ name: 'Material_Glass', color: 0x223344 });
    for (const m of [body, rims, glass]) root.add(new THREE.Mesh(new THREE.BoxGeometry(), m));

    const cfg = new MaterialConfigurator(root, { body: ['material_body', 'Body_Paint_Missing'], protectedPatterns: ['glass'] });
    assert.strictEqual(cfg.capabilities.paint, true);
    assert.deepStrictEqual(cfg.capabilities.matchedBody, ['Material_Body'], 'case-insensitive exact match');
    assert.deepStrictEqual(cfg.capabilities.missingBody, ['Body_Paint_Missing']);
    assert.ok(cfg.setPaint('#3F6212'));
    assert.strictEqual(body.color.getHexString(), new THREE.Color('#3F6212').getHexString());
    assert.deepStrictEqual([body.metalness, body.roughness, body.clearcoat], [0.9, 0.35, 1], 'reflection properties preserved');
    assert.strictEqual(rims.color.getHex(), 0xcccccc);
    assert.strictEqual(glass.color.getHex(), 0x223344);
    assert.strictEqual(cfg.setPaint('red'), false, 'only #RRGGBB accepted');
    cfg.reset();
    assert.strictEqual(body.color.getHex(), 0x999999);

    const none = new MaterialConfigurator(root, { body: ['Material_Glass'], protectedPatterns: ['glass'] });
    assert.strictEqual(none.capabilities.paint, false, 'protected materials can never be repainted');
  });

  it('colour without its own GLB re-tints in place (no reload); a colour with a variant GLB loads that file', async () => {
    const loads = [];
    const make = () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.4, 4.5), new THREE.MeshStandardMaterial({ name: 'Body_Paint' })));
      return g;
    };
    const loader = {
      baseUrl: 'https://sigma-car.pages.dev/',
      load: async (url) => { loads.push(url); return { scene: make(), animations: [], url: new URL(url, 'https://sigma-car.pages.dev/').toString(), bytes: 1, warnings: [] }; }
    };
    const manifest = {
      model: { glbUrl: 'assets/models/car.glb', scaleMode: 'fit-to-length', dimensionsMeters: { length: 4.5, width: 1.9, height: 1.4 } },
      colors: [{ index: 0, name: 'A', hex: '#DC2626' }, { index: 1, name: 'B', hex: '#0284C7' }, { index: 2, name: 'C', hex: '#111111' }],
      variants: [{ colorIndex: 2, glbUrl: 'assets/models/car_black.glb' }],
      materials: { body: ['Body_Paint'], protectedPatterns: [] },
      features: { changeColor: true }
    };
    const anchor = new THREE.Group();
    const v = new VehicleController({ loader, anchor, manifest });
    await v.load(0);
    assert.deepStrictEqual(loads, ['assets/models/car.glb']);
    const paint = () => v.pivot.getObjectByProperty('type', 'Mesh').material.color.getHexString();
    assert.strictEqual(paint(), new THREE.Color('#DC2626').getHexString());
    assert.deepStrictEqual(await v.setColor(1), { changed: true, reloaded: false });
    assert.strictEqual(loads.length, 1, 'no reload for a tint');
    assert.strictEqual(paint(), new THREE.Color('#0284C7').getHexString());
    assert.deepStrictEqual(await v.setColor(2), { changed: true, reloaded: true });
    assert.deepStrictEqual(loads, ['assets/models/car.glb', 'assets/models/car_black.glb']);
    assert.strictEqual(anchor.children.length, 1, 'previous model replaced, not stacked');
    v.dispose();
  });
});

// ---------------------------------------------------------------- Apple support
describe('AR: Apple AR support detection (iOS / iPadOS only)', () => {
  const doc = (relAr) => ({
    createElement: (tag) => (tag === 'a'
      ? { relList: { supports: (t) => { if (relAr === 'throw') throw new TypeError('no supported tokens'); return relAr && t === 'ar'; } } }
      : { getContext: () => ({}) })
  });
  const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    fbIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]'
  };
  const detect = (ua, { relAr = false, touch = 0, platform = '', secure = true } = {}) => appleSupport.detectAppleArSupport({
    navigator: { userAgent: ua, maxTouchPoints: touch, platform },
    document: doc(relAr),
    window: { isSecureContext: secure }
  });

  it('launches only on iPhone / iPad with AR Quick Look (rel="ar") in a secure context', () => {
    const iphone = detect(UA.iphone, { relAr: true, touch: 5 });
    assert.deepStrictEqual([iphone.canLaunchAr, iphone.reason, iphone.device.kind], [true, 'QUICK_LOOK', 'iphone']);
    const ipad = detect(UA.ipad, { relAr: true, touch: 5 });
    assert.deepStrictEqual([ipad.canLaunchAr, ipad.device.kind], [true, 'ipad']);
    const ipadDesktopUa = detect(UA.mac, { relAr: true, touch: 5, platform: 'MacIntel' });
    assert.deepStrictEqual([ipadDesktopUa.canLaunchAr, ipadDesktopUa.device.kind], [true, 'ipad'], 'iPadOS 13+ desktop-class UA');
  });

  it('feature detection decides: an iPhone UA without rel="ar" (in-app browser) cannot launch', () => {
    const inApp = detect(UA.fbIos, { relAr: false, touch: 5 });
    assert.deepStrictEqual([inApp.canLaunchAr, inApp.reason, inApp.device.inAppBrowser], [false, 'APPLE_NO_QUICK_LOOK', true]);
    const throws = detect(UA.iphone, { relAr: 'throw', touch: 5 });
    assert.strictEqual(throws.canLaunchAr, false, 'DOMTokenList.supports throwing is handled');
    assert.strictEqual(detect(UA.iphone, { relAr: true, touch: 5, secure: false }).reason, 'INSECURE_CONTEXT');
  });

  it('Android, Windows/Linux desktop and Mac never launch AR (even if a browser claimed rel="ar")', () => {
    const android = detect(UA.android, { relAr: true, touch: 5 });
    assert.deepStrictEqual([android.canLaunchAr, android.reason], [false, 'ANDROID']);
    const windows = detect(UA.windows, { relAr: false });
    assert.deepStrictEqual([windows.canLaunchAr, windows.reason], [false, 'DESKTOP']);
    const mac = detect(UA.mac, { relAr: true, touch: 0, platform: 'MacIntel' });
    assert.deepStrictEqual([mac.canLaunchAr, mac.reason], [false, 'MAC'], 'real Mac: Quick Look has no AR camera');
    assert.strictEqual(appleSupport.SUPPORT_MESSAGES.ANDROID, 'AR Camera chỉ khả dụng trên iPhone/iPad tương thích.');
  });
});

// ---------------------------------------------------------------- Quick Look
describe('AR: Quick Look launcher', () => {
  it('builds the documented fragment parameters (real scale locked, canonical page for sharing)', () => {
    const href = quickLook.buildQuickLookHref('https://cdn.example/car.usdz?v=1#old', { canonicalWebPageURL: 'https://sigma-car.pages.dev/ar/tesla-cybertruck?color=1' });
    assert.strictEqual(href, 'https://cdn.example/car.usdz?v=1#allowsContentScaling=0&canonicalWebPageURL=https%3A%2F%2Fsigma-car.pages.dev%2Far%2Ftesla-cybertruck%3Fcolor%3D1');
    assert.strictEqual(quickLook.buildQuickLookHref('blob:https://x/1', {}), 'blob:https://x/1#allowsContentScaling=0');
    for (const bad of ['http://evil.example/a.usdz', 'javascript:alert(1)', 'data:model/vnd.usdz+zip;base64,AA==', '']) {
      assert.throws(() => quickLook.buildQuickLookHref(bad), bad || 'empty');
    }
  });

  it('activates <a rel="ar"> with an <img> first child; blob files get the download attribute', () => {
    const created = [];
    const el = (tag) => {
      const e = { tagName: tag.toUpperCase(), attrs: {}, children: [], style: {}, clicks: 0,
        setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; }, removeAttribute(k) { delete this.attrs[k]; },
        appendChild(c) { this.children.push(c); }, click() { this.clicks++; } };
      if (tag === 'a') created.push(e);
      return e;
    };
    const body = { children: [], appendChild(c) { this.children.push(c); c.id && (byId[c.id] = c); } };
    const byId = {};
    const fakeDoc = { createElement: el, body, getElementById: (id) => byId[id] || null };

    const a = quickLook.launchQuickLook('https://x/car.usdz#allowsContentScaling=0', { document: fakeDoc });
    assert.strictEqual(a.getAttribute('rel'), 'ar');
    assert.strictEqual(a.children[0].tagName, 'IMG');
    assert.strictEqual(a.getAttribute('download'), null);
    assert.strictEqual(a.clicks, 1);
    const b = quickLook.launchQuickLook('blob:https://x/9#allowsContentScaling=0', { document: fakeDoc, fileName: 'car.usdz' });
    assert.strictEqual(b, a, 'one anchor re-used');
    assert.strictEqual(b.getAttribute('download'), 'car.usdz');
    assert.strictEqual(created.length, 1);
  });
});

// ---------------------------------------------------------------- USDZ
function storedZip(entries, { method = 0 } = {}) {
  const parts = [];
  for (const [name, data] of entries) {
    const n = Buffer.from(name);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(method, 8);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(n.length, 26);
    h.writeUInt16LE(0, 28);
    parts.push(h, n, data);
  }
  return new Uint8Array(Buffer.concat(parts));
}

describe('AR: USDZ conversion and validation', () => {
  const loadCybertruck = async () => {
    const b = fs.readFileSync(path.join(ROOT, 'assets/models/ar/tesla_cybertruck_ar_v1.glb'));
    const gltf = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
    return normalizeVehicle(gltf.scene, { dimensionsMeters: { length: 5.682, width: 2.2, height: 1.791 }, scaleMode: 'certified' });
  };

  it('converts the real Cybertruck (selected paint, metres, horizontal anchoring) into a spec-valid USDZ', async () => {
    const norm = await loadCybertruck();
    assert.ok(Math.abs(norm.sizeMeters.length - 5.682) < 0.06, 'real-world length before export');
    new MaterialConfigurator(norm.pivot, { body: ['Material_Body'] }).setPaint('#3F6212');
    const out = await usdzBuilder.buildVehicleUsdz(norm.pivot);
    const check = usdzBuilder.inspectUsdz(out.bytes);
    assert.ok(check.ok, check.problems.join(','));
    assert.strictEqual(check.firstFile, 'model.usda');
    assert.strictEqual(out.report.exported, out.report.meshes);
    assert.ok(out.warnings.some(w => w.startsWith('USDZ_SINGLE_SIDED')), 'double-sided loss is reported, not hidden');
    assert.ok(out.report.estimatedBytes >= out.bytes.length * 0.85 && out.report.estimatedBytes <= out.bytes.length * 1.5, 'size estimate calibrated');
    const text = Buffer.from(out.bytes).toString('latin1');
    assert.match(text, /metersPerUnit = 1\b/);
    assert.match(text, /upAxis = "Y"/);
    assert.match(text, /preliminary:anchoring:type = "plane"/);
    assert.match(text, /preliminary:planeAnchoring:alignment = "horizontal"/);
    const c = new THREE.Color('#3F6212');
    const diffuse = Array.from(text.matchAll(/color3f inputs:diffuseColor = \(([^)]*)\)/g)).map(m => m[1].split(',').map(Number));
    const painted = diffuse.filter(v => Math.abs(v[0] - c.r) < 1e-4 && Math.abs(v[1] - c.g) < 1e-4 && Math.abs(v[2] - c.b) < 1e-4);
    assert.strictEqual(painted.length, 1, 'exactly the body paint material carries the selected colour');
    assert.ok(diffuse.length >= 8);
  });

  it('rejects HTML, non-zip, compressed, misordered and truncated archives', () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><html><body>SPA</body></html>');
    assert.deepStrictEqual(usdzBuilder.inspectUsdz(html).problems, ['HTML_INSTEAD_OF_USDZ']);
    assert.strictEqual(usdzBuilder.inspectUsdzHeader(html).problem, 'HTML_INSTEAD_OF_USDZ');
    assert.deepStrictEqual(usdzBuilder.inspectUsdz(new Uint8Array(64)).problems, ['NOT_A_ZIP']);
    assert.ok(usdzBuilder.inspectUsdz(storedZip([['model.usda', Buffer.from('#usda 1.0')]], { method: 8 })).problems.includes('COMPRESSED_ENTRY:model.usda'));
    assert.ok(usdzBuilder.inspectUsdz(storedZip([['textures/a.png', Buffer.alloc(10)], ['model.usda', Buffer.alloc(10)]])).problems.includes('FIRST_ENTRY_NOT_USD_LAYER'));
    assert.strictEqual(usdzBuilder.inspectUsdzHeader(storedZip([['textures/a.png', Buffer.alloc(4)]])).problem, 'FIRST_ENTRY_NOT_USD_LAYER');
    const ok = storedZip([['model.usda', Buffer.alloc(100)]]);
    assert.ok(usdzBuilder.inspectUsdz(ok.subarray(0, 60)).problems.includes('TRUNCATED'));
  });

  it('refuses conversions it cannot do well instead of producing a broken file', async () => {
    const big = new THREE.Group();
    big.add(new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.4, 1.9, 40, 40, 40), new THREE.MeshStandardMaterial()));
    await assert.rejects(usdzBuilder.buildVehicleUsdz(big, { maxEstimatedBytes: 1000 }), (e) => e.code === 'MODEL_TOO_LARGE_FOR_CONVERSION');
    const unlit = new THREE.Group();
    unlit.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    await assert.rejects(usdzBuilder.buildVehicleUsdz(unlit), (e) => e.code === 'NOTHING_EXPORTABLE');
    const ktx = new THREE.Group();
    const tex = new THREE.CompressedTexture([], 4, 4);
    ktx.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: tex })));
    await assert.rejects(usdzBuilder.buildVehicleUsdz(ktx), (e) => e.code === 'COMPRESSED_TEXTURES');
  });

  it('pre-built USDZ files in the repository are valid and match data/usdz-assets.json', () => {
    const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/usdz-assets.json'), 'utf8'));
    const entries = Object.values(index.vehicles).flat();
    assert.ok(entries.length >= 4);
    for (const e of entries) {
      const bytes = fs.readFileSync(path.join(ROOT, e.path));
      assert.strictEqual(bytes.length, e.bytes, e.path);
      assert.strictEqual(crypto.createHash('sha256').update(bytes).digest('hex'), e.sha256, `${e.path} is stale — re-run npm run usdz:build`);
      assert.ok(usdzBuilder.inspectUsdz(new Uint8Array(bytes)).ok, e.path);
      assert.ok(bytes.length < 25 * 1024 * 1024, 'within the Cloudflare Pages file limit');
    }
  });
});

// ---------------------------------------------------------------- resolver
describe('AR: USDZ selection for the chosen colour', () => {
  const base = 'https://sigma-car.pages.dev/';
  const usdzHead = storedZip([['model.usda', Buffer.from('#usda 1.0\n')]]);
  const res = (status, bytes, type = 'model/vnd.usdz+zip') => ({ ok: status < 300, status, headers: { get: () => type }, body: null, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  const manifest = (usdz, onDeviceConversion = true, colors = 3) => ({
    colors: Array.from({ length: colors }, (_, i) => ({ index: i, name: `C${i}`, hex: '#111111' })),
    appleAr: { usdz, onDeviceConversion },
    features: { changeColor: true }
  });
  const fakeBuild = () => {
    const calls = [];
    return { calls, build: async (pivot) => { calls.push(pivot); return { bytes: usdzHead, warnings: [], report: {} }; } };
  };
  let n = 0;
  const urls = { createObjectURL: () => `blob:${base}${++n}`, revokeObjectURL: () => {} };

  it('uses the exact-colour file when it really is a USDZ; otherwise converts on the device', async () => {
    const { build, calls } = fakeBuild();
    const fetchImpl = async (u) => (u.endsWith('/0.usdz') ? res(200, usdzHead) : res(200, new TextEncoder().encode('<!doctype html><html>'), 'text/html'));
    const r = new UsdzResolver({ manifest: manifest([{ colorIndex: 0, url: 'assets/models/usdz/x/0.usdz', source: 'prebuilt' }, { colorIndex: 1, url: 'https://cdn.example/1.usdz', source: 'external' }]), baseUrl: base, fetchImpl, build, ...urls });
    const a = await r.prepare(0, { getPivot: () => ({}) });
    assert.deepStrictEqual([a.kind, a.url, a.colorMatch], ['prebuilt', `${base}assets/models/usdz/x/0.usdz`, true]);
    const b = await r.prepare(1, { getPivot: () => ({ id: 'pivot' }) });
    assert.strictEqual(b.kind, 'generated');
    assert.match(b.url, /^blob:/);
    assert.ok(b.warnings.some(w => /USDZ_INVALID: .*1\.usdz \(HTML_INSTEAD_OF_USDZ\)/.test(w)));
    assert.strictEqual(calls.length, 1);
    const again = await r.prepare(1, { getPivot: () => ({}) });
    assert.strictEqual(again.url, b.url, 'generated file cached per colour');
    assert.strictEqual(calls.length, 1);
  });

  it('cross-origin files that cannot be inspected (no CORS) are still launched — Quick Look fetches them itself', async () => {
    const r = new UsdzResolver({ manifest: manifest([{ colorIndex: 0, url: 'https://cdn.example/0.usdz' }]), baseUrl: base, fetchImpl: async () => { throw new TypeError('Failed to fetch'); }, ...urls });
    const a = await r.prepare(0, {});
    assert.deepStrictEqual([a.kind, a.probe.status], ['external', 'unverified']);
  });

  it('falls back to a colour-independent file only with an explicit "default colour" flag, and fails honestly', async () => {
    const r = new UsdzResolver({ manifest: manifest([{ colorIndex: null, url: 'https://cdn.example/any.usdz' }], false), baseUrl: base, fetchImpl: async () => res(200, usdzHead), ...urls });
    const a = await r.prepare(2, {});
    assert.deepStrictEqual([a.kind, a.colorMatch], ['generic', false]);
    const single = new UsdzResolver({ manifest: manifest([{ colorIndex: null, url: 'https://cdn.example/any.usdz' }], false, 1), baseUrl: base, fetchImpl: async () => res(200, usdzHead), ...urls });
    assert.strictEqual((await single.prepare(0, {})).colorMatch, true, 'a single-colour vehicle is always a match');
    const none = new UsdzResolver({ manifest: manifest([], false), baseUrl: base, ...urls });
    await assert.rejects(none.prepare(0, {}), (e) => e.code === 'NO_USDZ');
    const unsafe = new UsdzResolver({ manifest: manifest([{ colorIndex: 0, url: 'http://evil.example/0.usdz' }], false), baseUrl: base, ...urls });
    await assert.rejects(unsafe.prepare(0, {}), (e) => e.code === 'NO_USDZ', 'insecure URLs are never used');
  });

  it('drops a conversion whose colour was changed meanwhile, and revokes generated files on dispose', async () => {
    const revoked = [];
    const { build } = fakeBuild();
    const r = new UsdzResolver({ manifest: manifest([]), baseUrl: base, build, createObjectURL: () => 'blob:x/1', revokeObjectURL: (u) => revoked.push(u) });
    assert.strictEqual(await r.prepare(0, { getPivot: () => ({}), isCurrent: () => false }), null);
    await r.prepare(1, { getPivot: () => ({}) });
    r.dispose();
    assert.deepStrictEqual(revoked, ['blob:x/1']);
  });

  it('URL policy for USDZ: https, same-origin or loopback only; .usdz only; no credentials', () => {
    const ok = urlPolicy.validateUsdzUrl('assets/models/usdz/a/0.usdz?v=1', { baseUrl: base });
    assert.deepStrictEqual([ok.ok, ok.crossOrigin], [true, false]);
    assert.ok(urlPolicy.validateUsdzUrl('https://cdn.example/car.usdz', { baseUrl: base }).ok);
    for (const [u, reason] of [['http://cdn.example/car.usdz', 'INSECURE_OR_UNSUPPORTED_PROTOCOL'], ['https://u:p@cdn.example/car.usdz', 'CREDENTIALS_IN_URL'], ['https://cdn.example/car.glb', 'UNSUPPORTED_EXTENSION'], ['//cdn.example/car.usdz', 'PROTOCOL_RELATIVE_URL']]) {
      assert.strictEqual(urlPolicy.validateUsdzUrl(u, { baseUrl: base }).reason, reason, u);
    }
  });
});

// ---------------------------------------------------------------- removal of the old engine
describe('AR: obsolete AR integrations are removed from the active flow', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap(d => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));

  it('WebXR / ARCore / Scene Viewer / camera-overlay modules no longer exist', () => {
    for (const f of [
      'js/ar-adapter.js', 'js/ar/core/session-manager.js', 'js/ar/core/hit-test-manager.js', 'js/ar/core/placement-reticle.js',
      'js/ar/core/placement-controller.js', 'js/ar/core/interaction-manager.js', 'js/ar/core/capability-detector.js',
      'js/ar/fallback/platform-fallback.js', 'js/ar/capture/capture-manager.js', 'js/ar/vehicle/hotspot-manager.js',
      'js/ar/vehicle/animation-controller.js', 'js/vendor/three/addons/webxr/XREstimatedLight.js'
    ]) assert.ok(!fs.existsSync(path.join(ROOT, f)), `${f} should be removed`);
  });

  it('the AR page code never touches WebXR, the camera or Android intents', () => {
    const files = [...walk('js/ar'), 'ar.html'];
    for (const f of files) {
      const src = read(f).replace(/\/\/.*$/gm, '');
      for (const banned of ['navigator.xr', 'requestSession', 'immersive-ar', 'intent://', 'scene-viewer', 'getUserMedia', 'XREstimatedLight', 'hit-test']) {
        assert.ok(!src.includes(banned), `${f} contains ${banned}`);
      }
    }
  });

  it('the shared 3D showroom viewer only requests immersive-vr (VR headset), never immersive-ar', () => {
    const src = read('js/car-3d-viewer.js');
    assert.match(src, /const sessionMode = 'immersive-vr';/);
    assert.ok(!/requestSession\(\s*'immersive-ar'/.test(src) && !/\?\s*'immersive-ar'/.test(src));
    assert.match(src, /mode: 'apple-quick-look-only'/);
  });

  it('Pages headers: no camera / XR permissions on the AR page; a single USDZ rule with the USDZ media type', () => {
    const h = read('_headers').replace(/\r\n/g, '\n');
    const arBlock = h.split('\n\n').find(b => b.startsWith('/ar/*'));
    assert.ok(arBlock && !/Permissions-Policy/.test(arBlock));
    const usdzRules = h.split('\n\n').filter(b => /\.usdz|usdz\//.test(b.split('\n').find(l => !l.startsWith('#')) || ''));
    assert.strictEqual(usdzRules.length, 1);
    assert.match(usdzRules[0], /Content-Type: model\/vnd\.usdz\+zip/);
  });
});

// ---------------------------------------------------------------- manifest + config sync
describe('AR: manifest (schema v2), source fallback and configuration sync', () => {
  const good = () => ({
    schemaVersion: 2, vehicleId: 'tesla-cybertruck', name: 'Tesla Cybertruck',
    model: { glbUrl: 'assets/models/ar/tesla_cybertruck_ar_v1.glb', scaleMode: 'certified', dimensionsMeters: { length: 5.682, width: 2.2, height: 1.791 } },
    colors: [{ index: 0, name: 'Steel', hex: '#94A3B8' }, { index: 1, name: 'Black', hex: '#1E293B' }],
    variants: [],
    materials: { body: ['Material_Body'] },
    appleAr: { usdz: [{ colorIndex: 0, url: 'assets/models/usdz/tesla-cybertruck/0.usdz?v=abc', source: 'prebuilt', bytes: 988109 }], onDeviceConversion: true },
    features: { changeColor: true, quickLook: true }
  });

  it('accepts a valid manifest and re-derives features from the data actually present', () => {
    const m = manifestSchema.validateManifest(good(), 'tesla-cybertruck');
    assert.strictEqual(m.features.changeColor, true);
    assert.strictEqual(m.features.quickLook, true);
    assert.deepStrictEqual(m.appleAr.usdz, [{ colorIndex: 0, url: 'assets/models/usdz/tesla-cybertruck/0.usdz?v=abc', source: 'prebuilt', bytes: 988109 }]);
    assert.strictEqual(m.appleAr.allowsContentScaling, false);
    const noBody = good();
    noBody.materials.body = [];
    assert.strictEqual(manifestSchema.validateManifest(noBody, 'tesla-cybertruck').features.changeColor, false);
    const noAr = good();
    noAr.appleAr = { usdz: [], onDeviceConversion: false };
    assert.strictEqual(manifestSchema.validateManifest(noAr, 'tesla-cybertruck').features.quickLook, false, 'declared true but no file/conversion → off');
  });

  it('rejects unsafe or mismatched manifests and USDZ entries', () => {
    const bad = good();
    bad.model.glbUrl = 'javascript:alert(1)';
    assert.throws(() => manifestSchema.validateManifest(bad, 'tesla-cybertruck'), (e) => e.code === 'INVALID_MANIFEST');
    assert.throws(() => manifestSchema.validateManifest(good(), 'other-car'), /không khớp/);
    const v1 = good();
    v1.schemaVersion = 1;
    assert.throws(() => manifestSchema.validateManifest(v1, 'tesla-cybertruck'), /schemaVersion 1/);
    const u = good();
    u.appleAr.usdz = [
      { colorIndex: 0, url: 'javascript:alert(1)//.usdz' },
      { colorIndex: 1, url: 'http://evil.example/1.usdz' },
      { colorIndex: 7, url: 'https://cdn.example/7.usdz' },
      { colorIndex: 1, url: 'https://cdn.example/model.glb' },
      { colorIndex: 1, url: 'https://cdn.example/1.usdz' },
      { colorIndex: 1, url: 'https://cdn.example/1-duplicate.usdz' }
    ];
    assert.deepStrictEqual(manifestSchema.validateManifest(u, 'tesla-cybertruck').appleAr.usdz.map(e => e.url), ['https://cdn.example/1.usdz']);
    assert.ok(!manifestSchema.isValidVehicleId('../etc/passwd'));
  });

  const jsonRes = (status, body, headers = {}) => ({ ok: status < 300, status, headers: { get: (n) => ({ 'content-type': 'application/json', ...headers })[n.toLowerCase()] ?? null }, json: async () => body });
  const htmlRes = () => ({ ok: true, status: 200, headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'text/html' : null) }, json: async () => { throw new Error('html'); } });

  it('uses the live API first; falls back to the static snapshot only when the API is unreachable', async () => {
    const api = await manifestClient.fetchArManifest('tesla-cybertruck', { fetchImpl: async () => jsonRes(200, { success: true, data: good() }) });
    assert.strictEqual(api.source, 'api');

    for (const [label, first, status] of [
      ['static host (SPA html)', htmlRes(), 'static-host'],
      ['proxy outage', jsonRes(502, { success: false }, { 'x-sigma-proxy-error': 'BACKEND_UNREACHABLE' }), 'BACKEND_UNREACHABLE']
    ]) {
      const urls = [];
      const r = await manifestClient.fetchArManifest('tesla-cybertruck', {
        fetchImpl: async (u) => { urls.push(u); return urls.length === 1 ? first : jsonRes(200, good()); }
      });
      assert.strictEqual(r.source, 'static-snapshot', label);
      assert.strictEqual(r.apiStatus, status, label);
      assert.deepStrictEqual(urls, ['/api/v1/vehicles/tesla-cybertruck/ar-manifest', '/data/ar/tesla-cybertruck.json']);
    }

    const offline = await manifestClient.fetchArManifest('tesla-cybertruck', {
      fetchImpl: async (u) => { if (u.startsWith('/api')) throw new TypeError('Failed to fetch'); return jsonRes(200, good()); }
    });
    assert.strictEqual(offline.apiStatus, 'offline');
  });

  it('does not mask authoritative API answers (404) with stale snapshots', async () => {
    let calls = 0;
    await assert.rejects(
      manifestClient.fetchArManifest('tesla-cybertruck', { fetchImpl: async () => { calls++; return jsonRes(404, { success: false, error: { code: 'NOT_FOUND', message: 'x' } }); } }),
      (e) => e.code === 'NOT_FOUND'
    );
    assert.strictEqual(calls, 1);
  });

  it('shares configuration with the website and builds safe return/checkout URLs', () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    store.set(configSync.CONFIG_STORAGE_KEY, JSON.stringify({ 'tesla-cybertruck': { colorIdx: 2, wheelId: 'wheel-22-forged', rotationAngle: 137 } }));
    const wheelIds = ['wheel-21-sport', 'wheel-20-aero', 'wheel-22-forged'];

    assert.deepStrictEqual(configSync.readConfig('tesla-cybertruck', { storage, colorCount: 4, wheelIds }), { colorIdx: 2, wheelId: 'wheel-22-forged' });
    assert.deepStrictEqual(configSync.readConfig('tesla-cybertruck', { storage, search: '?color=1&wheel=wheel-20-aero', colorCount: 4, wheelIds }), { colorIdx: 1, wheelId: 'wheel-20-aero' });
    assert.deepStrictEqual(configSync.readConfig('tesla-cybertruck', { storage, search: '?color=99&wheel=<script>', colorCount: 4, wheelIds }), { colorIdx: 2, wheelId: 'wheel-22-forged' }, 'invalid URL params ignored');

    configSync.writeConfig('tesla-cybertruck', { colorIdx: 3, colorName: 'Green' }, { storage });
    const saved = JSON.parse(store.get(configSync.CONFIG_STORAGE_KEY))['tesla-cybertruck'];
    assert.strictEqual(saved.colorIdx, 3);
    assert.strictEqual(saved.rotationAngle, 137, 'fields owned by the website are preserved');

    assert.strictEqual(configSync.buildReturnUrl('tesla-cybertruck', { colorIdx: 3 }), '/#detail?carId=tesla-cybertruck&colorIdx=3');
    assert.strictEqual(configSync.buildReturnUrl('tesla-cybertruck', { returnParam: '/#vr-ar', colorIdx: 1 }), '/#vr-ar?carId=tesla-cybertruck&colorIdx=1');
    for (const evil of ['https://evil.example', '//evil.example', '/#detail?x=<script>', 'javascript:alert(1)']) {
      assert.strictEqual(configSync.buildReturnUrl('tesla-cybertruck', { returnParam: evil }), '/#detail?carId=tesla-cybertruck', evil);
    }
    assert.strictEqual(configSync.buildCheckoutUrl('tesla-cybertruck', { colorName: 'Xanh Rêu' }), '/#checkout?source=ar&vehicleId=tesla-cybertruck&colorName=Xanh+R%C3%AAu');
  });
});
