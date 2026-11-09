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

console.log('✅ Bundle complete in ./dist directory for Cloudflare Pages!');
