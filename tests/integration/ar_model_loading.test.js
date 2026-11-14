// Integration: ModelLoader over real HTTP.
//   * same-origin GLB served by server.js (the real Cybertruck AR asset)
//   * an "external CDN" (separate origin) serving a .gltf with a separate .bin, an HTML-masquerading path,
//     a missing dependency, and a slow stream for cancellation.
// Draco/KTX2 decoding needs Web Workers/WASM in a browser and is exercised by the browser E2E suite instead.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const { startTestServer } = require('../helpers/test-app');

const ROOT = path.resolve(__dirname, '..', '..');

// three's FileLoader (used for external .gltf buffers) constructs ProgressEvent, which browsers provide but Node does not.
if (typeof globalThis.ProgressEvent === 'undefined') {
  globalThis.ProgressEvent = class ProgressEvent extends Event {
    constructor(type, init = {}) { super(type); this.loaded = init.loaded || 0; this.total = init.total || 0; this.lengthComputable = Boolean(init.lengthComputable); }
  };
}
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

// Minimal valid glTF: one quad-ish triangle set spanning a 4.6 m × 1.5 m × 1.9 m volume, material "Body_Paint".
function buildGltf(binName) {
  const pos = new Float32Array([
    -0.95, 0, -2.3, 0.95, 0, -2.3, 0.95, 1.5, 2.3,
    -0.95, 0, -2.3, 0.95, 1.5, 2.3, -0.95, 1.5, 2.3
  ]);
  const bin = Buffer.from(pos.buffer);
  const gltf = {
    asset: { version: '2.0', generator: 'sigmacar-test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Body' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ name: 'Body_Paint', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] } }],
    buffers: [{ uri: binName, byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 6, type: 'VEC3', min: [-0.95, 0, -2.3], max: [0.95, 1.5, 2.3] }]
  };
  return { json: JSON.stringify(gltf), bin };
}

describe('AR model loading over HTTP', () => {
  let app;
  let origin;
  let cdn;
  let cdnOrigin;
  const cdnHits = new Map();
  let ModelLoader, AssetCache, normalizeVehicle, MaterialConfigurator;

  before(async () => {
    app = await startTestServer({ mode: 'memory', reseed: true });
    origin = new URL(app.baseUrl).origin;
    ({ ModelLoader } = await mod('js/ar/models/model-loader.js'));
    ({ AssetCache } = await mod('js/ar/models/asset-cache.js'));
    ({ normalizeVehicle } = await mod('js/ar/models/model-normalizer.js'));
    ({ MaterialConfigurator } = await mod('js/ar/vehicle/material-configurator.js'));

    const good = buildGltf('car.bin');
    const broken = buildGltf('missing.bin');
    cdn = http.createServer((req, res) => {
      const p = req.url.split('?')[0];
      cdnHits.set(p, (cdnHits.get(p) || 0) + 1);
      const cors = { 'Access-Control-Allow-Origin': '*' };
      if (p === '/cars/car.gltf') return res.writeHead(200, { ...cors, 'Content-Type': 'model/gltf+json' }).end(good.json);
      if (p === '/cars/car.bin') return res.writeHead(200, { ...cors, 'Content-Type': 'application/octet-stream' }).end(good.bin);
      if (p === '/cars/broken.gltf') return res.writeHead(200, { ...cors, 'Content-Type': 'model/gltf+json' }).end(broken.json);
      if (p === '/cars/spa.glb') return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!DOCTYPE html><html></html>');
      if (p === '/cars/slow.glb') {
        res.writeHead(200, { ...cors, 'Content-Type': 'model/gltf-binary', 'Content-Length': '1000000' });
        res.write(Buffer.alloc(1000));
        return; // never finishes
      }
      res.writeHead(404, cors).end();
    });
    await new Promise(r => cdn.listen(0, '127.0.0.1', r));
    cdnOrigin = `http://127.0.0.1:${cdn.address().port}`;
  });

  after(async () => {
    if (cdn) {
      cdn.closeAllConnections();
      await new Promise(r => cdn.close(r));
    }
    if (app) await app.close();
  });

  // Same base the AR page uses: the site root (manifest paths are root-relative, not relative to /ar/:id).
  const newLoader = () => new ModelLoader({ cache: new AssetCache({ cachesImpl: null }), baseUrl: `${origin}/` });

  it('loads the real Cybertruck AR GLB and confirms its certified 1:1 scale from geometry', async () => {
    const progress = [];
    const res = await newLoader().load('assets/models/ar/tesla_cybertruck_ar_v1.glb', { onProgress: (p) => progress.push(p.phase) });
    assert.strictEqual(res.kind, 'glb');
    assert.ok(res.bytes > 100000);
    assert.ok(progress.includes('download') && progress.includes('done'));

    const norm = normalizeVehicle(res.scene, { scaleMode: 'certified', dimensionsMeters: { length: 5.682, width: 2.2, height: 1.791 } });
    assert.strictEqual(norm.scale, 1, 'certified asset must not be rescaled');
    assert.deepStrictEqual(norm.warnings, []);
    assert.ok(Math.abs(norm.sizeMeters.length - 5.682) < 0.06, `length ${norm.sizeMeters.length}`);

    const mats = new MaterialConfigurator(norm.pivot, { body: ['Material_Body'], rims: ['Material_Rims'], protectedPatterns: ['glass', 'tire', 'light'] });
    assert.strictEqual(mats.capabilities.paint, true);
    assert.strictEqual(mats.capabilities.rims, true);
  });

  it('loads an external-origin .gltf and resolves its separate .bin relative to the model URL', async () => {
    const res = await newLoader().load(`${cdnOrigin}/cars/car.gltf`);
    assert.strictEqual(res.kind, 'gltf');
    assert.deepStrictEqual(res.info.externalUris, ['car.bin']);
    assert.strictEqual(cdnHits.get('/cars/car.bin'), 1);
    const norm = normalizeVehicle(res.scene, { scaleMode: 'fit-to-length', dimensionsMeters: { length: 4.6, width: 1.9, height: 1.5 } });
    assert.ok(Math.abs(norm.sizeMeters.length - 4.6) < 1e-3);
    let names = [];
    res.scene.traverse(o => { if (o.material) names.push(o.material.name); });
    assert.deepStrictEqual(names, ['Body_Paint']);
  });

  it('reports a missing .bin dependency as MISSING_RESOURCE', async () => {
    await assert.rejects(newLoader().load(`${cdnOrigin}/cars/broken.gltf`), (e) => e.code === 'MISSING_RESOURCE' || e.code === 'PARSE_FAILED');
  });

  it('reports 404 and SPA-HTML responses distinctly', async () => {
    await assert.rejects(newLoader().load(`${cdnOrigin}/cars/nope.glb`), (e) => e.code === 'NOT_FOUND');
    await assert.rejects(newLoader().load(`${cdnOrigin}/cars/spa.glb`), (e) => e.code === 'NOT_A_MODEL');
    await assert.rejects(newLoader().load('ftp://x/car.glb'), (e) => e.code === 'INVALID_MODEL_URL');
  });

  it('cancels an in-flight download', async () => {
    const ac = new AbortController();
    const p = newLoader().load(`${cdnOrigin}/cars/slow.glb`, { signal: ac.signal, timeoutMs: 20000 });
    setTimeout(() => ac.abort(), 100);
    await assert.rejects(p, (e) => e.code === 'ABORTED');
  });

  it('serves repeated loads (e.g. colour variant back-and-forth) from cache without new requests', async () => {
    const loader = newLoader();
    const before = cdnHits.get('/cars/car.gltf') || 0;
    await loader.load(`${cdnOrigin}/cars/car.gltf`);
    await loader.load(`${cdnOrigin}/cars/car.gltf`);
    assert.strictEqual(cdnHits.get('/cars/car.gltf') - before, 1);
    assert.strictEqual(loader.cache.stats.memoryHits, 1);
  });
});
