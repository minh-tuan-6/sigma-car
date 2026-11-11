// scripts/build_dist.js
// Prepares clean production static distribution for Cloudflare Pages

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

const dirsToCopy = ['css', 'js', 'assets', 'data'];
dirsToCopy.forEach(d => {
  const src = path.join(rootDir, d);
  const dst = path.join(distDir, d);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dst, { recursive: true });
  }
});

// Verify no file exceeds Cloudflare Pages 25 MiB limit
function checkSizeLimit(dir) {
  let oversized = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      oversized.push(...checkSizeLimit(full));
    } else if (item.isFile()) {
      const sz = fs.statSync(full).size;
      if (sz > 25 * 1024 * 1024) {
        oversized.push({ file: path.relative(distDir, full), sizeMb: (sz / 1024 / 1024).toFixed(2) });
      }
    }
  }
  return oversized;
}

const oversizedFiles = checkSizeLimit(distDir);
if (oversizedFiles.length > 0) {
  console.error('❌ ERROR: Found files exceeding Cloudflare Pages 25 MiB limit:');
  oversizedFiles.forEach(f => console.error(`   - ${f.file} (${f.sizeMb} MiB)`));
  process.exit(1);
}

console.log('✅ Bundle complete and verified: All files are within Cloudflare Pages 25 MiB limit!');
