// scripts/build_dist.js
// Prepares clean production static distribution for Cloudflare Pages (excludes private runtime store & secrets)

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');

console.log('📦 Building SIGMACAR static bundle for Cloudflare Pages...');

if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

const filesToCopy = ['index.html', 'ar.html', '_headers', '_redirects'];
filesToCopy.forEach(f => {
  const src = path.join(rootDir, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(distDir, f));
  }
});

// Pre-built USDZ files above the Cloudflare Pages per-file limit (25 MiB) cannot be deployed as static files.
// They are left out of dist/ and served from SIGMACAR_USDZ_PUBLIC_BASE_URL (see scripts/upload_usdz.js);
// the AR snapshots below reference them there, or omit them (→ on-device conversion) when no URL is set.
const PAGES_MAX_FILE_BYTES = 25 * 1024 * 1024;
const externalUsdz = [];
const dirsToCopy = ['css', 'js', 'assets'];
dirsToCopy.forEach(d => {
  const src = path.join(rootDir, d);
  const dst = path.join(distDir, d);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dst, {
      recursive: true,
      filter: (file) => {
        if (path.basename(file) === '.gitignore') return false;
        if (file.toLowerCase().endsWith('.usdz') && fs.statSync(file).size > PAGES_MAX_FILE_BYTES) {
          externalUsdz.push(path.relative(rootDir, file).split(path.sep).join('/'));
          return false;
        }
        return true;
      }
    });
  }
});
if (externalUsdz.length) {
  const base = process.env.SIGMACAR_USDZ_PUBLIC_BASE_URL;
  console.log(`📦 ${externalUsdz.length} USDZ file(s) > 25 MiB kept out of dist/ (Pages file limit); ${base ? `served from ${base}` : 'SIGMACAR_USDZ_PUBLIC_BASE_URL not set → those colours convert on the device'}`);
}

// Copy strictly public data files ONLY (NEVER sigmacar_store.json or private runtime data)
const publicDataDir = path.join(distDir, 'data');
fs.mkdirSync(publicDataDir, { recursive: true });

const publicDataWhitelist = ['ar-manifest.json'];
publicDataWhitelist.forEach(file => {
  const src = path.join(rootDir, 'data', file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(publicDataDir, file));
  }
});

// Emit sanitized public catalog snapshot if store exists (vehicles + certifiedVehicles + faqs ONLY, zero PII/keys)
const storePath = path.join(rootDir, 'data', 'sigmacar_store.json');
if (fs.existsSync(storePath)) {
  try {
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const publicCatalog = {
      generatedAt: new Date().toISOString(),
      vehicles: (Array.isArray(store.vehicles) ? store.vehicles : []).filter(v => !v.archived),
      certifiedVehicles: Array.isArray(store.certifiedVehicles) ? store.certifiedVehicles : [],
      faqs: Array.isArray(store.faqs) ? store.faqs : []
    };
    fs.writeFileSync(path.join(publicDataDir, 'public-catalog.json'), JSON.stringify(publicCatalog, null, 2), 'utf8');

    // Static AR manifest snapshots (same builder as GET /api/v1/vehicles/:id/ar-manifest). Used by the AR page
    // only when the live API is unreachable; the page labels the data source.
    const { buildArManifest } = require('../backend/application/ar-manifest-service');
    const arDir = path.join(publicDataDir, 'ar');
    fs.mkdirSync(arDir, { recursive: true });
    let arCount = 0;
    for (const v of publicCatalog.vehicles) {
      const manifest = buildArManifest(v, { staticHostOnly: true });
      if (manifest && /^[a-z0-9][a-z0-9-]{0,79}$/.test(manifest.vehicleId)) {
        fs.writeFileSync(path.join(arDir, `${manifest.vehicleId}.json`), JSON.stringify(manifest), 'utf8');
        arCount++;
      }
    }
    console.log(`🧭 Emitted ${arCount} static AR manifest snapshots to dist/data/ar/`);
  } catch (err) {
    console.warn('⚠️ Could not generate public-catalog.json / AR snapshots from store:', err.message);
  }
}

// Verify no forbidden private files or oversized assets (>25 MiB) exist in dist/
const FORBIDDEN_PATH_PATTERNS = [
  /sigmacar_store/i,
  /\.env/i,
  /passwordHash/i,
  /(^|[\\/])backend([\\/]|$)/i,
  /(^|[\\/])tests([\\/]|$)/i,
  /(^|[\\/])\.git([\\/]|$)/i
];

function verifyDist(dir) {
  let oversized = [];
  let forbidden = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    const rel = path.relative(distDir, full);
    if (FORBIDDEN_PATH_PATTERNS.some(rx => rx.test(rel) || rx.test(item.name))) {
      forbidden.push(rel);
    }
    if (item.isDirectory()) {
      const sub = verifyDist(full);
      oversized.push(...sub.oversized);
      forbidden.push(...sub.forbidden);
    } else if (item.isFile()) {
      const sz = fs.statSync(full).size;
      if (sz > 25 * 1024 * 1024) {
        oversized.push({ file: rel, sizeMb: (sz / 1024 / 1024).toFixed(2) });
      }
    }
  }
  return { oversized, forbidden };
}

const verification = verifyDist(distDir);
if (verification.forbidden.length > 0) {
  console.error('❌ ERROR: Forbidden private/secret files detected in dist/:');
  verification.forbidden.forEach(f => console.error(`   - ${f}`));
  process.exit(1);
}
if (verification.oversized.length > 0) {
  console.error('❌ ERROR: Found files exceeding Cloudflare Pages 25 MiB limit:');
  verification.oversized.forEach(f => console.error(`   - ${f.file} (${f.sizeMb} MiB)`));
  process.exit(1);
}

console.log('✅ Bundle complete and verified: Zero private store leaks, all files within Cloudflare Pages 25 MiB limit!');
