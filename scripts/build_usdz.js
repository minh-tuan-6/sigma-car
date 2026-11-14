#!/usr/bin/env node
// scripts/build_usdz.js — USDZ asset preparation for Apple AR Quick Look.
//
// AR Quick Look cannot open GLB/glTF. This script converts each vehicle's AR GLB (and its per-colour variant
// GLBs) into one USDZ per paint colour, using exactly the browser modules the AR page uses on an iPhone
// (js/ar/models/*, js/ar/vehicle/*, js/ar/apple/usdz-builder.js → three.js USDZExporter) inside headless
// Chrome, so Draco geometry and textures decode the same way they do on the device.
//
//   node scripts/build_usdz.js --vehicle tesla-cybertruck [--vehicle other-id]   (default: verified vehicles)
//   node scripts/build_usdz.js --all                                                (every vehicle with a GLB)
//   node scripts/build_usdz.js --all --dry-run    (report estimated vs. real size, write nothing)
//   CHROME_PATH=/path/to/chrome node scripts/build_usdz.js …
//
// Output: assets/models/usdz/<vehicleId>/<colorIndex>.usdz (or default.usdz when the colour cannot change)
//         data/usdz-assets.json — index read by backend/application/ar-manifest-service.js
// Every file is checked with inspectUsdz() (stored zip, USD layer first, 64-byte aligned) before it is written.
// This does NOT prove Quick Look renders it correctly — that needs an iPhone/iPad (see docs/AR_TEST_REPORT.md).

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'models', 'usdz');
const INDEX_FILE = path.join(ROOT, 'data', 'usdz-assets.json');
const MAX_DEPLOY_BYTES = 25 * 1024 * 1024; // Cloudflare Pages per-file limit
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

const MIME = { '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.html': 'text/html' };

const BUILD_PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/js/vendor/three/three.module.min.js","three/addons/":"/js/vendor/three/addons/"}}</script>
<script type="module">
import { Group } from 'three';
import { AssetCache } from '/js/ar/models/asset-cache.js';
import { ModelLoader } from '/js/ar/models/model-loader.js';
import { VehicleController } from '/js/ar/vehicle/vehicle-controller.js';
import { validateManifest } from '/js/ar/manifest/manifest-schema.js';
import { buildVehicleUsdz } from '/js/ar/apple/usdz-builder.js';
window.buildUsdz = async (rawManifest, colorIdx, opts) => {
  const manifest = validateManifest(rawManifest, rawManifest.vehicleId);
  const loader = new ModelLoader({ cache: new AssetCache(), baseUrl: location.origin + '/' });
  const anchor = new Group();
  const vehicle = new VehicleController({ loader, anchor, manifest });
  try {
    await vehicle.load(colorIdx === null ? 0 : colorIdx);
    const out = await buildVehicleUsdz(vehicle.pivot, opts.dryRun ? { maxEstimatedBytes: Infinity } : {});
    let bin = '';
    for (let i = 0; i < out.bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, out.bytes.subarray(i, i + 0x8000));
    return { base64: btoa(bin), report: out.report, warnings: out.warnings, sourceGlb: vehicle.loadedUrl, sizeMeters: vehicle.normalization.sizeMeters };
  } finally {
    vehicle.dispose();
    loader.dispose();
  }
};
window.__ready = true;
</script></head><body></body></html>`;

function parseArgs(argv) {
  const out = { vehicles: [], all: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--all') out.all = true;
    else if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--vehicle' && argv[i + 1]) out.vehicles.push(argv[++i]);
  }
  return out;
}

function staticServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__usdz_build.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(BUILD_PAGE);
    }
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel);
    const allowed = ['js', 'assets'].some(d => file.startsWith(path.join(ROOT, d) + path.sep));
    if (!allowed || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function loadVehicles() {
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sigmacar_store.json'), 'utf8'));
  return (Array.isArray(store.vehicles) ? store.vehicles : []).filter(v => v && !v.archived);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = require('playwright-core');
  const exe = CHROME_CANDIDATES.find(p => fs.existsSync(p));
  if (!exe) {
    console.error('No Chrome/Edge binary found. Set CHROME_PATH.');
    process.exit(2);
  }
  // Build manifests WITHOUT the existing USDZ index so conversion always starts from the GLB.
  const { buildArManifest } = require('../backend/application/ar-manifest-service');
  const vehicles = loadVehicles();
  const manifests = vehicles.map(v => buildArManifest(v, { usdzIndex: { vehicles: {} } })).filter(Boolean);
  const selected = args.all ? manifests
    : manifests.filter(m => (args.vehicles.length ? args.vehicles.includes(m.vehicleId) : m.readiness === 'verified'));
  if (!selected.length) {
    console.error('No matching vehicles with an AR GLB.');
    process.exit(1);
  }

  const { inspectUsdz } = await import(require('url').pathToFileURL(path.join(ROOT, 'js', 'ar', 'apple', 'usdz-builder.js')).href);
  const server = await staticServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('  page error:', e.message));
  await page.goto(`${base}/__usdz_build.html`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });

  const index = fs.existsSync(INDEX_FILE) ? JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')) : { vehicles: {} };
  index.vehicles = index.vehicles || {};
  const threeVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'js', 'vendor', 'VERSIONS.json'), 'utf8')).three;
  let failures = 0;

  for (const m of selected) {
    const colorTargets = m.features.changeColor && m.colors.length ? m.colors.map(c => c.index) : [null];
    const entries = [];
    console.log(`\n🚗 ${m.vehicleId} (${colorTargets.length} file${colorTargets.length > 1 ? 's' : ''})`);
    for (const colorIndex of colorTargets) {
      const t0 = Date.now();
      try {
        const r = await page.evaluate(([man, idx, o]) => window.buildUsdz(man, idx, o), [m, colorIndex, { dryRun: args.dryRun }]);
        const bytes = Buffer.from(r.base64, 'base64');
        const check = inspectUsdz(new Uint8Array(bytes));
        if (!check.ok) throw new Error(`invalid USDZ: ${check.problems.join(', ')}`);
        if (args.dryRun) {
          console.log(`  ℹ colour ${colorIndex}: estimated ${(r.report.estimatedBytes / 1048576).toFixed(2)} MB, actual ${(bytes.length / 1048576).toFixed(2)} MB (ratio ${(bytes.length / r.report.estimatedBytes).toFixed(2)}), ${Date.now() - t0} ms`);
          continue;
        }
        if (bytes.length > MAX_DEPLOY_BYTES) throw new Error(`${(bytes.length / 1048576).toFixed(1)} MB exceeds the 25 MiB Cloudflare Pages file limit — produce a binary USDZ offline instead`);
        const name = colorIndex === null ? 'default' : String(colorIndex);
        const relPath = `assets/models/usdz/${m.vehicleId}/${name}.usdz`;
        fs.mkdirSync(path.join(OUT_DIR, m.vehicleId), { recursive: true });
        fs.writeFileSync(path.join(ROOT, relPath), bytes);
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        const sourceGlb = new URL(r.sourceGlb).pathname.replace(/^\//, '');
        entries.push({ colorIndex, path: relPath, bytes: bytes.length, sha256, sourceGlb, sizeMeters: r.sizeMeters, warnings: r.warnings });
        const color = m.colors.find(c => c.index === colorIndex);
        console.log(`  ✅ ${relPath}  ${(bytes.length / 1048576).toFixed(2)} MB  ${Date.now() - t0} ms  ${color ? color.name : 'default'}  ← ${sourceGlb}`);
        for (const w of r.warnings) console.log(`     ⚠ ${w}`);
      } catch (err) {
        failures++;
        console.log(`  ❌ colour ${colorIndex}: ${String(err.message || err).split('\n')[0]}`);
      }
    }
    if (entries.length) index.vehicles[m.vehicleId] = entries;
    if (args.dryRun) colorTargets.length = 0;
  }

  if (args.dryRun) {
    await browser.close();
    server.close();
    process.exit(failures ? 1 : 0);
  }
  index.generator = `scripts/build_usdz.js (three.js USDZExporter ${threeVersion})`;
  index.generatedAt = new Date().toISOString();
  index.note = 'Structural USDZ checks only. Rendering in AR Quick Look must be verified on an iPhone/iPad.';
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2) + '\n');
  console.log(`\nIndex written: ${path.relative(ROOT, INDEX_FILE)}`);

  await browser.close();
  server.close();
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
