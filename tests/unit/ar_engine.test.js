// Unit tests for the modular AR engine (js/ar/**). Browser ES modules are imported dynamically; `three`
// resolves to the same pinned version that is vendored for the browser (node_modules/three@0.170.0).

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

describe('AR: showroom entry point', () => {
  it('opens spatial AR for the displayed car even when the preview viewer is unavailable', () => {
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

let THREE, urlPolicy, fetchMod, AssetCache, validator, normalizeVehicle, placement, hit, gestures, MaterialConfigurator,
  AnimationController, capability, session, manifestSchema, manifestClient, configSync, fallback, tracker, HotspotManagerMod;

before(async () => {
  THREE = await import('three');
  urlPolicy = await mod('js/ar/models/url-policy.js');
  fetchMod = await mod('js/ar/models/fetch-with-progress.js');
  ({ AssetCache } = await mod('js/ar/models/asset-cache.js'));
  validator = await mod('js/ar/models/model-validator.js');
  ({ normalizeVehicle } = await mod('js/ar/models/model-normalizer.js'));
  placement = await mod('js/ar/core/placement-controller.js');
  hit = await mod('js/ar/core/hit-test-manager.js');
  gestures = await mod('js/ar/core/interaction-manager.js');
  ({ MaterialConfigurator } = await mod('js/ar/vehicle/material-configurator.js'));
  ({ AnimationController } = await mod('js/ar/vehicle/animation-controller.js'));
  capability = await mod('js/ar/core/capability-detector.js');
  session = await mod('js/ar/core/session-manager.js');
  manifestSchema = await mod('js/ar/manifest/manifest-schema.js');
  manifestClient = await mod('js/ar/manifest/manifest-client.js');
  configSync = await mod('js/ar/config/config-sync.js');
  fallback = await mod('js/ar/fallback/platform-fallback.js');
  tracker = await mod('js/ar/core/resource-tracker.js');
  HotspotManagerMod = await mod('js/ar/vehicle/hotspot-manager.js');
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

// ---------------------------------------------------------------- materials, animations, hotspots
describe('AR: vehicle configuration', () => {
  it('binds paint/rim materials by verified name and disables what is missing', () => {
    const root = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ name: 'Material_Body', color: 0x999999 });
    const rims = new THREE.MeshStandardMaterial({ name: 'Material_Rims', roughness: 0.5, metalness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ name: 'Material_Glass' });
    for (const m of [body, rims, glass]) root.add(new THREE.Mesh(new THREE.BoxGeometry(), m));

    const cfg = new MaterialConfigurator(root, { body: ['Material_Body', 'Body_Paint_Missing'], rims: ['material_rims'], protectedPatterns: ['glass'] });
    assert.strictEqual(cfg.capabilities.paint, true);
    assert.deepStrictEqual(cfg.capabilities.missingBody, ['Body_Paint_Missing']);
    assert.deepStrictEqual(cfg.capabilities.matchedRims, ['Material_Rims'], 'case-insensitive exact match');
    assert.ok(cfg.setPaint('#3F6212'));
    assert.strictEqual(body.color.getHexString(), new THREE.Color('#3F6212').getHexString());
    assert.ok(cfg.setRimFinish({ color: '#B45309', roughness: 0.3, metalness: 0.95 }));
    assert.strictEqual(rims.roughness, 0.3);
    assert.strictEqual(cfg.classify(body), 'body');
    assert.strictEqual(cfg.classify(glass), 'other');
    assert.strictEqual(cfg.setPaint('red'), false, 'only #RRGGBB accepted');
    cfg.reset();
    assert.strictEqual(body.color.getHex(), 0x999999);

    const none = new MaterialConfigurator(root, { body: ['Material_Glass'], rims: [], protectedPatterns: ['glass'] });
    assert.strictEqual(none.capabilities.paint, false, 'protected materials can never be repainted');
    assert.strictEqual(none.setPaint('#FFFFFF'), false);
  });

  it('enables doors only when the named clip exists, and plays it forward/reverse', () => {
    const root = new THREE.Group();
    const door = new THREE.Object3D();
    door.name = 'Door';
    root.add(door);
    const clip = new THREE.AnimationClip('Door_Open', 1, [new THREE.NumberKeyframeTrack('Door.rotation[y]', [0, 1], [0, 1.2])]);

    const missing = new AnimationController(root, [clip], { openDoors: 'Doors_Open_DoesNotExist' });
    assert.strictEqual(missing.capabilities.doors, false);
    assert.deepStrictEqual(missing.capabilities.missingClips, ['Doors_Open_DoesNotExist']);
    assert.strictEqual(missing.toggleDoors(), false);

    const ok = new AnimationController(root, [clip], { openDoors: 'Door_Open' });
    assert.strictEqual(ok.toggleDoors(), true);
    for (let i = 0; i < 12; i++) ok.update(0.1);
    assert.ok(Math.abs(door.rotation.y - 1.2) < 1e-6, 'door fully open');
    ok.toggleDoors();
    for (let i = 0; i < 12; i++) ok.update(0.1);
    assert.ok(Math.abs(door.rotation.y) < 1e-6, 'door closed again by reverse playback');
    ok.dispose();

    const noClips = new AnimationController(root, [], {});
    assert.strictEqual(noClips.capabilities.doors, false);
  });

  it('projects hotspots to screen and hides them behind the camera / when the vehicle is hidden', () => {
    const els = [];
    const mkEl = () => {
      const el = { style: {}, attrs: {}, children: [], className: '', type: '', setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); }, addEventListener() {}, remove() {} };
      els.push(el);
      return el;
    };
    const layer = { ownerDocument: { createElement: mkEl }, appendChild() {} };
    const hm = new HotspotManagerMod.HotspotManager({ layer, hotspots: [{ id: 'h', name: 'Pin', position: [0, 1, 0] }] });
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    cam.position.set(0, 1, 5);
    cam.lookAt(0, 1, 0);
    cam.updateMatrixWorld();
    const anchor = new THREE.Group();
    anchor.updateMatrixWorld();
    hm.update(cam, anchor, { width: 400, height: 400 });
    const btn = hm.items[0].el;
    assert.strictEqual(btn.style.opacity, '1');
    assert.match(btn.style.transform, /translate3d\(200\.0px, 200\.0px/);
    anchor.visible = false;
    hm.update(cam, anchor, { width: 400, height: 400 });
    assert.strictEqual(btn.style.opacity, '0');
  });
});

// ---------------------------------------------------------------- hit test + placement + gestures
describe('AR: surface detection, placement and gestures', () => {
  it('accepts horizontal floors and rejects walls / missing poses', () => {
    const floor = new THREE.Matrix4().makeTranslation(0.5, -1.2, -2).toArray();
    const r = hit.evaluateHitPose(floor);
    assert.strictEqual(r.valid, true);
    assert.ok(Math.abs(r.position.y + 1.2) < 1e-9);
    const wall = new THREE.Matrix4().makeRotationX(Math.PI / 2).toArray();
    assert.strictEqual(hit.evaluateHitPose(wall).reason, 'NOT_HORIZONTAL');
    const tilted = new THREE.Matrix4().makeRotationX((10 * Math.PI) / 180).toArray();
    assert.strictEqual(hit.evaluateHitPose(tilted).valid, true, 'small slopes are fine');
    assert.strictEqual(hit.evaluateHitPose(null).reason, 'NO_POSE');
  });

  it('requires several consecutive hits before reporting a stable surface and tolerates brief dropouts', () => {
    const f = new hit.SurfaceStabilityFilter({ framesToConfirm: 3, framesToLose: 2 });
    assert.deepStrictEqual([true, true].map(v => f.push(v)), [false, false]);
    assert.strictEqual(f.push(true), true);
    assert.strictEqual(f.push(false), true, 'one dropped frame does not hide the reticle');
    assert.strictEqual(f.push(false), false);
  });

  it('HitTestManager consumes real XR frame shapes and smooths the reticle', async () => {
    let cancelled = false;
    const sessionMock = { requestHitTestSource: async () => ({ cancel: () => { cancelled = true; } }) };
    const htm = await new hit.HitTestManager({ session: sessionMock, viewerSpace: {} }).init();
    const pose = (y) => ({ transform: { matrix: new THREE.Matrix4().makeTranslation(0, y, -1.5).toArray() } });
    const frame = (results) => ({ getHitTestResults: () => results });
    let s;
    for (let i = 0; i < 3; i++) s = htm.update(frame([{ getPose: () => pose(-1) }]), {});
    assert.strictEqual(s.stable, true);
    assert.ok(Math.abs(s.position.y + 1) < 1e-9);
    s = htm.update(frame([]), {});
    assert.strictEqual(s.valid, false);
    assert.strictEqual(s.stable, true, 'debouncing must not be mistaken for a current valid hit');
    htm.reset();
    assert.strictEqual(htm.latest.valid, false);
    assert.strictEqual(htm.latest.stable, false, 'reset immediately invalidates the previous surface');
    s = htm.update(frame([{ getPose: () => pose(-2) }]), {});
    assert.strictEqual(s.stable, false, 'a reset requires fresh confirmation');
    assert.strictEqual(s.position.y, -2, 'new scan must not blend with the old surface');
    htm.dispose();
    assert.strictEqual(cancelled, true);
  });

  it('placement state machine: no placement without a stable surface, no accidental re-placement, reset/move/rotate', () => {
    let now = 0;
    const pc = new placement.PlacementController({ cooldownMs: 600, now: () => now });
    const states = [];
    pc.on('change', (e) => states.push(e.state));
    assert.strictEqual(pc.place({ x: 0, y: 0, z: 0 }).ok, false, 'idle');
    pc.sessionStarted();
    assert.strictEqual(pc.place({ x: 0, y: 0, z: 0 }).reason, 'NO_STABLE_SURFACE');
    pc.surfaceUpdate(true);
    assert.strictEqual(pc.state, 'surface-found');
    assert.strictEqual(pc.place({ x: 1, y: -1, z: -2 }, 0.5).ok, true);
    assert.strictEqual(pc.yaw, 0.5);
    assert.strictEqual(pc.place({ x: 9, y: 9, z: 9 }).reason, 'ALREADY_PLACED', 'taps after placement are interactions');
    assert.ok(pc.rotate(0.25));
    assert.ok(Math.abs(pc.yaw - 0.75) < 1e-12);
    assert.ok(pc.startMove());
    now += 100;
    assert.strictEqual(pc.place({ x: 2, y: -1, z: -2 }).reason, 'COOLDOWN');
    now += 1000;
    assert.strictEqual(pc.place({ x: 2, y: -1, z: -2 }).ok, true);
    assert.ok(Math.abs(pc.yaw - 0.75) < 1e-12, 'moving keeps orientation');
    pc.surfaceUpdate(false);
    pc.reset();
    assert.strictEqual(pc.state, 'scanning');
    pc.sessionEnded();
    assert.strictEqual(pc.state, 'idle');
    assert.deepStrictEqual(states, ['scanning', 'surface-found', 'placed', 'moving', 'placed', 'scanning', 'idle']);
    assert.ok(Number.isFinite(placement.yawFacing({ x: 0, z: 0 }, { x: 0, z: 3 })));
  });

  it('gesture arbiter separates tap, drag-rotate and two-finger twist', () => {
    let now = 0;
    const g = new gestures.GestureArbiter({ now: () => now });
    const taps = [];
    const rot = [];
    g.on('tap', (e) => taps.push(e));
    g.on('rotate', (e) => rot.push(e.delta));

    g.pointerDown(1, 100, 100); now += 80; g.pointerUp(1, 102, 101);
    assert.strictEqual(taps.length, 1);

    g.pointerDown(1, 100, 100); g.pointerMove(1, 140, 100); g.pointerMove(1, 180, 100); now += 400; g.pointerUp(1, 180, 100);
    assert.strictEqual(taps.length, 1, 'a drag never ends as a tap');
    assert.ok(rot.length >= 1 && rot.every(d => d > 0));
    assert.ok(g.recentlyDragged(), 'used to drop the XR select that follows a drag');

    rot.length = 0;
    g.pointerDown(1, 0, 0); g.pointerDown(2, 100, 0); g.pointerMove(2, 100, 100);
    g.pointerUp(2, 100, 100); g.pointerUp(1, 0, 0);
    assert.strictEqual(rot.length, 1);
    assert.strictEqual(taps.length, 1, 'lifting fingers after a twist is not a tap');

    g.pointerDown(1, 0, 0); now += 1000; g.pointerUp(1, 0, 0);
    assert.strictEqual(taps.length, 1, 'long press is not a tap');
  });
});

// ---------------------------------------------------------------- XR session lifecycle
describe('AR: XR session lifecycle', () => {
  function fakeXr({ fail } = {}) {
    let requests = 0;
    const listeners = {};
    const sess = {
      enabledFeatures: ['hit-test', 'dom-overlay', 'light-estimation'],
      domOverlayState: { type: 'screen' },
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
      removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter(f => f !== fn); },
      requestReferenceSpace: async () => ({ type: 'viewer' }),
      end: async () => { (listeners.end || []).slice().forEach(f => f()); },
      fire: (t) => (listeners[t] || []).slice().forEach(f => f())
    };
    const xr = {
      requestSession: async (mode, init) => {
        requests++;
        xr.lastInit = init;
        await new Promise(r => setTimeout(r, 5));
        if (fail) throw Object.assign(new Error('denied'), { name: fail });
        return sess;
      }
    };
    const renderer = { xr: { setReferenceSpaceType() {}, setSession: async () => {}, getReferenceSpace: () => ({ type: 'local' }) } };
    return { xr, sess, renderer, count: () => requests };
  }

  it('requests immersive-ar with hit-test required and dom-overlay/light-estimation optional; never twice', async () => {
    const f = fakeXr();
    const m = new session.XRSessionManager({ xr: f.xr, renderer: f.renderer, overlayRoot: { id: 'overlay' } });
    const [s1, s2] = await Promise.all([m.start(), m.start()]);
    assert.strictEqual(s1, s2);
    assert.strictEqual(f.count(), 1, 'duplicate XR sessions are prevented');
    assert.deepStrictEqual(f.xr.lastInit.requiredFeatures, ['hit-test']);
    assert.ok(f.xr.lastInit.optionalFeatures.includes('dom-overlay'));
    assert.ok(f.xr.lastInit.optionalFeatures.includes('light-estimation'));
    assert.deepStrictEqual(f.xr.lastInit.domOverlay, { root: { id: 'overlay' } });
    assert.strictEqual(m.isRunning, true);
    assert.strictEqual(m.domOverlayActive, true);
    await m.start();
    assert.strictEqual(f.count(), 1);
  });

  it('distinguishes user exit from system interruption and is idempotent on end()', async () => {
    const f = fakeXr();
    const m = new session.XRSessionManager({ xr: f.xr, renderer: f.renderer });
    const ends = [];
    m.on('end', (e) => ends.push(e.byUser));
    await m.start();
    f.sess.fire('end'); // system ended it (app switch / tracking loss)
    assert.deepStrictEqual(ends, [false]);
    assert.strictEqual(m.state, 'idle');
    await m.start();
    await m.end();
    await m.end();
    assert.deepStrictEqual(ends, [false, true]);
  });

  it('maps permission and support errors to actionable codes', async () => {
    for (const [name, code] of [['NotAllowedError', 'PERMISSION_DENIED'], ['NotSupportedError', 'UNSUPPORTED'], ['SecurityError', 'PERMISSION_DENIED'], ['Weird', 'START_FAILED']]) {
      const f = fakeXr({ fail: name });
      const m = new session.XRSessionManager({ xr: f.xr, renderer: f.renderer });
      await assert.rejects(m.start(), (e) => e.code === code, name);
      assert.strictEqual(m.state, 'idle');
    }
  });
});

// ---------------------------------------------------------------- capabilities & fallbacks
describe('AR: capability detection and platform strategy', () => {
  const UA = {
    androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
    zalo: 'Mozilla/5.0 (Linux; Android 13; SM-A536E; wv) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 Zalo iOS/1.0'
  };
  const doc = (arRel) => ({
    createElement: (t) => (t === 'a'
      ? { relList: { supports: (v) => arRel && v === 'ar' } }
      : { getContext: () => ({}) })
  });
  const detect = (ua, { xr = false, arRel = false, platform = '', touch = 0, secure = true } = {}) => capability.detectCapabilities({
    navigator: { userAgent: ua, platform, maxTouchPoints: touch, xr: xr ? { isSessionSupported: async (m) => m === 'immersive-ar' } : undefined },
    window: { isSecureContext: secure },
    document: doc(arRel)
  });
  const manifest = (usdz) => ({ model: { usdzUrl: usdz ? 'x.usdz' : null } });

  it('Android Chrome with ARCore → WebXR (Scene Viewer kept as alternative)', async () => {
    const caps = await detect(UA.androidChrome, { xr: true });
    const exp = capability.chooseExperience(caps, manifest(false));
    assert.strictEqual(exp.mode, 'webxr');
    assert.deepStrictEqual(exp.alternatives, ['scene-viewer']);
  });

  it('Android without WebXR → Scene Viewer; in-app browser → explicit 3D-only explanation', async () => {
    assert.strictEqual(capability.chooseExperience(await detect(UA.androidChrome), manifest(false)).mode, 'scene-viewer');
    const zalo = capability.chooseExperience(await detect(UA.zalo), manifest(false));
    assert.deepStrictEqual([zalo.mode, zalo.reason], ['preview-3d', 'IN_APP_BROWSER']);
  });

  it('iOS → Quick Look only with a USDZ asset; otherwise honest 3D preview (no fake AR)', async () => {
    const caps = await detect(UA.iphone, { arRel: true });
    assert.strictEqual(capability.chooseExperience(caps, manifest(true)).mode, 'quick-look');
    const noUsdz = capability.chooseExperience(caps, manifest(false));
    assert.deepStrictEqual([noUsdz.mode, noUsdz.reason], ['preview-3d', 'IOS_NO_USDZ_ASSET']);
    const ipad = await detect('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari/605.1.15', { platform: 'MacIntel', touch: 5, arRel: true });
    assert.strictEqual(ipad.platform.ios, true, 'iPadOS desktop UA is still iOS');
  });

  it('desktop → 3D preview; insecure context never offers AR', async () => {
    const d = capability.chooseExperience(await detect(UA.desktop), manifest(false));
    assert.deepStrictEqual([d.mode, d.reason], ['preview-3d', 'DESKTOP']);
    const insecure = capability.chooseExperience(await detect(UA.androidChrome, { xr: true, secure: false }), manifest(false));
    assert.deepStrictEqual([insecure.mode, insecure.reason], ['preview-3d', 'INSECURE_CONTEXT']);
  });

  it('builds a Scene Viewer intent that keeps real scale and requires HTTPS', () => {
    const intent = fallback.buildSceneViewerIntent('https://sigma-car.pages.dev/assets/models/ar/tesla_cybertruck_ar_v1.glb', { title: 'Tesla Cybertruck', fallbackUrl: 'https://sigma-car.pages.dev/ar/tesla-cybertruck' });
    assert.match(intent, /^intent:\/\/arvr\.google\.com\/scene-viewer\/1\.0\?/);
    assert.match(intent, /mode=ar_preferred/);
    assert.match(intent, /resizable=false/);
    assert.match(intent, /S\.browser_fallback_url=https%3A%2F%2Fsigma-car/);
    assert.throws(() => fallback.buildSceneViewerIntent('http://insecure/x.glb'));
  });
});

// ---------------------------------------------------------------- manifest + config sync
describe('AR: manifest validation, source fallback and configuration sync', () => {
  const good = () => ({
    schemaVersion: 1, vehicleId: 'tesla-cybertruck', name: 'Tesla Cybertruck',
    model: { glbUrl: 'assets/models/ar/tesla_cybertruck_ar_v1.glb', scaleMode: 'certified', dimensionsMeters: { length: 5.682, width: 2.2, height: 1.791 } },
    colors: [{ index: 0, name: 'Steel', hex: '#94A3B8' }],
    variants: [], wheels: [{ id: 'wheel-21-sport', label: '21"', finish: { color: '#D0D5DD', roughness: 0.2, metalness: 0.9 } }],
    materials: { body: ['Material_Body'], rims: ['Material_Rims'] },
    animations: { openDoors: null }, hotspots: [{ id: 'h', name: 'H', position: [1, 0.5, 0] }],
    features: { changeColor: true, changeWheels: true, doorAnimations: true, hotspots: true }
  });

  it('accepts a valid manifest and re-derives features from the data actually present', () => {
    const m = manifestSchema.validateManifest(good(), 'tesla-cybertruck');
    assert.strictEqual(m.features.changeColor, true);
    assert.strictEqual(m.features.doorAnimations, false, 'declared true but no clip name → disabled');
    const noBody = good();
    noBody.materials.body = [];
    assert.strictEqual(manifestSchema.validateManifest(noBody, 'tesla-cybertruck').features.changeColor, false);
  });

  it('rejects unsafe or mismatched manifests', () => {
    const bad = good();
    bad.model.glbUrl = 'javascript:alert(1)';
    assert.throws(() => manifestSchema.validateManifest(bad, 'tesla-cybertruck'), (e) => e.code === 'INVALID_MANIFEST');
    assert.throws(() => manifestSchema.validateManifest(good(), 'other-car'), /không khớp/);
    const h = good();
    h.hotspots = [{ name: '<img onerror>', position: [1e9, 0, 0] }];
    assert.strictEqual(manifestSchema.validateManifest(h, 'tesla-cybertruck').hotspots.length, 0, 'out-of-range hotspot dropped');
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
