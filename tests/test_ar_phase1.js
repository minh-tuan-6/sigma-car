// tests/test_ar_phase1.js
// Automated Acceptance Test Suite for AR Implementation Phase 1

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

console.log('🧪 RUNNING AR PHASE 1 ACCEPTANCE TESTS...\n');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

// 1. Headers Configuration Test
test('_headers configuration removes duplicate CORS and adds USDZ/AR rules', () => {
  const content = fs.readFileSync(path.resolve('_headers'), 'utf8');
  assert(content.includes('/assets/models/ar/*.glb'), 'Should have /assets/models/ar/*.glb');
  assert(content.includes('/assets/models/*.usdz'), 'Should have /assets/models/*.usdz');
  assert(content.includes('model/vnd.usdz+zip'), 'Should have model/vnd.usdz+zip MIME type');

  // Verify no duplicate Access-Control-Allow-Origin under /assets/models/*.glb
  const lines = content.split('\n');
  let inGlbBlock = false;
  let glbCorsCount = 0;
  lines.forEach(l => {
    if (l.trim().startsWith('/assets/models/*.glb')) inGlbBlock = true;
    else if (l.trim().startsWith('/') && !l.trim().startsWith('/assets/models/*.glb')) inGlbBlock = false;
    if (inGlbBlock && l.includes('Access-Control-Allow-Origin')) glbCorsCount++;
  });
  assert.strictEqual(glbCorsCount, 0, 'Should not duplicate CORS header inside /assets/models/*.glb block');
});

// 2. Server.js MIME Types Test
test('server.js supports .glb, .gltf, and .usdz MIME types', () => {
  const content = fs.readFileSync(path.resolve('server.js'), 'utf8');
  assert(content.includes("'.glb': 'model/gltf-binary'"), 'Missing .glb MIME type');
  assert(content.includes("'.gltf': 'model/gltf+json'"), 'Missing .gltf MIME type');
  assert(content.includes("'.usdz': 'model/vnd.usdz+zip'"), 'Missing .usdz MIME type');
});

// 3. Normalized AR GLB Models Existence
test('All 4 calibrated Cybertruck AR models exist in assets/models/ar/', () => {
  const files = [
    'assets/models/ar/tesla_cybertruck_ar_v1.glb',
    'assets/models/ar/tesla_cybertruck_ar_stealth_black.glb',
    'assets/models/ar/tesla_cybertruck_ar_ceramic_white.glb',
    'assets/models/ar/tesla_cybertruck_ar_tactical_green.glb'
  ];
  files.forEach(f => {
    const p = path.resolve(f);
    assert(fs.existsSync(p), `File does not exist: ${f}`);
    const stat = fs.statSync(p);
    assert(stat.size > 100000, `File size too small (${stat.size} bytes): ${f}`);
  });
});

// 4. Three.js Physical Scale & Alignment Calibration
test('AR GLB model has 1:1 physical scale (5.682m), centered origin and Y=0 ground contact', () => {
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

  const glbBuffer = fs.readFileSync(path.resolve('assets/models/ar/tesla_cybertruck_ar_v1.glb'));
  const loader = new THREE.GLTFLoader();

  loader.parse(glbBuffer.buffer.slice(glbBuffer.byteOffset, glbBuffer.byteOffset + glbBuffer.byteLength), '', (gltf) => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Check Length (Z)
    assert(Math.abs(size.z - 5.682) < 0.005, `Length should be 5.682m, got ${size.z}`);
    // Check Width (X)
    assert(size.x > 1.95 && size.x < 2.05, `Width should be ~1.996m, got ${size.x}`);
    // Check Height (Y)
    assert(size.y > 1.85 && size.y < 1.92, `Height should be ~1.886m, got ${size.y}`);
    // Check Center (X, Z)
    assert(Math.abs(center.x) < 0.001, `Center X should be 0.0, got ${center.x}`);
    assert(Math.abs(center.z) < 0.001, `Center Z should be 0.0, got ${center.z}`);
    // Check Ground Contact (Min Y)
    assert(Math.abs(box.min.y) < 0.001, `Min Y should be 0.0 (ground plane contact), got ${box.min.y}`);
  });
});

// 5. AR Manifest Data Integrity
test('AR Manifest contains valid verified Cybertruck schema and configuration bindings', () => {
  const jsonContent = JSON.parse(fs.readFileSync(path.resolve('data/ar-manifest.json'), 'utf8'));
  assert(jsonContent.vehicles['tesla-cybertruck'], 'Missing tesla-cybertruck in manifest');
  const ct = jsonContent.vehicles['tesla-cybertruck'];
  assert.strictEqual(ct.readiness, 'verified');
  assert.strictEqual(ct.dimensionsMeters.length, 5.682);
  assert.strictEqual(ct.dimensionsMeters.width, 2.200);
  assert.strictEqual(ct.dimensionsMeters.height, 1.791);
  assert.strictEqual(Object.keys(ct.configurations).length, 4);

  // Check js/ar-manifest.js helper
  const jsManifest = require(path.resolve('js/ar-manifest.js'));
  assert(jsManifest.isVehicleArVerified('tesla-cybertruck'), 'isVehicleArVerified should be true for Cybertruck');
  assert(!jsManifest.isVehicleArVerified('toyota-camry'), 'isVehicleArVerified should be false for unverified vehicle');
  const config = jsManifest.getVehicleArConfig('tesla-cybertruck', 1);
  assert.strictEqual(config.readiness, 'verified');
  assert.strictEqual(config.hex, '#1E293B');
  assert(config.glbUrl.includes('stealth_black'), 'Should return stealth black GLB for color 1');
});

// 6. index.html Script Injection
test('index.html includes js/ar-manifest.js script tag', () => {
  const html = fs.readFileSync(path.resolve('index.html'), 'utf8');
  assert(html.includes('js/ar-manifest.js'), 'index.html should include js/ar-manifest.js');
});

console.log(`\n========================================`);
console.log(`TEST SUMMARY: ${passedTests}/${totalTests} Passed (${passedTests === totalTests ? '100% SUCCESS' : 'FAILED'})`);
console.log(`========================================`);

if (passedTests !== totalTests) {
  process.exit(1);
}
