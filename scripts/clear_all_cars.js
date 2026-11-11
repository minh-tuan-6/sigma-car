#!/usr/bin/env node
/**
 * scripts/clear_all_cars.js
 * ============================================================================
 * XÓA TẤT CẢ CÁC MẪU XE HIỆN CÓ TRÊN WEBSITE
 * ============================================================================
 * - js/data.js: SIGMA_DATA.cars = []
 * - data/sigmacar_store.json: vehicles = []
 * - backend/infrastructure/storage-engine.js: dbState.vehicles = []
 * - data/ar-manifest.json: []
 * - js/ar-manifest.js: window.SIGMA_AR_MANIFEST = []
 * - build dist: node scripts/build_dist.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_JS_PATH = path.join(ROOT_DIR, 'js', 'data.js');
const STORE_JSON_PATH = path.join(ROOT_DIR, 'data', 'sigmacar_store.json');
const STORAGE_ENGINE_PATH = path.join(ROOT_DIR, 'backend', 'infrastructure', 'storage-engine.js');
const AR_MANIFEST_JSON = path.join(ROOT_DIR, 'data', 'ar-manifest.json');
const AR_MANIFEST_JS = path.join(ROOT_DIR, 'js', 'ar-manifest.js');

console.log('🚀 Bắt đầu xóa tất cả các xe hiện có trên web...');

// 1. Update js/data.js
const { SIGMA_DATA } = require(DATA_JS_PATH);
const oldCount = Array.isArray(SIGMA_DATA.cars) ? SIGMA_DATA.cars.length : 0;
SIGMA_DATA.cars = [];

const dataJsContent = `// Centralized database for SIGMACAR: Electric & Certified
const SIGMA_DATA = ${JSON.stringify(SIGMA_DATA, null, 2)};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SIGMA_DATA };
}
`;
fs.writeFileSync(DATA_JS_PATH, dataJsContent, 'utf8');
console.log(`✓ Đã xóa ${oldCount} xe khỏi js/data.js (Hiện tại: 0 xe).`);

// 2. Update data/sigmacar_store.json
if (fs.existsSync(STORE_JSON_PATH)) {
  const store = JSON.parse(fs.readFileSync(STORE_JSON_PATH, 'utf8'));
  store.vehicles = [];
  fs.writeFileSync(STORE_JSON_PATH, JSON.stringify(store, null, 2), 'utf8');
  console.log(`✓ Đã xóa toàn bộ xe khỏi data/sigmacar_store.json.`);
}

// 3. Update backend/infrastructure/storage-engine.js
let storageEngineContent = fs.readFileSync(STORAGE_ENGINE_PATH, 'utf8');
storageEngineContent = storageEngineContent.replace(
  /dbState\.vehicles\s*=\s*\[[\s\S]*?\];\s*\n\s*dbState\.orders/,
  'dbState.vehicles = [];\n\n  dbState.orders'
);
fs.writeFileSync(STORAGE_ENGINE_PATH, storageEngineContent, 'utf8');
console.log(`✓ Đã đồng bộ dbState.vehicles = [] trong backend/infrastructure/storage-engine.js.`);

// 4. Update data/ar-manifest.json & js/ar-manifest.js
fs.writeFileSync(AR_MANIFEST_JSON, JSON.stringify([], null, 2), 'utf8');
const arManifestJsContent = `// Generated AR Manifest - Real Device Compatible
window.SIGMA_AR_MANIFEST = [];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SIGMA_AR_MANIFEST: window.SIGMA_AR_MANIFEST };
}
`;
fs.writeFileSync(AR_MANIFEST_JS, arManifestJsContent, 'utf8');
console.log(`✓ Đã xóa toàn bộ xe khỏi AR Manifest.`);

// 5. Rebuild dist
console.log(`📦 Đóng gói lại thư mục dist...`);
execSync('node scripts/build_dist.js', { stdio: 'inherit' });

console.log('\n======================================================');
console.log('🎉 ĐÃ XÓA SẠCH TẤT CẢ CÁC XE TRÊN TOÀN BỘ WEBSITE (0 XE)');
console.log('======================================================');
