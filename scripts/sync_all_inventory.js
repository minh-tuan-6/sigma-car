// scripts/sync_all_inventory.js
// Production sync script for all vehicles, accessories & components from "about car" into SIGMACAR
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const dataJsPath = path.join(rootDir, 'js', 'data.js');
const storageEnginePath = path.join(rootDir, 'backend', 'infrastructure', 'storage-engine.js');

// Exact metadata from about car/Data-xe.xlsx (CAR-001..CAR-010)
const dataXeMetadata = {
  'toyota-camry': {
    productCode: 'CAR-001',
    brand: 'Toyota',
    subCategory: 'Sedan',
    colorsSummary: 'Trắng, Đen, Đỏ',
    excelSpecs: '2.5L 4 cylinder, 207 hp, Hộp số Tự động 8 cấp',
    year: 2023,
    excelStock: 5,
    price: 1405000000
  },
  'honda-crv': {
    productCode: 'CAR-002',
    brand: 'Honda',
    subCategory: 'Crossover/SUV',
    colorsSummary: 'Đen, Trắng, Xám',
    excelSpecs: '1.5L Turbo, 188 hp, Hộp số CVT, Dẫn động AWD',
    year: 2024,
    excelStock: 8,
    price: 1310000000
  },
  'ford-ranger': {
    productCode: 'CAR-003',
    brand: 'Ford',
    subCategory: 'Bán tải',
    colorsSummary: 'Cam, Đen, Trắng, Xám',
    excelSpecs: '2.0L Bi-Turbo Diesel, 210 hp, Hộp số Tự động 10 cấp, 4x4',
    year: 2023,
    excelStock: 4,
    price: 979000000
  },
  'hyundai-tucson': {
    productCode: 'CAR-004',
    brand: 'Hyundai',
    subCategory: 'Crossover/SUV',
    colorsSummary: 'Đỏ, Trắng, Đen, Xanh',
    excelSpecs: '2.0L MPI, 156 hp, Hộp số Tự động 6 cấp, FWD',
    year: 2024,
    excelStock: 10,
    price: 839000000
  },
  'mazda-cx5': {
    productCode: 'CAR-005',
    brand: 'Mazda',
    subCategory: 'Crossover/SUV',
    colorsSummary: 'Đỏ Soul Red, Trắng, Xám, Đen',
    excelSpecs: 'SkyActiv-G 2.0L, 154 hp, Hộp số Tự động 6 cấp',
    year: 2023,
    excelStock: 12,
    price: 829000000
  },
  'vinfast-vf8': {
    productCode: 'CAR-006',
    brand: 'VinFast',
    subCategory: 'SUV Điện',
    colorsSummary: 'Xanh VinFast, Trắng, Bạc, Đen',
    excelSpecs: 'Động cơ Điện kép, 402 hp, Quãng đường ~400km/lần sạc, AWD',
    year: 2024,
    excelStock: 6,
    price: 1270000000
  },
  'mercedes-glc300': {
    productCode: 'CAR-007',
    brand: 'Mercedes-Benz',
    subCategory: 'SUV Hạng sang',
    colorsSummary: 'Trắng, Đen, Xanh Cavansite',
    excelSpecs: '2.0L Turbo Mild-Hybrid, 258 hp, Hộp số 9G-TRONIC, AWD',
    year: 2024,
    excelStock: 3,
    price: 2799000000
  },
  'bmw-330i': {
    productCode: 'CAR-008',
    brand: 'BMW',
    subCategory: 'Sedan Hạng sang',
    colorsSummary: 'Xanh Phytonic, Trắng, Đen',
    excelSpecs: '2.0L TwinPower Turbo, 258 hp, Hộp số Steptronic 8 cấp, RWD',
    year: 2023,
    excelStock: 2,
    price: 1869000000
  },
  'kia-seltos': {
    productCode: 'CAR-009',
    brand: 'Kia',
    subCategory: 'B-SUV',
    colorsSummary: 'Trắng, Đen, Vàng, Đỏ',
    excelSpecs: '1.5L Smartstream, 113 hp, Hộp số CVT',
    year: 2024,
    excelStock: 15,
    price: 649000000
  },
  'mitsubishi-xpander': {
    productCode: 'CAR-010',
    brand: 'Mitsubishi',
    subCategory: 'MPV 7 chỗ',
    colorsSummary: 'Cam/Đen, Trắng, Bạc',
    excelSpecs: '1.5L MIVEC, 104 hp, Hộp số Tự động 4 cấp, Khoảng sáng gầm 225mm',
    year: 2024,
    excelStock: 9,
    price: 698000000
  }
};

// VinFast & SIGMA product codes from SIGMACAR_Vehicle_Component_Database.xlsx
const extraMetadata = {
  'vinfast-vf2': { productCode: 'VF2', subCategory: 'Mini-SUV Điện' },
  'vinfast-vf3': { productCode: 'VF3-ECO', subCategory: 'Mini-SUV Điện' },
  'vinfast-vf3-plus': { productCode: 'VF3-PLUS', subCategory: 'Mini-SUV Điện' },
  'vinfast-vf5': { productCode: 'VF5', subCategory: 'A-SUV Điện' },
  'vinfast-vf6': { productCode: 'VF6-ECO', subCategory: 'B-SUV Điện' },
  'vinfast-vf6-plus': { productCode: 'VF6-PLUS', subCategory: 'B-SUV Điện' },
  'vinfast-vf7-eco': { productCode: 'VF7-ECO', subCategory: 'C-SUV Điện' },
  'vinfast-vf7-plus': { productCode: 'VF7-PLUS', subCategory: 'C-SUV Điện' },
  'vinfast-vf7': { productCode: 'VF7-AWD', subCategory: 'C-SUV Điện' },
  'vinfast-vf8-eco': { productCode: 'VF8-ECO', subCategory: 'D-SUV Điện' },
  'vinfast-vf8-all-new': { productCode: 'VF8-2026', subCategory: 'D-SUV Điện 2026' },
  'vinfast-vf9-eco': { productCode: 'VF9-ECO', subCategory: 'E-SUV Điện 7 Chỗ' },
  'vinfast-vf9': { productCode: 'VF9-PLUS', subCategory: 'E-SUV Điện 6-7 Chỗ' },
  'vinfast-vf-mpv7': { productCode: 'VFMPV7', subCategory: 'MPV Điện 7 chỗ' },
  'vinfast-limo-green': { productCode: 'LIMOGREEN', subCategory: 'MPV Điện 7 chỗ' },
  'vinfast-vf-wild': { productCode: 'VFWILD', subCategory: 'Bán tải Điện' },
  'model-e': { productCode: 'SIG-001', subCategory: 'SUV Điện Thông Minh' },
  'vision-s': { productCode: 'SIG-002', subCategory: 'Sedan Điện Flagship' },
  'city-g': { productCode: 'SIG-003', subCategory: 'Hatchback Đô Thị' },
  'x-series-gt': { productCode: 'SIG-004', subCategory: 'Super EV SUV' },
  'grand-7': { productCode: 'SIG-005', subCategory: 'SUV Điện 7 Chỗ' },
  'aero-cross': { productCode: 'SIG-006', subCategory: 'Coupe Crossover Điện' },
  'horizon-mpv': { productCode: 'SIG-007', subCategory: 'MPV Điện Thương Gia' }
};

// 1. Load existing SIGMA_DATA
const { SIGMA_DATA } = require(dataJsPath);
const existingCars = [...SIGMA_DATA.cars];

// Enrich all vehicles with productCode, subCategory, colorsSummary, excelSpecs, excelStock
existingCars.forEach(c => {
  if (dataXeMetadata[c.id]) {
    const meta = dataXeMetadata[c.id];
    c.productCode = meta.productCode;
    c.brand = meta.brand;
    c.subCategory = meta.subCategory;
    c.colorsSummary = meta.colorsSummary;
    c.excelSpecs = meta.excelSpecs;
    c.year = meta.year;
    c.excelStock = meta.excelStock;
    c.stock = meta.excelStock;
    c.price = meta.price;
    c.isDataXe = true;
  } else if (extraMetadata[c.id]) {
    c.productCode = extraMetadata[c.id].productCode;
    c.subCategory = extraMetadata[c.id].subCategory;
    c.colorsSummary = (c.colors || []).map(cl => cl.name).join(', ') || 'Trắng, Đen, Xanh';
    c.excelSpecs = c.power || c.powertrain || '';
    c.year = c.year || 2025;
    c.excelStock = c.excelStock || c.stock || 12;
  }

  // Ensure fuel is explicitly 'ev' or 'gas'
  const isGas = ['toyota-camry', 'honda-crv', 'ford-ranger', 'hyundai-tucson', 'mazda-cx5', 'mercedes-glc300', 'bmw-330i', 'kia-seltos', 'mitsubishi-xpander'].includes(c.id);
  c.fuel = isGas ? 'gas' : 'ev';
  c.isAvailable = true;
});

// Order vehicles so that:
// 1. All 10 vehicles from Data-xe.xlsx (CAR-001 .. CAR-010) come first in exact order CAR-001..CAR-010!
// 2. Next come the 15 VinFast EV models from SIGMACAR_Vehicle_Component_Database.xlsx
// 3. Next come the 7 SIGMA models (model-e .. horizon-mpv)
const dataXeOrder = [
  'toyota-camry',      // CAR-001
  'honda-crv',         // CAR-002
  'ford-ranger',       // CAR-003
  'hyundai-tucson',    // CAR-004
  'mazda-cx5',         // CAR-005
  'vinfast-vf8',       // CAR-006
  'mercedes-glc300',   // CAR-007
  'bmw-330i',          // CAR-008
  'kia-seltos',        // CAR-009
  'mitsubishi-xpander' // CAR-010
];

const orderedCars = [];
for (const id of dataXeOrder) {
  const found = existingCars.find(c => c.id === id);
  if (found) orderedCars.push(found);
}
// Then all other VinFast cars
for (const c of existingCars) {
  if (!dataXeOrder.includes(c.id) && c.brand === 'VinFast') {
    orderedCars.push(c);
  }
}
// Then all SIGMACAR cars
for (const c of existingCars) {
  if (!orderedCars.some(o => o.id === c.id)) {
    orderedCars.push(c);
  }
}

console.log(`Total synchronized vehicles: ${orderedCars.length}`);
const evCount = orderedCars.filter(v => v.fuel === 'ev').length;
const gasCount = orderedCars.filter(v => v.fuel === 'gas').length;
console.log(`EV count: ${evCount}, Gas count: ${gasCount}`);

// Update SIGMA_DATA in js/data.js
SIGMA_DATA.cars = orderedCars;

const updatedDataJs = `// Centralized database for SIGMACAR: Electric & Certified
const SIGMA_DATA = ${JSON.stringify(SIGMA_DATA, null, 2)};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SIGMA_DATA };
}
`;
fs.writeFileSync(dataJsPath, updatedDataJs, 'utf8');
console.log('✅ Synchronized js/data.js with CAR-001..CAR-010 at top');

// Update backend/infrastructure/storage-engine.js
let storageEngineContent = fs.readFileSync(storageEnginePath, 'utf8');
const vehiclesJson = JSON.stringify(orderedCars, null, 4);
storageEngineContent = storageEngineContent.replace(
  /dbState\.vehicles\s*=\s*\[[\s\S]*?\n  \];/m,
  `dbState.vehicles = ${vehiclesJson};`
);
fs.writeFileSync(storageEnginePath, storageEngineContent, 'utf8');
console.log('✅ Synchronized backend/infrastructure/storage-engine.js');

// Reset database store while preserving exact excelStock for CAR-001..CAR-010 and ample stock for test vehicles (model-e, city-g, vision-s)
const { seedInitialData, saveToDisk, dbState } = require(storageEnginePath);
seedInitialData();
if (Array.isArray(dbState.vehicles)) {
  dbState.vehicles.forEach(v => {
    if (['model-e', 'city-g', 'vision-s', 'x-series-gt', 'grand-7'].includes(v.id)) {
      v.stock = Math.max(v.stock || 20, 25);
    } else if (v.excelStock) {
      v.stock = v.excelStock;
    }
    v.isAvailable = true;
  });
}
saveToDisk();
console.log('✅ Synchronized data/sigmacar_store.json');
