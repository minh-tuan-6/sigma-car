// tests/test_ar_full_suite.js
// Comprehensive Acceptance Test Suite for Full AR Showroom Implementation (Phases 1-6)

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

console.log('🧪 RUNNING FULL AR IMPLEMENTATION TEST SUITE (PHASES 1-6)...\n');

let total = 0;
let passed = 0;

function it(desc, fn) {
  total++;
  try {
    fn();
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(`     ${err.stack || err.message}`);
  }
}

// 1. Syntax & Compilation Check
it('All JavaScript modules compile without syntax errors', () => {
  const files = [
    'server.js',
    'scripts/build_dist.js',
    'scripts/normalize_cybertruck_ar.js',
    'js/ar-manifest.js',
    'js/ar-adapter.js',
    'js/car-3d-viewer.js',
    'js/data.js'
  ];
  files.forEach(f => {
    const code = fs.readFileSync(path.resolve(f), 'utf8');
    assert.doesNotThrow(() => {
      new vm.Script(code, { filename: f });
    }, `Syntax error in ${f}`);
  });
});

// 2. Phase 1 - Asset Gate & Calibrated GLB Models
it('Calibrated Cybertruck AR GLB models have exact 1:1 physical dimensions (5.682m), centered origin and Y=0 contact', () => {
  const threeCode = fs.readFileSync(path.resolve('js/libs/three.min.js'), 'utf8');
  const gltfLoaderCode = fs.readFileSync(path.resolve('js/libs/GLTFLoader.js'), 'utf8');

  const context = {
    window: {}, console, Math, setTimeout, clearTimeout,
    ArrayBuffer, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, DataView, TextDecoder
  };
  context.self = context.window;
  vm.createContext(context);
  vm.runInContext(threeCode, context);
  vm.runInContext(gltfLoaderCode, context);
  const THREE = context.THREE || context.window.THREE;

  const files = [
    'assets/models/ar/tesla_cybertruck_ar_v1.glb',
    'assets/models/ar/tesla_cybertruck_ar_stealth_black.glb',
    'assets/models/ar/tesla_cybertruck_ar_ceramic_white.glb',
    'assets/models/ar/tesla_cybertruck_ar_tactical_green.glb'
  ];

  files.forEach(f => {
    const glbBuffer = fs.readFileSync(path.resolve(f));
    const loader = new THREE.GLTFLoader();
    loader.parse(glbBuffer.buffer.slice(glbBuffer.byteOffset, glbBuffer.byteOffset + glbBuffer.byteLength), '', (gltf) => {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      assert(Math.abs(size.z - 5.682) < 0.005, `${f}: Length should be 5.682m, got ${size.z}`);
      assert(size.x > 1.95 && size.x < 2.05, `${f}: Width should be ~1.996m, got ${size.x}`);
      assert(size.y > 1.85 && size.y < 1.92, `${f}: Height should be ~1.886m, got ${size.y}`);
      assert(Math.abs(center.x) < 0.001, `${f}: Center X should be 0.0, got ${center.x}`);
      assert(Math.abs(center.z) < 0.001, `${f}: Center Z should be 0.0, got ${center.z}`);
      assert(Math.abs(box.min.y) < 0.001, `${f}: Min Y should be 0.0, got ${box.min.y}`);
    });
  });
});

// 3. Phase 2 - State Resolver & AR Manifest Integration
it('AR Manifest provides accurate vehicle verification and dynamic configuration resolution', () => {
  const manifest = require(path.resolve('js/ar-manifest.js'));
  assert.strictEqual(manifest.isVehicleArVerified('tesla-cybertruck'), true);
  assert.strictEqual(manifest.isVehicleArVerified('honda-civic'), false);

  // Default color 0 (Stainless Steel)
  const cfg0 = manifest.getVehicleArConfig('tesla-cybertruck', 0);
  assert.strictEqual(cfg0.readiness, 'verified');
  assert.strictEqual(cfg0.hex, '#94A3B8');
  assert(cfg0.glbUrl.includes('tesla_cybertruck_ar_v1.glb'));
  assert.strictEqual(cfg0.dimensionsMeters.length, 5.682);

  // Color 1 (Stealth Black)
  const cfg1 = manifest.getVehicleArConfig('tesla-cybertruck', 1);
  assert.strictEqual(cfg1.hex, '#1E293B');
  assert(cfg1.glbUrl.includes('tesla_cybertruck_ar_stealth_black.glb'));

  // Color 2 (Ceramic White)
  const cfg2 = manifest.getVehicleArConfig('tesla-cybertruck', 2);
  assert.strictEqual(cfg2.hex, '#F1F5F9');
  assert(cfg2.glbUrl.includes('tesla_cybertruck_ar_ceramic_white.glb'));

  // Color 3 (Tactical Green)
  const cfg3 = manifest.getVehicleArConfig('tesla-cybertruck', 3);
  assert.strictEqual(cfg3.hex, '#3F6212');
  assert(cfg3.glbUrl.includes('tesla_cybertruck_ar_tactical_green.glb'));

  // Fallback for unverified vehicle
  const fallback = manifest.getVehicleArConfig('toyota-camry');
  assert.strictEqual(fallback.readiness, 'unverified');
  assert(fallback.glbUrl.includes('sigma-car-3d.glb'));
});

// 4. Phase 3 - AR Core Integration & Adapter API
it('SigmaARAdapter exists and exposes lifecycle, AR activation and material APIs', () => {
  const adapter = require(path.resolve('js/ar-adapter.js'));
  assert(typeof adapter.init === 'function', 'init must be a function');
  assert(typeof adapter.activateAR === 'function', 'activateAR must be a function');
  assert(typeof adapter.setVehicleColor === 'function', 'setVehicleColor must be a function');
  assert(typeof adapter.dispose === 'function', 'dispose must be a function');
  assert(typeof adapter.isSupported === 'function', 'isSupported must be a function');

  // Verify model-viewer library is self-hosted locally
  assert(fs.existsSync(path.resolve('js/libs/model-viewer.min.js')), 'js/libs/model-viewer.min.js must exist');
  const mvStat = fs.statSync(path.resolve('js/libs/model-viewer.min.js'));
  assert(mvStat.size > 1000000, 'model-viewer.min.js size should be > 1MB');
});

// 5. Phase 4 - AppState & Configuration Synchronization
it('AppState and router functions in js/app.js synchronize vehicle configuration across views', () => {
  const appCode = fs.readFileSync(path.resolve('js/app.js'), 'utf8');

  // Check state presence
  assert(appCode.includes('vehicleConfigs: {}'), 'AppState must declare vehicleConfigs');
  assert(appCode.includes('function getVehicleById(carId)'), 'Must define getVehicleById resolver');
  assert(appCode.includes('function getVehicleConfig(carId)'), 'Must define getVehicleConfig');
  assert(appCode.includes('function setVehicleConfig(carId, updates)'), 'Must define setVehicleConfig');

  // Check router deep-link targetHash handling
  assert(appCode.includes("route === 'detail' || route === 'vehicle-detail' || route === 'vr-ar' || route === 'ar-live'"), 'Router must handle carId hash parameter');

  // Check renderCurrentRoute disposal
  assert(appCode.includes('window.SigmaARAdapter.dispose()'), 'renderCurrentRoute must dispose SigmaARAdapter when leaving ar-live');
});

// 6. Phase 5 - Mobile Optimization & CSS Integrity
it('css/style.css includes model-viewer styling and mobile responsive rules', () => {
  const css = fs.readFileSync(path.resolve('css/style.css'), 'utf8');
  assert(css.includes('.ar-model-viewer-element'), 'Missing .ar-model-viewer-element style');
  assert(css.includes('.ar-model-loading-poster'), 'Missing .ar-model-loading-poster style');
  assert(css.includes('@media (max-width: 768px)'), 'Missing 768px media query');
  assert(css.includes('min-height: 440px'), 'Missing responsive height for mobile AR stage');
});

// 7. Phase 6 - Build Distribution Packaging
it('scripts/build_dist.js bundles all AR assets, models, libraries and manifests into dist/', () => {
  const distDir = path.resolve('dist');
  assert(fs.existsSync(distDir), 'dist/ directory must exist');

  assert(fs.existsSync(path.join(distDir, 'index.html')), 'dist/index.html missing');
  assert(fs.existsSync(path.join(distDir, '_headers')), 'dist/_headers missing');
  assert(fs.existsSync(path.join(distDir, 'js/ar-manifest.js')), 'dist/js/ar-manifest.js missing');
  assert(fs.existsSync(path.join(distDir, 'js/ar-adapter.js')), 'dist/js/ar-adapter.js missing');
  assert(fs.existsSync(path.join(distDir, 'js/libs/model-viewer.min.js')), 'dist/js/libs/model-viewer.min.js missing');
  assert(fs.existsSync(path.join(distDir, 'data/ar-manifest.json')), 'dist/data/ar-manifest.json missing');

  const arModelFiles = [
    'tesla_cybertruck_ar_v1.glb',
    'tesla_cybertruck_ar_stealth_black.glb',
    'tesla_cybertruck_ar_ceramic_white.glb',
    'tesla_cybertruck_ar_tactical_green.glb'
  ];
  arModelFiles.forEach(f => {
    assert(fs.existsSync(path.join(distDir, 'assets/models/ar', f)), `dist/assets/models/ar/${f} missing`);
  });
});

console.log(`\n======================================================`);
console.log(`FULL SUITE RESULTS: ${passed}/${total} Passed (${passed === total ? '100% SUCCESS' : 'FAILED'})`);
console.log(`======================================================\n`);

if (passed !== total) {
  process.exit(1);
}
