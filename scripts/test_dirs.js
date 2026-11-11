const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const UNPACKED_DIR = path.join(ROOT_DIR, 'Xe_unpacked');

// Inspect each folder and extract initial metadata
const folders = fs.readdirSync(UNPACKED_DIR).filter(d => fs.statSync(path.join(UNPACKED_DIR, d)).isDirectory());

console.log(`Discovered ${folders.length} vehicle folders in Xe_unpacked`);
