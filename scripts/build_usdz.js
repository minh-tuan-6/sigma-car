#!/usr/bin/env node
// scripts/build_usdz.js — USDZ asset preparation for Apple AR Quick Look (pre-built files).
//
// AR Quick Look cannot open GLB/glTF. This script converts each vehicle's AR GLB (and its per-colour variant
// GLBs) into one USDZ per paint colour, using exactly the browser modules the AR page uses on an iPhone
// (js/ar/models/*, js/ar/vehicle/*, js/ar/apple/usdz-builder.js → three.js USDZExporter) inside headless
// Chrome, so Draco geometry and textures decode the same way they do on the device.
//
//   node scripts/build_usdz.js                       every vehicle with a GLB, every paint colour (default)
//   node scripts/build_usdz.js --vehicle <id> [...]  only those vehicles (index entries of the others are kept)
//   node scripts/build_usdz.js --verified            only vehicles with a certified AR model
//   node scripts/build_usdz.js --dry-run             convert and report sizes, write nothing
//   CHROME_PATH=/path/to/chrome node scripts/build_usdz.js …
//
// Output: assets/models/usdz/<vehicleId>/<colorIndex>.usdz (or default.usdz when the colour cannot change)
//         data/usdz-assets.json — index read by backend/application/ar-manifest-service.js
//
// There is NO size limit. Models are converted in full: no decimation, no texture downscaling below the source
// resolution (cap 8192 px). Each file is streamed from the browser to disk, checked with inspectUsdz() (stored zip,
// USD layer first, 64-byte aligned) and only then moved into place. Files larger than the Cloudflare Pages
// per-file limit (25 MiB — a platform limit, not ours) are still written and indexed with `staticHostable: false`;
// they are listed in assets/models/usdz/.gitignore and served from SIGMACAR_USDZ_PUBLIC_BASE_URL
// (e.g. an R2 bucket; scripts/upload_usdz.js). Without that URL the AR page converts those models on the device.
// This does NOT prove Quick Look renders the files correctly — that needs an iPhone/iPad (docs/AR_TEST_REPORT.md).

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { buildArManifest, PAGES_MAX_FILE_BYTES } = require('../backend/application/ar-manifest-service');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'models', 'usdz');
const INDEX_FILE = path.join(ROOT, 'data', 'usdz-assets.json');
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
window.buildUsdz = async (rawManifest, colorIdx, uploadPath) => {
  const manifest = validateManifest(rawManifest, rawManifest.vehicleId);
  const loader = new ModelLoader({ cache: new AssetCache(), baseUrl: location.origin + '/' });
  const vehicle = new VehicleController({ loader, anchor: new Group(), manifest });
  const phases = [];
  try {
    await vehicle.load(colorIdx === null ? 0 : colorIdx);
    const out = await buildVehicleUsdz(vehicle.pivot, { onProgress: (p) => phases.push(p.phase) });
    // Stream the bytes to the build server instead of returning a (base64) string.
    const res = await fetch(uploadPath, { method: 'POST', body: out.bytes, headers: { 'Content-Type': 'model/vnd.usdz+zip' } });
    if (!res.ok) throw new Error('upload to build server failed: HTTP ' + res.status);
    return { bytes: out.bytes.byteLength, report: out.report, warnings: out.warnings, phases, sourceGlb: vehicle.loadedUrl, sizeMeters: vehicle.normalization.sizeMeters };
  } catch (err) {
    return { error: { code: err.code || err.name || 'ERROR', message: String(err.message || err) } };
  } finally {
    vehicle.dispose();
    loader.dispose();
  }
};
window.__ready = true;
</script></head><body></body></html>`;

function parseArgs(argv) {
  const out = { vehicles: [], verified: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--all') { /* default */ }
    else if (argv[i] === '--verified') out.verified = true;
    else if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--vehicle' && argv[i + 1]) out.vehicles.push(argv[++i]);
  }
  return out;
}

const SAFE_SEGMENT = /^[a-z0-9][a-z0-9-]{0,79}$/;

function staticServer(tmpDir) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__usdz_build.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(BUILD_PAGE);
    }
    if (u.pathname === '/__usdz_upload' && req.method === 'POST') {
      const name = u.searchParams.get('name') || '';
      if (!SAFE_SEGMENT.test(name)) { res.writeHead(400); return res.end(); }
      const out = fs.createWriteStream(path.join(tmpDir, `${name}.usdz`));
      req.pipe(out);
      out.on('finish', () => { res.writeHead(204); res.end(); });
      out.on('error', () => { res.writeHead(500); res.end(); });
      return undefined;
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
    return undefined;
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function loadVehicles() {
  const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sigmacar_store.json'), 'utf8'));
  return (Array.isArray(store.vehicles) ? store.vehicles : []).filter(v => v && !v.archived);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = require('playwright-core');
  const exe = CHROME_CANDIDATES.find(p => fs.existsSync(p));
  if (!exe) {
    console.error('No Chrome/Edge binary found. Set CHROME_PATH.');
    process.exit(2);
  }
  // Manifests WITHOUT the existing USDZ index, so conversion always starts from the GLB.
  const manifests = loadVehicles().map(v => buildArManifest(v, { usdzIndex: { vehicles: {} } })).filter(Boolean);
  const selected = manifests.filter(m => (args.vehicles.length ? args.vehicles.includes(m.vehicleId)
    : (args.verified ? m.readiness === 'verified' : true)));
  if (!selected.length) {
    console.error('No matching vehicles with an AR GLB.');
    process.exit(1);
  }

  const { inspectUsdz } = await import(pathToFileURL(path.join(ROOT, 'js', 'ar', 'apple', 'usdz-builder.js')).href);
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sigmacar-usdz-'));
  const server = await staticServer(tmpDir);
  const base = `http://127.0.0.1:${server.address().port}`;
  // A large JS heap so big models are converted in full rather than failing for lack of memory.
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=8192'] });
  // A fresh page per vehicle so the previous model's geometry, textures and strings are released.
  const openPage = async () => {
    const p = await browser.newPage();
    p.on('pageerror', e => console.error('  page error:', e.message));
    await p.goto(`${base}/__usdz_build.html`);
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
    return p;
  };

  const index = fs.existsSync(INDEX_FILE) ? JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')) : { vehicles: {} };
  index.vehicles = index.vehicles || {};
  const threeVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'js', 'vendor', 'VERSIONS.json'), 'utf8')).three;
  const failures = [];

  for (const m of selected) {
    const colorTargets = m.features.changeColor && m.colors.length ? m.colors.map(c => c.index) : [null];
    const entries = [];
    console.log(`\n🚗 ${m.vehicleId} (${colorTargets.length} file${colorTargets.length > 1 ? 's' : ''})`);
    const page = await openPage();
    for (const colorIndex of colorTargets) {
      const t0 = Date.now();
      const name = colorIndex === null ? 'default' : String(colorIndex);
      const tmpName = `${m.vehicleId}-${name}`;
      const tmpFile = path.join(tmpDir, `${tmpName}.usdz`);
      try {
        const r = await page.evaluate(([man, idx, up]) => window.buildUsdz(man, idx, up), [m, colorIndex, `/__usdz_upload?name=${tmpName}`]);
        if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
        const bytes = fs.readFileSync(tmpFile);
        if (bytes.length !== r.bytes) throw new Error(`received ${bytes.length} of ${r.bytes} bytes`);
        const check = inspectUsdz(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        if (!check.ok) throw new Error(`invalid USDZ: ${check.problems.join(', ')}`);
        const color = m.colors.find(c => c.index === colorIndex);
        const label = `${(bytes.length / 1048576).toFixed(2)} MB  ${Date.now() - t0} ms  ${color ? color.name : 'default'}`;
        if (args.dryRun) {
          console.log(`  ℹ ${name}: ${label} (estimate ${(r.report.estimatedBytes / 1048576).toFixed(2)} MB)`);
          fs.rmSync(tmpFile);
          continue;
        }
        const relPath = `assets/models/usdz/${m.vehicleId}/${name}.usdz`;
        fs.mkdirSync(path.join(OUT_DIR, m.vehicleId), { recursive: true });
        fs.renameSync(tmpFile, path.join(ROOT, relPath));
        const sha256 = sha256File(path.join(ROOT, relPath));
        const sourceGlb = new URL(r.sourceGlb).pathname.replace(/^\//, '');
        const staticHostable = bytes.length <= PAGES_MAX_FILE_BYTES;
        entries.push({
          colorIndex, path: relPath, bytes: bytes.length, sha256, staticHostable, sourceGlb, sizeMeters: r.sizeMeters,
          report: { meshes: r.report.meshes, exported: r.report.exported, textures: r.report.textures, entries: r.report.entries },
          warnings: r.warnings
        });
        console.log(`  ✅ ${relPath}  ${label}  ← ${sourceGlb}${staticHostable ? '' : '  [> 25 MiB → external hosting]'}`);
        for (const w of r.warnings) console.log(`     ⚠ ${w}`);
      } catch (err) {
        failures.push({ vehicleId: m.vehicleId, colorIndex, code: err.code || 'ERROR', message: String(err.message || err).split('\n')[0] });
        console.log(`  ❌ ${name}: [${err.code || 'ERROR'}] ${String(err.message || err).split('\n')[0]}`);
        if (fs.existsSync(tmpFile)) fs.rmSync(tmpFile);
      }
    }
    await page.close();
    if (args.dryRun) continue;
    if (entries.length === colorTargets.length) {
      index.vehicles[m.vehicleId] = entries;
      // Remove files of colours that no longer exist for this vehicle.
      const keep = new Set(entries.map(e => path.basename(e.path)));
      const dir = path.join(OUT_DIR, m.vehicleId);
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.usdz') && !keep.has(f)) fs.rmSync(path.join(dir, f));
    } else if (entries.length) {
      // Partial success: keep previous entries for the colours that failed this time.
      const prev = (index.vehicles[m.vehicleId] || []).filter(e => !entries.some(n => n.colorIndex === e.colorIndex));
      index.vehicles[m.vehicleId] = [...entries, ...prev].sort((a, b) => (a.colorIndex ?? -1) - (b.colorIndex ?? -1));
    }
  }

  await browser.close();
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  if (!args.dryRun) {
    index.generator = `scripts/build_usdz.js (three.js USDZExporter ${threeVersion})`;
    index.generatedAt = new Date().toISOString();
    index.pagesMaxFileBytes = PAGES_MAX_FILE_BYTES;
    index.note = 'Structural USDZ checks only. Rendering in AR Quick Look must be verified on an iPhone/iPad.';
    fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2) + '\n');

    // Files above the Pages limit are build output for external hosting, not repository content.
    const all = Object.values(index.vehicles).flat();
    const large = all.filter(e => !e.staticHostable).map(e => e.path.replace(/^assets\/models\/usdz\//, ''));
    fs.writeFileSync(path.join(OUT_DIR, '.gitignore'),
      '# Generated by scripts/build_usdz.js — USDZ files larger than the Cloudflare Pages 25 MiB per-file limit.\n'
      + '# Served from SIGMACAR_USDZ_PUBLIC_BASE_URL (upload: node scripts/upload_usdz.js). Regenerate: npm run usdz:build\n'
      + large.sort().map(f => `/${f}`).join('\n') + '\n');
    const total = all.reduce((n, e) => n + e.bytes, 0);
    console.log(`\nIndex written: ${path.relative(ROOT, INDEX_FILE)}`);
    console.log(`USDZ files: ${all.length} (${(total / 1048576).toFixed(0)} MB) — ${all.length - large.length} hostable on Pages, ${large.length} need external hosting (> 25 MiB)`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} conversion(s) failed:`);
    for (const f of failures) console.log(`  ${f.vehicleId} colour ${f.colorIndex}: [${f.code}] ${f.message}`);
  }
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
