// tests/test_models.js
// Integrity, orientation, material, and Cloudflare size verification for all 24 3D vehicle models + 4 AR models

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(ROOT, 'assets/models');
const AR_MODELS_DIR = path.join(ROOT, 'assets/models/ar');
const CF_PAGES_MAX_BYTES = 25 * 1024 * 1024;

let passed = 0;
let total = 0;

function it(desc, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  PASS: ${desc}`);
  } catch (err) {
    console.error(`  FAIL: ${desc}`);
    console.error(`     ${err.stack || err.message}`);
  }
}

function readGlbJson(filePath) {
  const buf = fs.readFileSync(filePath);
  assert(buf.length >= 20, `${filePath} too small`);
  assert.strictEqual(buf.readUInt32LE(0), 0x46546C67, `${filePath} bad GLB magic`);
  assert.strictEqual(buf.readUInt32LE(4), 2, `${filePath} expected GLB version 2`);
  assert.strictEqual(buf.readUInt32LE(8), buf.length, `${filePath} header byteLength mismatch`);
  const jsonLen = buf.readUInt32LE(12);
  assert.strictEqual(buf.readUInt32LE(16), 0x4E4F534A, `${filePath} chunk 0 must be JSON`);
  assert.strictEqual(jsonLen % 4, 0, `${filePath} JSON chunk length must be 4-byte aligned`);
  return JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
}

console.log('RUNNING 3D MODEL INTEGRITY & VIEWER HARDENING TEST SUITE...\n');

const carGlbs = fs.readdirSync(MODELS_DIR).filter(f => f.endsWith('.glb')).sort();
const arGlbs = fs.readdirSync(AR_MODELS_DIR).filter(f => f.endsWith('.glb')).sort();

it('discovers all 24 car GLBs and 4 AR Cybertruck GLBs under 25 MiB Cloudflare limit', () => {
  assert.strictEqual(carGlbs.length, 24, `Expected 24 car GLBs, found ${carGlbs.length}`);
  assert.strictEqual(arGlbs.length, 4, `Expected 4 AR GLBs, found ${arGlbs.length}`);
  for (const f of carGlbs) {
    const sz = fs.statSync(path.join(MODELS_DIR, f)).size;
    assert(sz < CF_PAGES_MAX_BYTES, `${f} exceeds 25 MiB (${sz} bytes)`);
    readGlbJson(path.join(MODELS_DIR, f));
  }
  for (const f of arGlbs) {
    const sz = fs.statSync(path.join(AR_MODELS_DIR, f)).size;
    assert(sz < CF_PAGES_MAX_BYTES, `ar/${f} exceeds 25 MiB (${sz} bytes)`);
    readGlbJson(path.join(AR_MODELS_DIR, f));
  }
});

it('every vehicle glbUrl in js/ar-manifest.js exists on disk', () => {
  const txt = fs.readFileSync(path.join(ROOT, 'js/ar-manifest.js'), 'utf8');
  const urls = [...txt.matchAll(/"glbUrl":\s*"([^"]+)"/g)].map(m => m[1]);
  assert(urls.length >= 24, `Expected >=24 glbUrl entries in ar-manifest.js, found ${urls.length}`);
  for (const rel of urls) {
    assert(fs.existsSync(path.join(ROOT, rel)), `Missing GLB referenced in ar-manifest.js: ${rel}`);
  }
});

it('vinfast_vf3.glb has SigmaRootFix -90 deg X upright rotation and non-metallic rubber Tire.002', () => {
  const g = readGlbJson(path.join(MODELS_DIR, 'vinfast_vf3.glb'));
  const rootFix = (g.nodes || []).find(n => n.name === 'SigmaRootFix');
  assert(rootFix && Array.isArray(rootFix.rotation), 'Missing SigmaRootFix root rotation on vinfast_vf3.glb');
  assert(Math.abs(rootFix.rotation[0] + Math.SQRT1_2) < 1e-4 && Math.abs(rootFix.rotation[3] - Math.SQRT1_2) < 1e-4, 'Expected -90deg X quaternion');
  const tireMat = g.materials.find(m => m.name === 'Tire.002');
  assert(tireMat && tireMat.pbrMetallicRoughness.metallicFactor <= 0.1, 'Tire.002 metallicFactor should be <= 0.1');
});

it('civic_rs, lucid_air_sapphire, accord_euro_r, aventador_sv, and suzuki_ciaz are oriented along +Z', () => {
  const expected = {
    'honda_civic_rs.glb': [0, -Math.SQRT1_2, 0, Math.SQRT1_2],
    'lucid_air_sapphire.glb': [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    'honda_accord_euro_r.glb': [0, 1, 0, 0],
    'lamborghini_aventador_sv.glb': [0, 1, 0, 0],
    'suzuki_ciaz_2021.glb': [0, 1, 0, 0],
  };
  for (const [fname, q] of Object.entries(expected)) {
    const g = readGlbJson(path.join(MODELS_DIR, fname));
    const rootFix = (g.nodes || []).find(n => n.name === 'SigmaRootFix');
    assert(rootFix && Array.isArray(rootFix.rotation), `Missing SigmaRootFix in ${fname}`);
    q.forEach((v, idx) => assert(Math.abs(rootFix.rotation[idx] - v) < 1e-4, `${fname} bad rotation[${idx}]`));
    assert(g.materials.every(m => m.doubleSided === true), `${fname} must have doubleSided: true`);
  }
});

it('honda_civic_type_r_2018.glb sets solid materials OPAQUE + doubleSided and removes COLOR_0 cleanly from Draco & prims', () => {
  const g = readGlbJson(path.join(MODELS_DIR, 'honda_civic_type_r_2018.glb'));
  g.materials.forEach((m) => {
    assert.strictEqual(m.doubleSided, true, `${m.name} must be doubleSided`);
    if (m.name === 'Honda_CivicTypeRElite_2017Window_Material' || m.name === 'RED_GLASS') {
      assert.strictEqual(m.alphaMode, 'BLEND', `${m.name} glass must keep BLEND`);
    } else {
      assert.strictEqual(m.alphaMode, 'OPAQUE', `${m.name} must be OPAQUE`);
    }
  });
  (g.meshes || []).forEach(mesh => {
    (mesh.primitives || []).forEach(p => {
      assert(!p.attributes || !('COLOR_0' in p.attributes), `${mesh.name} should not have broken COLOR_0`);
      const dracoAttrs = p.extensions?.KHR_draco_mesh_compression?.attributes || {};
      assert(!('COLOR_0' in dracoAttrs), `${mesh.name} Draco attributes should not reference stripped COLOR_0`);
      for (const k of Object.keys(dracoAttrs)) {
        assert(p.attributes && k in p.attributes, `${mesh.name} Draco attribute ${k} missing from primitive attributes`);
      }
    });
  });
});

it('vinfast_fadil.glb switches solid Desirefxme* materials to OPAQUE and keeps glass BLEND', () => {
  const g = readGlbJson(path.join(MODELS_DIR, 'vinfast_fadil.glb'));
  g.materials.forEach(m => {
    assert.strictEqual(m.doubleSided, true);
    if (m.name === 'Desirefxme0201Mtl.002') {
      assert.strictEqual(m.alphaMode, 'BLEND');
    } else {
      assert.strictEqual(m.alphaMode, 'OPAQUE', `Fadil ${m.name} should be OPAQUE`);
    }
  });
});

it('rolls_royce_boat_tail.glb and honda_civic_eg6_1991.glb have distinct realistic PBR materials (not blank chalk white)', () => {
  const rr = readGlbJson(path.join(MODELS_DIR, 'rolls_royce_boat_tail.glb'));
  const rrTire = rr.materials.find(m => m.name === 'Tire2');
  const rrPaint = rr.materials.find(m => m.name === 'CarPaint');
  const rrGlass = rr.materials.find(m => m.name === 'Glass');
  assert(rrTire.pbrMetallicRoughness.baseColorFactor[0] < 0.1, 'Boat Tail Tire2 should be dark rubber');
  assert(rrPaint.pbrMetallicRoughness.baseColorFactor[2] > rrPaint.pbrMetallicRoughness.baseColorFactor[0], 'Boat Tail CarPaint should be Ocean Blue');
  assert.strictEqual(rrGlass.alphaMode, 'BLEND');

  const eg6 = readGlbJson(path.join(MODELS_DIR, 'honda_civic_eg6_1991.glb'));
  const eg6Tire = eg6.materials.find(m => m.name === 'Material.005');
  const eg6Paint = eg6.materials.find(m => m.name === 'Car_Paint');
  const eg6Glass = eg6.materials.find(m => m.name === 'Window_Glass');
  assert(eg6Tire.pbrMetallicRoughness.baseColorFactor[0] < 0.1, 'EG6 tire Material.005 should be dark rubber');
  assert(eg6Paint.pbrMetallicRoughness.baseColorFactor[0] > 0.3 && eg6Paint.pbrMetallicRoughness.baseColorFactor[1] < 0.1, 'EG6 Car_Paint should be Milano Red');
  assert.strictEqual(eg6Glass.alphaMode, 'BLEND');
});

it('subaru_impreza_2024.glb does not have washed-out metallicFactor=1 on livery/tires', () => {
  const g = readGlbJson(path.join(MODELS_DIR, 'subaru_impreza_2024.glb'));
  const liv = g.materials.find(m => m.name === 'livery.001');
  const bot = g.materials.find(m => m.name === 'bottom.001');
  const wh = g.materials.find(m => m.name === 'wheel.001');
  assert(liv.pbrMetallicRoughness.metallicFactor <= 0.25);
  assert(bot.pbrMetallicRoughness.metallicFactor <= 0.2);
  assert(wh.pbrMetallicRoughness.metallicFactor <= 0.7);
});

it('terzo_millennio, prelude_bp1, and porsche_911 detach floating logos, debug swatches, and floor shadow quads', () => {
  function getActiveNodeIndices(g) {
    const visited = new Set();
    const sIdx = typeof g.scene === 'number' ? g.scene : 0;
    const stack = [...(g.scenes[sIdx].nodes || [])];
    while (stack.length) {
      const i = stack.pop();
      if (visited.has(i)) continue;
      visited.add(i);
      const n = g.nodes[i];
      if (n && Array.isArray(n.children)) stack.push(...n.children);
    }
    return visited;
  }

  const tm = readGlbJson(path.join(MODELS_DIR, 'lamborghini_terzo_millennio.glb'));
  const tmActive = getActiveNodeIndices(tm);
  for (const idx of tmActive) {
    assert(!/^Plane(\.\d+)?_13[6-9]|^Plane\.\d+_14[01]/.test(tm.nodes[idx].name || ''), 'Terzo logo node still attached');
  }

  const pr = readGlbJson(path.join(MODELS_DIR, 'honda_prelude_bp1.glb'));
  const prActive = getActiveNodeIndices(pr);
  for (const idx of prActive) {
    const nm = pr.nodes[idx].name || '';
    assert(!/^TexBlendObj_|^shadow_gnd$|^shadow$/i.test(nm), `Prelude junk node ${nm} still attached`);
  }

  const po = readGlbJson(path.join(MODELS_DIR, 'porsche_911_carrera_4s_2024.glb'));
  const poActive = getActiveNodeIndices(po);
  for (const idx of poActive) {
    const nm = po.nodes[idx].name || '';
    assert(nm !== 'Plane' && nm !== 'Plane_0', `Porsche shadow quad ${nm} still attached`);
  }
});

it('js/car-3d-viewer.js includes longitudinal 3.2x5.2 contact shadow, computeTightModelBox, and DoubleSide runtime safeguards', () => {
  const code = fs.readFileSync(path.join(ROOT, 'js/car-3d-viewer.js'), 'utf8');
  assert(code.includes('new THREE.PlaneGeometry(3.2, 5.2)'), 'Contact shadow should be 3.2x5.2 (Z-longitudinal)');
  assert(code.includes('computeTightModelBox(root)'), 'Viewer should use vertex-accurate tight bounding box');
  assert(code.includes('matrixWorld.determinant() < 0'), 'Viewer should set DoubleSide on negative-determinant mirrors');
});

console.log(`\nRESULTS: ${passed}/${total} model checks passed.`);
if (passed !== total) process.exit(1);
