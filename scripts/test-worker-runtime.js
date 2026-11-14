// scripts/test-worker-runtime.js
// Runs the existing integration + security suites with /api/v1/* served by the Cloudflare Worker runtime
// (backend/cloudflare/runtime.js) and D1 persistence on the node:sqlite D1 shim. Usage: npm run test:worker-runtime
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const files = ['tests/integration', 'tests/security']
  .flatMap(dir => fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.test.js')).map(f => `${dir}/${f}`));
const r = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--disable-warning=ExperimentalWarning', '--test', ...files], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, SIGMACAR_TEST_RUNTIME: 'worker' }
});
process.exit(r.status === null ? 1 : r.status);
