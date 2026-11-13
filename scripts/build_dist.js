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

const filesToCopy = ['index.html', '_headers', '_redirects'];
filesToCopy.forEach(f => {
  const src = path.join(rootDir, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(distDir, f));
  }
});

const dirsToCopy = ['css', 'js', 'assets'];
dirsToCopy.forEach(d => {
  const src = path.join(rootDir, d);
  const dst = path.join(distDir, d);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dst, { recursive: true });
  }
});

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
  } catch (err) {
    console.warn('⚠️ Could not generate public-catalog.json from store:', err.message);
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
