#!/usr/bin/env node
// scripts/upload_usdz.js — publishes the pre-built USDZ files that Cloudflare Pages cannot host (> 25 MiB each)
// to a Cloudflare R2 bucket, so they can be served from SIGMACAR_USDZ_PUBLIC_BASE_URL.
//
//   node scripts/upload_usdz.js --bucket sigmacar-usdz              # prints the wrangler commands (default, safe)
//   node scripts/upload_usdz.js --bucket sigmacar-usdz --execute    # runs them (needs `wrangler login` / API token)
//   node scripts/upload_usdz.js --bucket sigmacar-usdz --all        # include files Pages could host too
//
// Object keys mirror the manifest URLs: <vehicleId>/<colour>.usdz → ${SIGMACAR_USDZ_PUBLIC_BASE_URL}/<vehicleId>/<colour>.usdz
// Then set SIGMACAR_USDZ_PUBLIC_BASE_URL (Pages build env + backend env) to the bucket's public HTTPS URL
// (r2.dev subdomain or a custom domain) and rebuild. Every file is re-hashed against data/usdz-assets.json first.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'usdz-assets.json'), 'utf8'));
const argv = process.argv.slice(2);
const bucket = argv[argv.indexOf('--bucket') + 1];
const execute = argv.includes('--execute');
const includeAll = argv.includes('--all');

if (!argv.includes('--bucket') || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket || '')) {
  console.error('Usage: node scripts/upload_usdz.js --bucket <r2-bucket-name> [--execute] [--all]');
  process.exit(2);
}

const entries = Object.values(index.vehicles || {}).flat().filter(e => includeAll || e.staticHostable === false);
let problems = 0;
for (const e of entries) {
  const file = path.join(ROOT, e.path);
  if (!fs.existsSync(file)) {
    console.error(`missing ${e.path} — run npm run usdz:build first`);
    problems++;
    continue;
  }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (sha !== e.sha256) {
    console.error(`stale ${e.path} (hash differs from data/usdz-assets.json) — run npm run usdz:build`);
    problems++;
    continue;
  }
  const key = e.path.replace(/^assets\/models\/usdz\//, '');
  const args = ['--yes', 'wrangler@3.99.0', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', file,
    '--content-type', 'model/vnd.usdz+zip', '--cache-control', 'public, max-age=31536000, immutable', '--remote'];
  if (!execute) {
    console.log(`npx ${args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    continue;
  }
  console.log(`⬆ ${key} (${(e.bytes / 1048576).toFixed(1)} MB)`);
  const r = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) problems++;
}
console.log(`\n${entries.length} file(s), ${(entries.reduce((n, e) => n + e.bytes, 0) / 1048576).toFixed(0)} MB${execute ? '' : ' — dry run, nothing uploaded (add --execute)'}`);
process.exit(problems ? 1 : 0);
