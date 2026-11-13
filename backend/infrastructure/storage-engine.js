// backend/infrastructure/storage-engine.js
// Database-Independent Storage Engine & Atomic Transaction Manager for SIGMACAR

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const {
  ROLES, ORDER_STATUS, PAYMENT_STATUS, APPOINTMENT_STATUS, TICKET_STATUS,
  TICKET_PRIORITY, RETURN_STATUS, WARRANTY_STATUS, CAMPAIGN_CATEGORIES,
  CAMPAIGN_STATUS, LEGACY_VEHICLE_ARCHIVES, SHOWROOM_BRANCHES
} = require('../domain/constants');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DEFAULT_DATA_FILE = config.storage && config.storage.dataFile
  ? path.resolve(config.storage.dataFile)
  : path.join(DEFAULT_DATA_DIR, 'sigmacar_store.json');

const CORE_COLLECTIONS = [
  'users', 'vehicles', 'certifiedVehicles', 'orders', 'appointments',
  'returnRequests', 'warranties', 'serviceRecords', 'serviceAppointments',
  'reviews', 'questions', 'supportTickets', 'faqs', 'emailCampaigns', 'auditLogs'
];

const EXTENDED_COLLECTIONS = [
  'branchInventory', 'carts', 'quotes', 'paymentIntents', 'paymentLedger',
  'webhookEvents', 'refunds', 'reservations', 'inventoryMovements', 'promotions',
  'configurations', 'accessories', 'bundles', 'registrationCases',
  'financingApplications', 'mediaAssets', 'policyVersions', 'handovers',
  'vehicleUnits', 'vehicleOwnerships', 'warrantyClaims', 'serviceCenters',
  'serviceBays', 'technicians', 'serviceParts', 'serviceJobs', 'contentEntries',
  'outboxEvents', 'notifications', 'consentEvents', 'aiConversations',
  'aiPreferences', 'tcoAssumptions', 'analyticsEvents', 'chargingCache',
  'contracts', 'idempotencyRecords'
];

const ALL_COLLECTIONS = [...CORE_COLLECTIONS, ...EXTENDED_COLLECTIONS];

const storageRuntime = {
  mode: (config.storage && config.storage.mode) || 'json',
  dataFile: DEFAULT_DATA_FILE,
  fsImpl: fs,
  allowDevSeed: config.storage ? config.storage.allowDevSeed : true,
  memoryOnly: (config.storage && config.storage.mode === 'memory') || false
};

function createEmptyState() {
  const empty = {};
  ALL_COLLECTIONS.forEach((col) => { empty[col] = []; });
  empty.meta = {
    version: '4.0.0',
    initializedAt: null,
    lastSavedAt: null
  };
  return empty;
}

// In-Memory Database Structure with stable reference
const dbState = createEmptyState();

function setDbState(newState) {
  const base = createEmptyState();
  Object.keys(dbState).forEach(k => delete dbState[k]);
  Object.assign(dbState, base, newState || {});
  if (!dbState.meta) dbState.meta = { version: '4.0.0', initializedAt: null, lastSavedAt: null };
}

function resetToEmpty() {
  setDbState(createEmptyState());
}

function configureStorage(options = {}) {
  if (options.mode !== undefined) {
    storageRuntime.mode = options.mode;
    storageRuntime.memoryOnly = options.mode === 'memory';
  }
  if (options.memoryOnly !== undefined) {
    storageRuntime.memoryOnly = Boolean(options.memoryOnly);
    if (storageRuntime.memoryOnly) storageRuntime.mode = 'memory';
  }
  if (options.dataFile !== undefined) {
    storageRuntime.dataFile = path.resolve(options.dataFile);
  }
  if (options.fsImpl !== undefined) {
    storageRuntime.fsImpl = options.fsImpl || fs;
  }
  if (options.allowDevSeed !== undefined) {
    storageRuntime.allowDevSeed = Boolean(options.allowDevSeed);
  }
  return getStorageConfig();
}

function getStorageConfig() {
  return {
    mode: storageRuntime.mode,
    dataFile: storageRuntime.dataFile,
    allowDevSeed: storageRuntime.allowDevSeed,
    memoryOnly: storageRuntime.memoryOnly
  };
}

// Concurrency mutex lock for transactional operations
let isLocked = false;
async function acquireLock(timeoutMs = 5000) {
  const start = Date.now();
  while (isLocked) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Database transaction lock timeout - High concurrency busy');
    }
    await new Promise(r => setTimeout(r, 10));
  }
  isLocked = true;
}

function releaseLock() {
  isLocked = false;
}

function ensureAllCollectionArrays() {
  for (const col of ALL_COLLECTIONS) {
    if (!Array.isArray(dbState[col])) {
      dbState[col] = [];
    }
  }
  if (!dbState.meta || typeof dbState.meta !== 'object') {
    dbState.meta = { version: '4.0.0', initializedAt: null, lastSavedAt: null };
  }
}

// Persistent Storage Management
function loadFromDisk() {
  if (storageRuntime.memoryOnly || storageRuntime.mode === 'memory') {
    if (storageRuntime.allowDevSeed) {
      seedInitialData();
    } else {
      resetToEmpty();
    }
    ensureAllCollectionArrays();
    return;
  }

  const fsDriver = storageRuntime.fsImpl;
  const dataFile = storageRuntime.dataFile;
  const dataDir = path.dirname(dataFile);

  if (!fsDriver.existsSync(dataDir)) {
    fsDriver.mkdirSync(dataDir, { recursive: true });
  }

  if (fsDriver.existsSync(dataFile)) {
    const raw = fsDriver.readFileSync(dataFile, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      // Never silently overwrite corrupt production JSON with seed data
      console.error('CRITICAL: Failed to parse storage file (refusing to overwrite disk):', parseErr.message);
      throw new Error(`Storage file corrupted (${dataFile}): ${parseErr.message}`);
    }
    setDbState(parsed);
    ensureExtendedCollections();
    return;
  }

  if (storageRuntime.allowDevSeed) {
    seedInitialData();
    saveToDisk();
  } else {
    resetToEmpty();
    ensureAllCollectionArrays();
    saveToDisk();
  }
}

function saveToDisk() {
  if (!dbState.meta) dbState.meta = {};
  dbState.meta.lastSavedAt = new Date().toISOString();

  if (storageRuntime.memoryOnly || storageRuntime.mode === 'memory') {
    return;
  }

  const fsDriver = storageRuntime.fsImpl;
  const dataFile = storageRuntime.dataFile;
  const dataDir = path.dirname(dataFile);
  if (!fsDriver.existsSync(dataDir)) {
    fsDriver.mkdirSync(dataDir, { recursive: true });
  }

  const tmpFile = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify(dbState, null, 2);
  try {
    fsDriver.writeFileSync(tmpFile, payload, 'utf8');
    fsDriver.renameSync(tmpFile, dataFile);
  } catch (err) {
    try {
      if (fsDriver.existsSync && fsDriver.existsSync(tmpFile) && fsDriver.unlinkSync) {
        fsDriver.unlinkSync(tmpFile);
      }
    } catch (_) {
      // ignore temp cleanup errors
    }
    console.error('Failed to save database state to disk:', err.message);
    throw err;
  }
}

// Seed Data
function seedInitialData() {
  const Security = require('./security');
  
  // Create default password hashes:
  // Admin: Admin@123456
  // Seller: Seller@123456
  // Buyer: Buyer@123456
  const defaultSalt = 'a1b2c3d4e5f60718';
  const adminKey = crypto.scryptSync('Admin@123456', defaultSalt, 64).toString('hex');
  const sellerKey = crypto.scryptSync('Seller@123456', defaultSalt, 64).toString('hex');
  const buyerKey = crypto.scryptSync('Buyer@123456', defaultSalt, 64).toString('hex');

  dbState.users = [
    {
      id: 'usr_admin_01',
      email: 'admin@sigmacar.vn',
      fullName: 'Hệ Thống Quản Trị SIGMACAR',
      role: ROLES.ADMIN,
      phone: '+84 1900 8888',
      branchId: 'all',
      branchIds: ['hn-caugiay', 'hn-longbien', 'hcm-q7', 'hcm-thuduc', 'dn-haichau'],
      sessionVersion: 1,
      disabledAt: null,
      passwordHash: `${defaultSalt}:${adminKey}`,
      createdAt: new Date().toISOString()
    },
    {
      id: 'usr_seller_01',
      email: 'minhphan.seller@sigmacar.vn',
      fullName: 'Minh Phan - Chuyên Viên Tư Vấn SIGMACAR',
      role: ROLES.SELLER,
      phone: '+84 1900 8889',
      branchId: 'hn-caugiay',
      branchIds: ['hn-caugiay'],
      branchName: 'Showroom SIGMACAR Cầu Giấy (Hà Nội)',
      sessionVersion: 1,
      disabledAt: null,
      passwordHash: `${defaultSalt}:${sellerKey}`,
      createdAt: new Date().toISOString()
    },
    {
      id: 'usr_seller_hcm',
      email: 'linhnguyen.seller@sigmacar.vn',
      fullName: 'Linh Nguyễn - Chuyên Viên Tư Vấn Quận 7',
      role: ROLES.SELLER,
      phone: '+84 1900 8890',
      branchId: 'hcm-q7',
      branchIds: ['hcm-q7'],
      branchName: 'Showroom SIGMACAR Quận 7 (TP.HCM)',
      sessionVersion: 1,
      disabledAt: null,
      passwordHash: `${defaultSalt}:${sellerKey}`,
      createdAt: new Date().toISOString()
    },
    {
      id: 'usr_buyer_01',
      email: 'minhhoang.sigma@example.com',
      fullName: 'Minh Hoàng',
      role: ROLES.BUYER,
      phone: '+84 912 345 678',
      sessionVersion: 1,
      disabledAt: null,
      passwordHash: `${defaultSalt}:${buyerKey}`,
      createdAt: new Date().toISOString()
    },
    {
      id: 'usr_buyer_02',
      email: 'thanhthao.ev@example.com',
      fullName: 'Phạm Thanh Thảo',
      role: ROLES.BUYER,
      phone: '+84 908 765 432',
      sessionVersion: 1,
      disabledAt: null,
      passwordHash: `${defaultSalt}:${buyerKey}`,
      createdAt: new Date().toISOString()
    }
  ];

  dbState.vehicles = [
    {
        "id": "honda-civic-eg6-1991",
        "productCode": "HND-EG6-91",
        "name": "Honda Civic SiR-II (EG6)",
        "brand": "Honda",
        "version": "SiR-II VTEC (1991)",
        "subtitle": "Hatchback Thể Thao JDM Huyền Thoại • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Hatchback",
        "subCategory": "Hatchback Thể Thao JDM Huyền Thoại",
        "fuel": "gas",
        "price": 450000000,
        "priceFormatted": "450.000.000 VNĐ",
        "priceShort": "450 triệu",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá sưu tầm xe cổ JDM nguyên bản nhập khẩu",
        "badge": "Huyền thoại JDM",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 170,
        "power": "170 HP (125 kW) @ 7.800 rpm",
        "engine": "1.6L B16A DOHC VTEC Hút khí tự nhiên (Redline 8.200 rpm)",
        "powertrain": "Động cơ Xăng 1.6L B16A DOHC VTEC, Hộp số sàn 5 cấp, Cầu trước FWD",
        "torque": "157 Nm @ 7.300 rpm",
        "acceleration": "7.2s",
        "topSpeed": "215 km/h",
        "transmission": "Số sàn 5 cấp (5-Speed Manual)",
        "drive": "FWD / Cầu trước",
        "seats": 4,
        "dimensions": "4.070 x 1.695 x 1.350 mm",
        "wheelbase": "2.570 mm",
        "groundClearance": "140 mm",
        "dimensionsDetail": {
            "overall": "4.070 x 1.695 x 1.350 mm",
            "lengthMm": 4070,
            "widthMm": 1695,
            "heightMm": 1350,
            "wheelbase": "2.570 mm",
            "groundClearance": "140 mm",
            "curbWeight": "1.050 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 1991,
        "warranty": "Bảo dưỡng định kỳ 6 tháng hoặc 5.000 km cho xe cổ sưu tầm",
        "warrantyDetail": {
            "policy": "Bảo dưỡng định kỳ 6 tháng hoặc 5.000 km cho xe cổ sưu tầm"
        },
        "image": "assets/vehicles/honda-civic-eg6-1991/images/exterior/eg6-sir-passenger-side-profile.avif",
        "thumbnail": "assets/vehicles/honda-civic-eg6-1991/images/exterior/eg6-sir-passenger-side-profile.avif",
        "cover": "assets/vehicles/honda-civic-eg6-1991/images/exterior/eg6-sir-passenger-side-profile.avif",
        "galleryImages": [
            "assets/vehicles/honda-civic-eg6-1991/images/exterior/eg6-sir-passenger-side-profile.avif",
            "assets/vehicles/honda-civic-eg6-1991/images/interior/images (2).jpg",
            "assets/vehicles/honda-civic-eg6-1991/images/dashboard/images (1).jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/honda-civic-eg6-1991/images/exterior/eg6-sir-passenger-side-profile.avif"
            ],
            "interior": [
                "assets/vehicles/honda-civic-eg6-1991/images/interior/images (2).jpg"
            ],
            "dashboard": [
                "assets/vehicles/honda-civic-eg6-1991/images/dashboard/images (1).jpg"
            ],
            "engine": [],
            "specifications": [],
            "gallery": []
        },
        "colors": [
            {
                "name": "Đỏ Thể Thao Milano Red",
                "hex": "#DC2626",
                "img": "assets/vehicles/honda-civic-eg6-1991/images/exterior/eg6-sir-passenger-side-profile.avif"
            },
            {
                "name": "Trắng Ngọc Frost White",
                "hex": "#F8FAFC",
                "img": "assets/vehicles/honda-civic-eg6-1991/images/interior/images (2).jpg"
            },
            {
                "name": "Đen Flint Black Metallic",
                "hex": "#0F172A",
                "img": "assets/vehicles/honda-civic-eg6-1991/images/dashboard/images (1).jpg"
            },
            {
                "name": "Xanh Ngọc Captiva Blue",
                "hex": "#0284C7",
                "img": "assets/vehicles/honda-civic-eg6-1991/images/exterior/eg6-sir-passenger-side-profile.avif"
            }
        ],
        "colorsSummary": "Đỏ Thể Thao Milano Red, Trắng Ngọc Frost White, Đen Flint Black Metallic, Xanh Ngọc Captiva Blue",
        "evSpecs": null,
        "features": [
            "Huyền thoại động cơ B16A DOHC VTEC đầu tiên đạt tỷ lệ công suất 100 HP/lít",
            "Hệ thống treo độc lập 4 bánh tay đòn kép (Double Wishbone Suspension) chuẩn đua",
            "Trọng lượng siêu nhẹ chỉ 1.050 kg mang lại cảm giác lái thuần khiết, linh hoạt",
            "Vô lăng 3 chấu thể thao cổ điển cùng ghế nỉ thể thao ôm sát người lái",
            "Cánh gió sau khí động học tích hợp đèn phanh LED trên cao"
        ],
        "description": "Chiếc hatchback JDM huyền thoại thế hệ thứ 5 của Honda với động cơ B16A VTEC trứ danh đạt 170 mã lực ở vòng tua 7.800 rpm, hệ thống treo Double Wishbone và trọng lượng nhẹ vượt trội.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/honda_civic_eg6_1991.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Honda Civic SiR-II (EG6) Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Hatchback Thể Thao JDM Huyền Thoại tối ưu lực ép không khí và khí chất thể thao đặc trưng Honda."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Xăng 1.6L B16A DOHC VTEC, Hộp số sàn 5 cấp, Cầu trước FWD sản sinh công suất 170 HP (125 kW) @ 7.800 rpm cùng gia tốc 7.2s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/honda-civic-eg6-1991/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/honda-civic-eg6-1991/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "honda-civic-type-r-2018",
        "productCode": "HND-FK8-18",
        "name": "Honda Civic Type R (FK8)",
        "brand": "Honda",
        "version": "FK8 Turbocharged Hot Hatch",
        "subtitle": "Hatchback Hiệu Năng Cao Cỡ Nhỏ • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Hatchback",
        "subCategory": "Hatchback Hiệu Năng Cao Cỡ Nhỏ",
        "fuel": "gas",
        "price": 2399000000,
        "priceFormatted": "2.399.000.000 VNĐ",
        "priceShort": "2.399 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá niêm yết phân phối chính hãng tại Việt Nam",
        "badge": "Chúa tể FWD",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 310,
        "power": "310 HP (228 kW) @ 6.500 rpm",
        "engine": "2.0L VTEC Turbo K20C1 (Tăng áp cuộn đôi Single-Scroll)",
        "powertrain": "Động cơ Xăng 2.0L VTEC Turbo, Hộp số sàn 6 cấp tích hợp Rev-Match, Cầu trước FWD có vi sai xoắn LSD",
        "torque": "400 Nm @ 2.500 - 4.500 rpm",
        "acceleration": "5.7s",
        "topSpeed": "272 km/h",
        "transmission": "Số sàn 6 cấp (6-Speed Manual với tính năng tự vù ga Rev-Matching)",
        "drive": "FWD / Cầu trước + Vi sai chống trượt Helical LSD",
        "seats": 4,
        "dimensions": "4.557 x 1.877 x 1.434 mm",
        "wheelbase": "2.699 mm",
        "groundClearance": "132 mm",
        "dimensionsDetail": {
            "overall": "4.557 x 1.877 x 1.434 mm",
            "lengthMm": 4557,
            "widthMm": 1877,
            "heightMm": 1434,
            "wheelbase": "2.699 mm",
            "groundClearance": "132 mm",
            "curbWeight": "1.390 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2018,
        "warranty": "3 năm hoặc 100.000 km chính hãng Honda Việt Nam",
        "warrantyDetail": {
            "policy": "3 năm hoặc 100.000 km chính hãng Honda Việt Nam"
        },
        "image": "assets/vehicles/honda-civic-type-r-2018/images/exterior/images (4).jpg",
        "thumbnail": "assets/vehicles/honda-civic-type-r-2018/images/exterior/images (4).jpg",
        "cover": "assets/vehicles/honda-civic-type-r-2018/images/exterior/images (4).jpg",
        "galleryImages": [
            "assets/vehicles/honda-civic-type-r-2018/images/exterior/images (4).jpg",
            "assets/vehicles/honda-civic-type-r-2018/images/interior/images (3).jpg",
            "assets/vehicles/honda-civic-type-r-2018/images/dashboard/images (5).jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/honda-civic-type-r-2018/images/exterior/images (4).jpg"
            ],
            "interior": [
                "assets/vehicles/honda-civic-type-r-2018/images/interior/images (3).jpg"
            ],
            "dashboard": [
                "assets/vehicles/honda-civic-type-r-2018/images/dashboard/images (5).jpg"
            ],
            "engine": [],
            "specifications": [],
            "gallery": []
        },
        "colors": [
            {
                "name": "Trắng Championship White",
                "hex": "#F1F5F9",
                "img": "assets/vehicles/honda-civic-type-r-2018/images/exterior/images (4).jpg"
            },
            {
                "name": "Đỏ Rallye Red",
                "hex": "#EF4444",
                "img": "assets/vehicles/honda-civic-type-r-2018/images/interior/images (3).jpg"
            },
            {
                "name": "Xanh Boost Blue Pearl",
                "hex": "#0284C7",
                "img": "assets/vehicles/honda-civic-type-r-2018/images/dashboard/images (5).jpg"
            },
            {
                "name": "Đen Crystal Black Pearl",
                "hex": "#0F172A",
                "img": "assets/vehicles/honda-civic-type-r-2018/images/exterior/images (4).jpg"
            }
        ],
        "colorsSummary": "Trắng Championship White, Đỏ Rallye Red, Xanh Boost Blue Pearl, Đen Crystal Black Pearl",
        "evSpecs": null,
        "features": [
            "Kỷ lục xe cầu trước (FWD) nhanh nhất đường đua Nürburgring Nordschleife thời điểm ra mắt",
            "Hệ thống phanh hiệu năng cao Brembo 4 piston đĩa thông gió 350 mm",
            "Hệ thống treo thích ứng Adaptive Damper System (ADS) 3 chế độ (Comfort, Sport, +R)",
            "Ghế thể thao Type R bọc da lộn Alcantara đỏ rực ôm lưng cực chắc",
            "Cánh lướt gió sợi carbon cỡ lớn tăng lực ép xuống mặt đường (Downforce) ở tốc độ cao"
        ],
        "description": "Vua đường đua FWD thế hệ FK8 sở hữu động cơ 2.0L VTEC Turbo 310 mã lực, hộp số sàn 6 cấp chuẩn xác, hệ thống treo thích ứng ADS và cánh gió khí động học tối ưu.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/honda_civic_type_r_2018.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Honda Civic Type R (FK8) Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Hatchback Hiệu Năng Cao Cỡ Nhỏ tối ưu lực ép không khí và khí chất thể thao đặc trưng Honda."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Xăng 2.0L VTEC Turbo, Hộp số sàn 6 cấp tích hợp Rev-Match, Cầu trước FWD có vi sai xoắn LSD sản sinh công suất 310 HP (228 kW) @ 6.500 rpm cùng gia tốc 5.7s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/honda-civic-type-r-2018/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/honda-civic-type-r-2018/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "bugatti-chiron",
        "productCode": "BUG-CH-01",
        "name": "Bugatti Chiron",
        "brand": "Bugatti",
        "version": "W16 Quad-Turbo 1500 HP",
        "subtitle": "Hypercar Độc Bản Xa Xỉ Nhất Thế Giới • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Siêu Xe",
        "subCategory": "Hypercar Độc Bản Xa Xỉ Nhất Thế Giới",
        "fuel": "gas",
        "price": 68000000000,
        "priceFormatted": "68.000.000.000 VNĐ",
        "priceShort": "68 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá ước tính lăn bánh nhập khẩu tư nhân tại Việt Nam (~3.000.000 USD)",
        "badge": "Hypercar 1500HP",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 1500,
        "power": "1.500 HP (1.103 kW) @ 6.700 rpm",
        "engine": "8.0L W16 Quad-Turbo (4 bộ tăng áp 2 giai đoạn)",
        "powertrain": "Động cơ Xăng W16 8.0L 4 Turbo, Hộp số ly hợp kép 7 cấp DSG, Dẫn động 4 bánh toàn thời gian AWD",
        "torque": "1.600 Nm @ 2.000 - 6.000 rpm",
        "acceleration": "2.4s",
        "topSpeed": "420 km/h (Giới hạn điện tử) / 490 km/h",
        "transmission": "Ly hợp kép 7 cấp (7-Speed Dual-Clutch Ricardo)",
        "drive": "AWD / Dẫn động 4 bánh toàn thời gian thông minh",
        "seats": 2,
        "dimensions": "4.544 x 2.038 x 1.212 mm",
        "wheelbase": "2.711 mm",
        "groundClearance": "115 mm (Hạ thấp 80 mm ở chế độ Top Speed)",
        "dimensionsDetail": {
            "overall": "4.544 x 2.038 x 1.212 mm",
            "lengthMm": 4544,
            "widthMm": 2038,
            "heightMm": 1212,
            "wheelbase": "2.711 mm",
            "groundClearance": "115 mm",
            "curbWeight": "1.995 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2024,
        "warranty": "Bảo hành toàn cầu không giới hạn của Bugatti Flying Doctor Service",
        "warrantyDetail": {
            "policy": "Bảo hành toàn cầu không giới hạn của Bugatti Flying Doctor Service"
        },
        "image": "assets/vehicles/bugatti-chiron/images/exterior/li3117904front_2c_merged_r.jpg",
        "thumbnail": "assets/vehicles/bugatti-chiron/images/exterior/li3117904front_2c_merged_r.jpg",
        "cover": "assets/vehicles/bugatti-chiron/images/exterior/li3117904front_2c_merged_r.jpg",
        "galleryImages": [
            "assets/vehicles/bugatti-chiron/images/exterior/li3117904front_2c_merged_r.jpg",
            "assets/vehicles/bugatti-chiron/images/interior/5.jpg",
            "assets/vehicles/bugatti-chiron/images/dashboard/4.jpg",
            "assets/vehicles/bugatti-chiron/images/engine/3.jpg",
            "assets/vehicles/bugatti-chiron/images/gallery/1.jpg",
            "assets/vehicles/bugatti-chiron/images/gallery/2.jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/bugatti-chiron/images/exterior/li3117904front_2c_merged_r.jpg"
            ],
            "interior": [
                "assets/vehicles/bugatti-chiron/images/interior/5.jpg"
            ],
            "dashboard": [
                "assets/vehicles/bugatti-chiron/images/dashboard/4.jpg"
            ],
            "engine": [
                "assets/vehicles/bugatti-chiron/images/engine/3.jpg"
            ],
            "specifications": [],
            "gallery": [
                "assets/vehicles/bugatti-chiron/images/gallery/1.jpg",
                "assets/vehicles/bugatti-chiron/images/gallery/2.jpg"
            ]
        },
        "colors": [
            {
                "name": "Xanh Bugatti Atlantic Blue",
                "hex": "#1E3A8A",
                "img": "assets/vehicles/bugatti-chiron/images/exterior/li3117904front_2c_merged_r.jpg"
            },
            {
                "name": "Đen Carbon Dạ Kim",
                "hex": "#0B0F19",
                "img": "assets/vehicles/bugatti-chiron/images/interior/5.jpg"
            },
            {
                "name": "Bạc Pháp French Racing Blue & Chrome",
                "hex": "#38BDF8",
                "img": "assets/vehicles/bugatti-chiron/images/dashboard/4.jpg"
            }
        ],
        "colorsSummary": "Xanh Bugatti Atlantic Blue, Đen Carbon Dạ Kim, Bạc Pháp French Racing Blue & Chrome",
        "evSpecs": null,
        "features": [
            "Động cơ W16 8.0 lít 4 tăng áp đạt công suất không tưởng 1.500 mã lực",
            "Khung gầm nguyên khối bằng sợi carbon đạt độ cứng vặn xoắn 50.000 Nm/độ (ngang xe đua LMP1)",
            "Hệ thống cánh gió chủ động Airbrake hỗ trợ phanh từ 400 km/h về 0 chỉ trong 9.3 giây",
            "Đèn pha LED 4 bóng vuông biểu tượng kết hợp dải đèn hậu LED liền mạch 1.6m dài nhất thế giới",
            "Khoang lái bọc da thủ công cao cấp nhất nước Pháp, không có bất kỳ màn hình kỹ thuật số nào lỗi thời"
        ],
        "description": "Tuyệt tác cơ khí xa xỉ bậc nhất hành tinh với động cơ W16 8.0L Quad-Turbo 1.500 mã lực, tăng tốc 0-100 km/h trong 2.4 giây, tốc độ tối đa vượt 420 km/h.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/bugatti_chiron.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Bugatti Chiron Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Hypercar Độc Bản Xa Xỉ Nhất Thế Giới tối ưu lực ép không khí và khí chất thể thao đặc trưng Bugatti."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Xăng W16 8.0L 4 Turbo, Hộp số ly hợp kép 7 cấp DSG, Dẫn động 4 bánh toàn thời gian AWD sản sinh công suất 1.500 HP (1.103 kW) @ 6.700 rpm cùng gia tốc 2.4s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/bugatti-chiron/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/bugatti-chiron/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "ferrari-f50-1995",
        "productCode": "FER-F50-95",
        "name": "Ferrari F50",
        "brand": "Ferrari",
        "version": "Kỷ Niệm 50 Năm Ferrari (1995)",
        "subtitle": "Siêu Xe F1 Cho Đường Phố (Chỉ 349 Chiếc Toàn Cầu) • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Siêu Xe",
        "subCategory": "Siêu Xe F1 Cho Đường Phố (Chỉ 349 Chiếc Toàn Cầu)",
        "fuel": "gas",
        "price": 85000000000,
        "priceFormatted": "85.000.000.000 VNĐ",
        "priceShort": "85 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá đấu giá sưu tầm quốc tế quy đổi VNĐ (~3.5 - 4.5 triệu USD)",
        "badge": "Ferrari F1 Heritage",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 520,
        "power": "520 HP (382 kW) @ 8.500 rpm",
        "engine": "4.7L V12 DOHC 60 van (Phát triển trực tiếp từ động cơ Ferrari F1 Tipo 036)",
        "powertrain": "Động cơ V12 4.7L Hút khí tự nhiên đặt giữa, Hộp số sàn 6 cấp, Cầu sau RWD",
        "torque": "471 Nm @ 6.500 rpm",
        "acceleration": "3.87s",
        "topSpeed": "325 km/h",
        "transmission": "Số sàn 6 cấp có rãnh chuyển số kim loại (6-Speed Gated Manual)",
        "drive": "RWD / Cầu sau",
        "seats": 2,
        "dimensions": "4.480 x 1.986 x 1.120 mm",
        "wheelbase": "2.580 mm",
        "groundClearance": "110 mm",
        "dimensionsDetail": {
            "overall": "4.480 x 1.986 x 1.120 mm",
            "lengthMm": 4480,
            "widthMm": 1986,
            "heightMm": 1120,
            "wheelbase": "2.580 mm",
            "groundClearance": "110 mm",
            "curbWeight": "1.230 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 1995,
        "warranty": "Chứng chỉ Ferrari Classiche xác thực nguyên bản 100%",
        "warrantyDetail": {
            "policy": "Chứng chỉ Ferrari Classiche xác thực nguyên bản 100%"
        },
        "image": "assets/vehicles/ferrari-f50-1995/images/exterior/5.jpg",
        "thumbnail": "assets/vehicles/ferrari-f50-1995/images/exterior/5.jpg",
        "cover": "assets/vehicles/ferrari-f50-1995/images/exterior/5.jpg",
        "galleryImages": [
            "assets/vehicles/ferrari-f50-1995/images/exterior/5.jpg",
            "assets/vehicles/ferrari-f50-1995/images/interior/7.jpg",
            "assets/vehicles/ferrari-f50-1995/images/dashboard/9.jpg",
            "assets/vehicles/ferrari-f50-1995/images/engine/8.jpg",
            "assets/vehicles/ferrari-f50-1995/images/gallery/3.webp",
            "assets/vehicles/ferrari-f50-1995/images/gallery/4.jpg",
            "assets/vehicles/ferrari-f50-1995/images/gallery/1.webp",
            "assets/vehicles/ferrari-f50-1995/images/gallery/2.png",
            "assets/vehicles/ferrari-f50-1995/images/gallery/6.jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/ferrari-f50-1995/images/exterior/5.jpg"
            ],
            "interior": [
                "assets/vehicles/ferrari-f50-1995/images/interior/7.jpg"
            ],
            "dashboard": [
                "assets/vehicles/ferrari-f50-1995/images/dashboard/9.jpg"
            ],
            "engine": [
                "assets/vehicles/ferrari-f50-1995/images/engine/8.jpg"
            ],
            "specifications": [],
            "gallery": [
                "assets/vehicles/ferrari-f50-1995/images/gallery/3.webp",
                "assets/vehicles/ferrari-f50-1995/images/gallery/4.jpg",
                "assets/vehicles/ferrari-f50-1995/images/gallery/1.webp",
                "assets/vehicles/ferrari-f50-1995/images/gallery/2.png",
                "assets/vehicles/ferrari-f50-1995/images/gallery/6.jpg"
            ]
        },
        "colors": [
            {
                "name": "Đỏ Truyền Thống Rosso Corsa",
                "hex": "#DC2626",
                "img": "assets/vehicles/ferrari-f50-1995/images/exterior/5.jpg"
            },
            {
                "name": "Vàng Giallo Modena",
                "hex": "#FACC15",
                "img": "assets/vehicles/ferrari-f50-1995/images/interior/7.jpg"
            },
            {
                "name": "Đen Nero",
                "hex": "#0B0F19",
                "img": "assets/vehicles/ferrari-f50-1995/images/dashboard/9.jpg"
            }
        ],
        "colorsSummary": "Đỏ Truyền Thống Rosso Corsa, Vàng Giallo Modena, Đen Nero",
        "evSpecs": null,
        "features": [
            "Động cơ F1 V12 được bắt ốc trực tiếp vào khung gầm carbon đóng vai trò cấu trúc chịu lực",
            "Thân vỏ hoàn toàn bằng sợi Carbon và Kevlar siêu nhẹ mang lại trọng lượng chỉ 1.230 kg",
            "Hộp số sàn 6 cấp rãnh lộ thiên với cần số kim loại tiếng gõ cơ khí đặc trưng Ferrari",
            "Mui trần tháo rời Barchetta độc đáo chuyển đổi giữa Coupe và Roadster",
            "Không trang bị trợ lực lái, không ABS, không phanh trợ lực — cảm giác lái thuần chất F1"
        ],
        "description": "Cỗ máy Formula 1 hợp pháp trên đường phố kỷ niệm 50 năm thành lập Ferrari với khối động cơ V12 4.7L 520 mã lực, hộp số sàn rãnh số kim loại và chỉ 349 chiếc toàn cầu.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/ferrari_f50_1995.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Ferrari F50 Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Siêu Xe F1 Cho Đường Phố (Chỉ 349 Chiếc Toàn Cầu) tối ưu lực ép không khí và khí chất thể thao đặc trưng Ferrari."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ V12 4.7L Hút khí tự nhiên đặt giữa, Hộp số sàn 6 cấp, Cầu sau RWD sản sinh công suất 520 HP (382 kW) @ 8.500 rpm cùng gia tốc 3.87s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/ferrari-f50-1995/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/ferrari-f50-1995/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "honda-civic-rs",
        "productCode": "HND-CVRS-25",
        "name": "Honda Civic RS",
        "brand": "Honda",
        "version": "RS 1.5L VTEC Turbo (Thế hệ mới 2025)",
        "subtitle": "Sedan Thể Thao Hạng C Phổ Biến Nhất • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Sedan",
        "subCategory": "Sedan Thể Thao Hạng C Phổ Biến Nhất",
        "fuel": "gas",
        "price": 889000000,
        "priceFormatted": "889.000.000 VNĐ",
        "priceShort": "889 triệu",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá niêm yết chính hãng Honda Việt Nam",
        "badge": "Sedan C Best-Seller",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 178,
        "power": "178 HP (131 kW) @ 6.000 rpm",
        "engine": "1.5L DOHC VTEC Turbo 4 xi-lanh thẳng hàng",
        "powertrain": "Động cơ Xăng 1.5L VTEC Turbo, Hộp số tự động vô cấp CVT với lẫy chuyển số 7 cấp giả lập, Cầu trước FWD",
        "torque": "240 Nm @ 1.700 - 4.500 rpm",
        "acceleration": "7.8s",
        "topSpeed": "210 km/h",
        "transmission": "Vô cấp CVT thể thao tích hợp lẫy chuyển số",
        "drive": "FWD / Cầu trước",
        "seats": 5,
        "dimensions": "4.678 x 1.802 x 1.415 mm",
        "wheelbase": "2.735 mm",
        "groundClearance": "134 mm",
        "dimensionsDetail": {
            "overall": "4.678 x 1.802 x 1.415 mm",
            "lengthMm": 4678,
            "widthMm": 1802,
            "heightMm": 1415,
            "wheelbase": "2.735 mm",
            "groundClearance": "134 mm",
            "curbWeight": "1.340 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2025,
        "warranty": "3 năm hoặc 100.000 km chính hãng Honda",
        "warrantyDetail": {
            "policy": "3 năm hoặc 100.000 km chính hãng Honda"
        },
        "image": "assets/vehicles/honda-civic-rs/images/exterior/hondacivic2_BLJY.jpg",
        "thumbnail": "assets/vehicles/honda-civic-rs/images/exterior/hondacivic2_BLJY.jpg",
        "cover": "assets/vehicles/honda-civic-rs/images/exterior/hondacivic2_BLJY.jpg",
        "galleryImages": [
            "assets/vehicles/honda-civic-rs/images/exterior/hondacivic2_BLJY.jpg",
            "assets/vehicles/honda-civic-rs/images/interior/rr0xxmw-2726561j33001.webp",
            "assets/vehicles/honda-civic-rs/images/dashboard/9q57xms-2726324j29010.webp",
            "assets/vehicles/honda-civic-rs/images/engine/2727309-2727415j32854.webp",
            "assets/vehicles/honda-civic-rs/images/gallery/honda-civic-2025-1.webp",
            "assets/vehicles/honda-civic-rs/images/gallery/images.jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/honda-civic-rs/images/exterior/hondacivic2_BLJY.jpg"
            ],
            "interior": [
                "assets/vehicles/honda-civic-rs/images/interior/rr0xxmw-2726561j33001.webp"
            ],
            "dashboard": [
                "assets/vehicles/honda-civic-rs/images/dashboard/9q57xms-2726324j29010.webp"
            ],
            "engine": [
                "assets/vehicles/honda-civic-rs/images/engine/2727309-2727415j32854.webp"
            ],
            "specifications": [],
            "gallery": [
                "assets/vehicles/honda-civic-rs/images/gallery/honda-civic-2025-1.webp",
                "assets/vehicles/honda-civic-rs/images/gallery/images.jpg"
            ]
        },
        "colors": [
            {
                "name": "Đỏ Thể Thao Ignite Red Metallic",
                "hex": "#DC2626",
                "img": "assets/vehicles/honda-civic-rs/images/exterior/hondacivic2_BLJY.jpg"
            },
            {
                "name": "Trắng Ngọc Trai Platinum White Pearl",
                "hex": "#F8FAFC",
                "img": "assets/vehicles/honda-civic-rs/images/interior/rr0xxmw-2726561j33001.webp"
            },
            {
                "name": "Đen Ánh Độc Tôn Crystal Black Pearl",
                "hex": "#0F172A",
                "img": "assets/vehicles/honda-civic-rs/images/dashboard/9q57xms-2726324j29010.webp"
            },
            {
                "name": "Xám Xi Măng Meteoroid Gray",
                "hex": "#64748B",
                "img": "assets/vehicles/honda-civic-rs/images/engine/2727309-2727415j32854.webp"
            }
        ],
        "colorsSummary": "Đỏ Thể Thao Ignite Red Metallic, Trắng Ngọc Trai Platinum White Pearl, Đen Ánh Độc Tôn Crystal Black Pearl, Xám Xi Măng Meteoroid Gray",
        "evSpecs": null,
        "features": [
            "Gói công nghệ an toàn chủ động Honda SENSING thế hệ mới với Camera góc rộng",
            "Hệ thống âm thanh 12 loa Bose cao cấp với công nghệ Centerpoint và SurroundStage",
            "Bảng đồng hồ kỹ thuật số 10.2 inch kết hợp màn hình giải trí 9 inch Apple CarPlay không dây",
            "Ghế bọc da lộn thể thao thêu chỉ đỏ tương phản phong cách Type R",
            "Ứng dụng kết nối thông minh Honda CONNECT quản lý xe từ điện thoại 24/7"
        ],
        "description": "Mẫu sedan thể thao dẫn đầu phân khúc C với động cơ 1.5L VTEC Turbo 178 mã lực, gói an toàn Honda SENSING, dàn âm thanh 12 loa Bose và thiết kế lịch lãm pha chất đua.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/honda_civic_rs.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Honda Civic RS Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Sedan Thể Thao Hạng C Phổ Biến Nhất tối ưu lực ép không khí và khí chất thể thao đặc trưng Honda."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Xăng 1.5L VTEC Turbo, Hộp số tự động vô cấp CVT với lẫy chuyển số 7 cấp giả lập, Cầu trước FWD sản sinh công suất 178 HP (131 kW) @ 6.000 rpm cùng gia tốc 7.8s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/honda-civic-rs/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/honda-civic-rs/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "honda-accord-euro-r",
        "productCode": "HND-CL7-ER",
        "name": "Honda Accord Euro-R (CL7)",
        "brand": "Honda",
        "version": "CL7 Euro-R JDM Spec",
        "subtitle": "Sedan Thể Thao Hiệu Năng Cao JDM • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Sedan",
        "subCategory": "Sedan Thể Thao Hiệu Năng Cao JDM",
        "fuel": "gas",
        "price": 950000000,
        "priceFormatted": "950.000.000 VNĐ",
        "priceShort": "950 triệu",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá xe sưu tầm nhập khẩu JDM tham khảo",
        "badge": "JDM Legend VTEC",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 220,
        "power": "220 HP (162 kW) @ 8.000 rpm",
        "engine": "2.0L K20A DOHC i-VTEC Hút khí tự nhiên (Nắp máy đỏ Red Top)",
        "powertrain": "Động cơ Xăng 2.0L K20A DOHC i-VTEC, Hộp số sàn 6 cấp tỷ số truyền ngắn, Vi sai xoắn Helical LSD, Cầu trước FWD",
        "torque": "206 Nm @ 6.000 rpm",
        "acceleration": "6.7s",
        "topSpeed": "235 km/h",
        "transmission": "Số sàn 6 cấp (6-Speed Manual với cần số nhôm tiện nguyên khối)",
        "drive": "FWD / Cầu trước + Helical Limited Slip Differential (LSD)",
        "seats": 5,
        "dimensions": "4.665 x 1.760 x 1.445 mm",
        "wheelbase": "2.670 mm",
        "groundClearance": "140 mm",
        "dimensionsDetail": {
            "overall": "4.665 x 1.760 x 1.445 mm",
            "lengthMm": 4665,
            "widthMm": 1760,
            "heightMm": 1445,
            "wheelbase": "2.670 mm",
            "groundClearance": "140 mm",
            "curbWeight": "1.390 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2006,
        "warranty": "Kiểm định 176 điểm chính hãng SIGMACAR Certified",
        "warrantyDetail": {
            "policy": "Kiểm định 176 điểm chính hãng SIGMACAR Certified"
        },
        "image": "assets/vehicles/honda-accord-euro-r/images/exterior/4.jpg",
        "thumbnail": "assets/vehicles/honda-accord-euro-r/images/exterior/4.jpg",
        "cover": "assets/vehicles/honda-accord-euro-r/images/exterior/4.jpg",
        "galleryImages": [
            "assets/vehicles/honda-accord-euro-r/images/exterior/4.jpg",
            "assets/vehicles/honda-accord-euro-r/images/interior/3.webp",
            "assets/vehicles/honda-accord-euro-r/images/dashboard/7.jpg",
            "assets/vehicles/honda-accord-euro-r/images/engine/2.webp",
            "assets/vehicles/honda-accord-euro-r/images/gallery/1.webp"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/honda-accord-euro-r/images/exterior/4.jpg"
            ],
            "interior": [
                "assets/vehicles/honda-accord-euro-r/images/interior/3.webp"
            ],
            "dashboard": [
                "assets/vehicles/honda-accord-euro-r/images/dashboard/7.jpg"
            ],
            "engine": [
                "assets/vehicles/honda-accord-euro-r/images/engine/2.webp"
            ],
            "specifications": [],
            "gallery": [
                "assets/vehicles/honda-accord-euro-r/images/gallery/1.webp"
            ]
        },
        "colors": [
            {
                "name": "Trắng Ngọc Arctic White Pearl",
                "hex": "#F8FAFC",
                "img": "assets/vehicles/honda-accord-euro-r/images/exterior/4.jpg"
            },
            {
                "name": "Xanh Ánh Kim Nighthawk Blue Pearl",
                "hex": "#1E3A8A",
                "img": "assets/vehicles/honda-accord-euro-r/images/interior/3.webp"
            },
            {
                "name": "Bạc Satin Silver Metallic",
                "hex": "#94A3B8",
                "img": "assets/vehicles/honda-accord-euro-r/images/dashboard/7.jpg"
            }
        ],
        "colorsSummary": "Trắng Ngọc Arctic White Pearl, Xanh Ánh Kim Nighthawk Blue Pearl, Bạc Satin Silver Metallic",
        "evSpecs": null,
        "features": [
            "Khối động cơ K20A Red Top danh tiếng xoay vòng tua lên tới 8.300 rpm",
            "Ghế thể thao bọc da lộn Recaro chính hãng tiêu chuẩn ôm sát cơ thể",
            "Vô lăng thể thao 3 chấu bọc da Momo tích hợp logo Honda đỏ JDM",
            "Bộ vi sai xoắn Helical LSD dập tắt hiện tượng trượt bánh khi bo cua tốc độ cao",
            "Hệ thống treo tay đòn kép trước Double Wishbone và đa liên kết thể thao sau"
        ],
        "description": "Biểu tượng sedan thể thao JDM của Honda với động cơ K20A 220 mã lực vòng tua 8.000 rpm, ghế Recaro, vô lăng Momo và hộp số sàn 6 cấp tỉ số truyền ngắn.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/honda_accord_euro_r.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Honda Accord Euro-R (CL7) Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Sedan Thể Thao Hiệu Năng Cao JDM tối ưu lực ép không khí và khí chất thể thao đặc trưng Honda."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Xăng 2.0L K20A DOHC i-VTEC, Hộp số sàn 6 cấp tỷ số truyền ngắn, Vi sai xoắn Helical LSD, Cầu trước FWD sản sinh công suất 220 HP (162 kW) @ 8.000 rpm cùng gia tốc 6.7s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/honda-accord-euro-r/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/honda-accord-euro-r/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "honda-prelude-bp1",
        "productCode": "HND-PRL-26",
        "name": "Honda Prelude Concept (BP1)",
        "brand": "Honda",
        "version": "e:HEV Hybrid Sports Coupe",
        "subtitle": "Xe Thể Thao 2 Cửa Thế Hệ Mới e:HEV • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Coupe",
        "subCategory": "Xe Thể Thao 2 Cửa Thế Hệ Mới e:HEV",
        "fuel": "hybrid",
        "price": 1350000000,
        "priceFormatted": "1.350.000.000 VNĐ",
        "priceShort": "1.35 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá niêm yết dự kiến tại thị trường quốc tế và Việt Nam",
        "badge": "e:HEV Sports Coupe",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 212,
        "power": "212 HP (156 kW), Hệ thống e:HEV 2 Mô-tơ điện",
        "engine": "2.0L Atkinson Cycle 4 xi-lanh kết hợp 2 Mô-tơ điện e:HEV",
        "powertrain": "Hệ truyền động Hybrid e:HEV 2.0L, Hộp số điện tử e-CVT, Cầu trước FWD thể thao",
        "torque": "315 Nm @ 0 - 2.000 rpm",
        "acceleration": "6.4s",
        "topSpeed": "220 km/h",
        "transmission": "Hộp số thể thao e-CVT giả lập cấp số với lẫy chuyển số",
        "drive": "FWD / Cầu trước",
        "seats": 4,
        "dimensions": "4.300 x 1.790 x 1.300 mm",
        "wheelbase": "2.575 mm",
        "groundClearance": "130 mm",
        "dimensionsDetail": {
            "overall": "4.300 x 1.790 x 1.300 mm",
            "lengthMm": 4300,
            "widthMm": 1790,
            "heightMm": 1300,
            "wheelbase": "2.575 mm",
            "groundClearance": "130 mm",
            "curbWeight": "1.420 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2026,
        "warranty": "5 năm hoặc 150.000 km cho toàn bộ hệ thống Pin & Hybrid e:HEV",
        "warrantyDetail": {
            "policy": "5 năm hoặc 150.000 km cho toàn bộ hệ thống Pin & Hybrid e:HEV"
        },
        "image": "assets/vehicles/honda-prelude-bp1/images/exterior/https_www.carscoops.com_wp-content_uploads_2023_10_honda-prelude-concept-1024x576.webp",
        "thumbnail": "assets/vehicles/honda-prelude-bp1/images/exterior/https_www.carscoops.com_wp-content_uploads_2023_10_honda-prelude-concept-1024x576.webp",
        "cover": "assets/vehicles/honda-prelude-bp1/images/exterior/https_www.carscoops.com_wp-content_uploads_2023_10_honda-prelude-concept-1024x576.webp",
        "galleryImages": [
            "assets/vehicles/honda-prelude-bp1/images/exterior/https_www.carscoops.com_wp-content_uploads_2023_10_honda-prelude-concept-1024x576.webp",
            "assets/vehicles/honda-prelude-bp1/images/interior/2026-klims-honda-prelude-colours-9-1260x841-1781253371633-17812533726271282717447.jpg",
            "assets/vehicles/honda-prelude-bp1/images/dashboard/1.jpg",
            "assets/vehicles/honda-prelude-bp1/images/engine/2.jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/honda-prelude-bp1/images/exterior/https_www.carscoops.com_wp-content_uploads_2023_10_honda-prelude-concept-1024x576.webp"
            ],
            "interior": [
                "assets/vehicles/honda-prelude-bp1/images/interior/2026-klims-honda-prelude-colours-9-1260x841-1781253371633-17812533726271282717447.jpg"
            ],
            "dashboard": [
                "assets/vehicles/honda-prelude-bp1/images/dashboard/1.jpg"
            ],
            "engine": [
                "assets/vehicles/honda-prelude-bp1/images/engine/2.jpg"
            ],
            "specifications": [],
            "gallery": []
        },
        "colors": [
            {
                "name": "Trắng Băng Bắc Cực Glacier White",
                "hex": "#F1F5F9",
                "img": "assets/vehicles/honda-prelude-bp1/images/exterior/https_www.carscoops.com_wp-content_uploads_2023_10_honda-prelude-concept-1024x576.webp"
            },
            {
                "name": "Đỏ Thể Thao Cherry Red Pearl",
                "hex": "#B91C1C",
                "img": "assets/vehicles/honda-prelude-bp1/images/interior/2026-klims-honda-prelude-colours-9-1260x841-1781253371633-17812533726271282717447.jpg"
            },
            {
                "name": "Xanh Navy Dạ Quang Deep Pearl Blue",
                "hex": "#1E293B",
                "img": "assets/vehicles/honda-prelude-bp1/images/dashboard/1.jpg"
            }
        ],
        "colorsSummary": "Trắng Băng Bắc Cực Glacier White, Đỏ Thể Thao Cherry Red Pearl, Xanh Navy Dạ Quang Deep Pearl Blue",
        "evSpecs": null,
        "features": [
            "Sự hồi sinh của huyền thoại Prelude với ngôn ngữ thiết kế vị lai khí động học",
            "Động cơ Hybrid thể thao e:HEV tăng tốc tức thì nhờ mô-men xoắn điện 315 Nm",
            "Mui xe vuốt dốc fastback bằng sợi carbon giảm trọng tâm tối đa",
            "Cụm đèn pha LED mắt híp ma mị trải dài toàn bộ đầu xe",
            "Hệ thống đánh lái 4 bánh 4WS điện tử thế hệ mới nhất của Honda"
        ],
        "description": "Sự trở lại của biểu tượng thể thao 2 cửa Prelude với hệ truyền động Hybrid e:HEV tiên tiến, kiểu dáng khí động học coupe và khả năng phản hồi chân ga tức thì.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/honda_prelude_bp1.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Honda Prelude Concept (BP1) Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Xe Thể Thao 2 Cửa Thế Hệ Mới e:HEV tối ưu lực ép không khí và khí chất thể thao đặc trưng Honda."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Hệ truyền động Hybrid e:HEV 2.0L, Hộp số điện tử e-CVT, Cầu trước FWD thể thao sản sinh công suất 212 HP (156 kW), Hệ thống e:HEV 2 Mô-tơ điện cùng gia tốc 6.4s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/honda-prelude-bp1/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/honda-prelude-bp1/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "hyundai-elantra-n-2024",
        "productCode": "HYU-ELN-24",
        "name": "Hyundai Elantra N (2024)",
        "brand": "Hyundai",
        "version": "2.0T Flat Power Facelift",
        "subtitle": "Sedan Thể Thao Thuần Đua Hiệu Năng Cao • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Sedan",
        "subCategory": "Sedan Thể Thao Thuần Đua Hiệu Năng Cao",
        "fuel": "gas",
        "price": 1829000000,
        "priceFormatted": "1.829.000.000 VNĐ",
        "priceShort": "1.829 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá niêm yết xe nhập khẩu nguyên chiếc từ Hàn Quốc",
        "badge": "N Power Beast",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 290,
        "power": "280 HP (206 kW) / 290 HP khi kích hoạt NGS Mode",
        "engine": "2.0L Turbo Flat Power GDI 4 xi-lanh",
        "powertrain": "Động cơ Xăng 2.0L Turbo T-GDi, Hộp số ly hợp kép 8 cấp ướt N DCT, Cầu trước FWD có vi sai điện tử e-LSD",
        "torque": "392 Nm @ 2.100 - 4.700 rpm",
        "acceleration": "5.3s",
        "topSpeed": "250 km/h",
        "transmission": "Ly hợp kép 8 cấp ướt (8-Speed Wet N DCT)",
        "drive": "FWD / Cầu trước + Vi sai chống trượt điện tử e-LSD (N Corner Carving Differential)",
        "seats": 5,
        "dimensions": "4.675 x 1.825 x 1.415 mm",
        "wheelbase": "2.720 mm",
        "groundClearance": "136 mm",
        "dimensionsDetail": {
            "overall": "4.675 x 1.825 x 1.415 mm",
            "lengthMm": 4675,
            "widthMm": 1825,
            "heightMm": 1415,
            "wheelbase": "2.720 mm",
            "groundClearance": "136 mm",
            "curbWeight": "1.485 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2024,
        "warranty": "5 năm hoặc 100.000 km chính hãng Hyundai Thành Công",
        "warrantyDetail": {
            "policy": "5 năm hoặc 100.000 km chính hãng Hyundai Thành Công"
        },
        "image": "assets/vehicles/hyundai-elantra-n-2024/images/exterior/phia_truoc.webp",
        "thumbnail": "assets/vehicles/hyundai-elantra-n-2024/images/exterior/phia_truoc.webp",
        "cover": "assets/vehicles/hyundai-elantra-n-2024/images/exterior/phia_truoc.webp",
        "galleryImages": [
            "assets/vehicles/hyundai-elantra-n-2024/images/exterior/phia_truoc.webp",
            "assets/vehicles/hyundai-elantra-n-2024/images/exterior/ben_phai.jpg",
            "assets/vehicles/hyundai-elantra-n-2024/images/dashboard/phia_sau.jpg",
            "assets/vehicles/hyundai-elantra-n-2024/images/engine/ben_trai.jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/hyundai-elantra-n-2024/images/exterior/phia_truoc.webp",
                "assets/vehicles/hyundai-elantra-n-2024/images/exterior/ben_phai.jpg"
            ],
            "interior": [],
            "dashboard": [
                "assets/vehicles/hyundai-elantra-n-2024/images/dashboard/phia_sau.jpg"
            ],
            "engine": [
                "assets/vehicles/hyundai-elantra-n-2024/images/engine/ben_trai.jpg"
            ],
            "specifications": [],
            "gallery": []
        },
        "colors": [
            {
                "name": "Xanh Hiệu Năng Performance Blue",
                "hex": "#38BDF8",
                "img": "assets/vehicles/hyundai-elantra-n-2024/images/exterior/phia_truoc.webp"
            },
            {
                "name": "Đen Bóng Abyss Black Pearl",
                "hex": "#0F172A",
                "img": "assets/vehicles/hyundai-elantra-n-2024/images/exterior/ben_phai.jpg"
            },
            {
                "name": "Trắng Atlas White",
                "hex": "#F8FAFC",
                "img": "assets/vehicles/hyundai-elantra-n-2024/images/dashboard/phia_sau.jpg"
            },
            {
                "name": "Xám Xi Măng Cyber Gray Metallic",
                "hex": "#64748B",
                "img": "assets/vehicles/hyundai-elantra-n-2024/images/engine/ben_trai.jpg"
            }
        ],
        "colorsSummary": "Xanh Hiệu Năng Performance Blue, Đen Bóng Abyss Black Pearl, Trắng Atlas White, Xám Xi Măng Cyber Gray Metallic",
        "evSpecs": null,
        "features": [
            "Nút kích hoạt NGS (N Grin Shift) tăng thêm 10 mã lực tức thì trong 20 giây",
            "Hệ thống vi sai điện tử e-LSD (N Corner Carving Differential) ôm cua không trượt",
            "Hệ thống ống xả kép N Variable Exhaust Valve System nổ bắp rang cực kỳ phấn khích",
            "Hệ thống treo thích ứng điện tử ECS kiểm soát dao động từng miligiây",
            "Thanh giằng chữ H gia cố khoang hành lý tăng 29% độ cứng chống vặn xoắn thân xe"
        ],
        "description": "Sedan hiệu năng cao được tôi luyện tại trường đua Nürburgring với động cơ 2.0 Turbo 290 mã lực, hộp số 8 N-DCT, vi sai e-LSD và tiếng pô phấn khích tột độ.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/hyundai_elantra_n_2024.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Hyundai Elantra N (2024) Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Sedan Thể Thao Thuần Đua Hiệu Năng Cao tối ưu lực ép không khí và khí chất thể thao đặc trưng Hyundai."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Xăng 2.0L Turbo T-GDi, Hộp số ly hợp kép 8 cấp ướt N DCT, Cầu trước FWD có vi sai điện tử e-LSD sản sinh công suất 280 HP (206 kW) / 290 HP khi kích hoạt NGS Mode cùng gia tốc 5.3s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/hyundai-elantra-n-2024/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/hyundai-elantra-n-2024/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "lamborghini-aventador-sv",
        "productCode": "LAM-AVSV-16",
        "name": "Lamborghini Aventador LP750-4 SV",
        "brand": "Lamborghini",
        "version": "SuperVeloce V12 750 HP (Giới hạn 600 chiếc)",
        "subtitle": "Siêu Xe Động Cơ V12 Hút Khí Tự Nhiên Đỉnh Cao • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Siêu Xe",
        "subCategory": "Siêu Xe Động Cơ V12 Hút Khí Tự Nhiên Đỉnh Cao",
        "fuel": "gas",
        "price": 38000000000,
        "priceFormatted": "38.000.000.000 VNĐ",
        "priceShort": "38 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá ước tính lăn bánh nhập khẩu tư nhân tại Việt Nam",
        "badge": "V12 SuperVeloce",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 750,
        "power": "750 HP (552 kW) @ 8.400 rpm",
        "engine": "6.5L V12 Hút khí tự nhiên (Natural Aspirated)",
        "powertrain": "Động cơ Xăng V12 6.5L, Hộp số bán tự động 7 cấp ISR, Dẫn động 4 bánh toàn thời gian Haldex Gen IV AWD",
        "torque": "690 Nm @ 5.500 rpm",
        "acceleration": "2.8s",
        "topSpeed": "350 km/h",
        "transmission": "Bán tự động 7 cấp Independent Shifting Rods (ISR) chuyển số trong 50ms",
        "drive": "AWD / Dẫn động 4 bánh toàn thời gian Haldex",
        "seats": 2,
        "dimensions": "4.835 x 2.030 x 1.136 mm",
        "wheelbase": "2.700 mm",
        "groundClearance": "115 mm (Có hệ thống nâng mũi xe Hydraulic Lift)",
        "dimensionsDetail": {
            "overall": "4.835 x 2.030 x 1.136 mm",
            "lengthMm": 4835,
            "widthMm": 2030,
            "heightMm": 1136,
            "wheelbase": "2.700 mm",
            "groundClearance": "115 mm",
            "curbWeight": "1.525 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2017,
        "warranty": "Bảo hành chính hãng Lamborghini và chứng nhận nguồn gốc",
        "warrantyDetail": {
            "policy": "Bảo hành chính hãng Lamborghini và chứng nhận nguồn gốc"
        },
        "image": "assets/vehicles/lamborghini-aventador-sv/images/exterior/Lamborghini_Aventador_LP_750-4_Super_VELOCE_(17166321410).jpg",
        "thumbnail": "assets/vehicles/lamborghini-aventador-sv/images/exterior/Lamborghini_Aventador_LP_750-4_Super_VELOCE_(17166321410).jpg",
        "cover": "assets/vehicles/lamborghini-aventador-sv/images/exterior/Lamborghini_Aventador_LP_750-4_Super_VELOCE_(17166321410).jpg",
        "galleryImages": [
            "assets/vehicles/lamborghini-aventador-sv/images/exterior/Lamborghini_Aventador_LP_750-4_Super_VELOCE_(17166321410).jpg",
            "assets/vehicles/lamborghini-aventador-sv/images/interior/-Lamborghini-Photo-Max-Earey-047.jpg",
            "assets/vehicles/lamborghini-aventador-sv/images/dashboard/xedoisong_lamborghini_aventador_lp750_4_superveloce_sv_geneva_h3_vhsy.jpg",
            "assets/vehicles/lamborghini-aventador-sv/images/engine/2016-lamborghini-aventador-lp750-4-superveloce-test-review-car-and-driver-photo-667354-s-original.avif",
            "assets/vehicles/lamborghini-aventador-sv/images/gallery/images.jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/lamborghini-aventador-sv/images/exterior/Lamborghini_Aventador_LP_750-4_Super_VELOCE_(17166321410).jpg"
            ],
            "interior": [
                "assets/vehicles/lamborghini-aventador-sv/images/interior/-Lamborghini-Photo-Max-Earey-047.jpg"
            ],
            "dashboard": [
                "assets/vehicles/lamborghini-aventador-sv/images/dashboard/xedoisong_lamborghini_aventador_lp750_4_superveloce_sv_geneva_h3_vhsy.jpg"
            ],
            "engine": [
                "assets/vehicles/lamborghini-aventador-sv/images/engine/2016-lamborghini-aventador-lp750-4-superveloce-test-review-car-and-driver-photo-667354-s-original.avif"
            ],
            "specifications": [],
            "gallery": [
                "assets/vehicles/lamborghini-aventador-sv/images/gallery/images.jpg"
            ]
        },
        "colors": [
            {
                "name": "Đỏ Thể Thao Rosso Bia",
                "hex": "#B91C1C",
                "img": "assets/vehicles/lamborghini-aventador-sv/images/exterior/Lamborghini_Aventador_LP_750-4_Super_VELOCE_(17166321410).jpg"
            },
            {
                "name": "Vàng Giallo Orion",
                "hex": "#FACC15",
                "img": "assets/vehicles/lamborghini-aventador-sv/images/interior/-Lamborghini-Photo-Max-Earey-047.jpg"
            },
            {
                "name": "Cam Arancio Atlas",
                "hex": "#F97316",
                "img": "assets/vehicles/lamborghini-aventador-sv/images/dashboard/xedoisong_lamborghini_aventador_lp750_4_superveloce_sv_geneva_h3_vhsy.jpg"
            },
            {
                "name": "Xanh Lá Verde Ithaca",
                "hex": "#22C55E",
                "img": "assets/vehicles/lamborghini-aventador-sv/images/engine/2016-lamborghini-aventador-lp750-4-superveloce-test-review-car-and-driver-photo-667354-s-original.avif"
            }
        ],
        "colorsSummary": "Đỏ Thể Thao Rosso Bia, Vàng Giallo Orion, Cam Arancio Atlas, Xanh Lá Verde Ithaca",
        "evSpecs": null,
        "features": [
            "Cắt giảm 50 kg trọng lượng nhờ ứng dụng sợi carbon gia cường khắp thân vỏ và nội thất",
            "Tăng thêm 170% lực ép không khí (Downforce) so với bản Aventador tiêu chuẩn",
            "Hệ thống giảm xóc từ tính chủ động Magneto-Rheological Suspension (MRS) kiểu xe đua F1",
            "Cánh gió sau sợi carbon cỡ lớn điều chỉnh cơ học 3 nấc",
            "Ống xả thể thao bằng hợp kim titan phát ra âm thanh gầm rú V12 xé gió ở 8.500 rpm"
        ],
        "description": "Tuyệt phẩm V12 hút khí tự nhiên thuần khiết nhất của Lamborghini đạt 750 mã lực, tăng tốc 0-100 km/h trong 2.8 giây cùng cánh gió khí động học sợi carbon.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/lamborghini_aventador_sv.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Lamborghini Aventador LP750-4 SV Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Siêu Xe Động Cơ V12 Hút Khí Tự Nhiên Đỉnh Cao tối ưu lực ép không khí và khí chất thể thao đặc trưng Lamborghini."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Xăng V12 6.5L, Hộp số bán tự động 7 cấp ISR, Dẫn động 4 bánh toàn thời gian Haldex Gen IV AWD sản sinh công suất 750 HP (552 kW) @ 8.400 rpm cùng gia tốc 2.8s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/lamborghini-aventador-sv/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/lamborghini-aventador-sv/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "lamborghini-terzo-millennio",
        "productCode": "LAM-TM-30",
        "name": "Lamborghini Terzo Millennio",
        "brand": "Lamborghini",
        "version": "Hypercar Thuần Điện Thiên Niên Kỷ Thứ 3",
        "subtitle": "Siêu Xe Điện Tương Lai Sợi Carbon Tự Chữa Lành • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Siêu Xe",
        "subCategory": "Siêu Xe Điện Tương Lai Sợi Carbon Tự Chữa Lành",
        "fuel": "ev",
        "price": 90000000000,
        "priceFormatted": "90.000.000.000 VNĐ",
        "priceShort": "90 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Mô hình ý tưởng tương lai độc bản hợp tác cùng viện MIT",
        "badge": "MIT Supercapacitor EV",
        "range": 500,
        "rangeExtendedKm": null,
        "hp": 1000,
        "power": "1.000 HP (4 Mô-tơ điện đặt tại 4 bánh xe)",
        "engine": "4 Động cơ điện tích hợp trong bánh xe (In-wheel Electric Motors)",
        "powertrain": "Hệ thống siêu tụ điện (Supercapacitors) tích hợp thân vỏ pin nano carbon, dẫn động 4 bánh toàn thời gian AWD",
        "torque": "1.500 Nm tức thì",
        "acceleration": "1.9s",
        "topSpeed": "380 km/h",
        "transmission": "Hộp số điện tử truyền động trực tiếp 4 bánh",
        "drive": "AWD / Dẫn động 4 bánh toàn thời gian điều hướng mô-men xoắn Torque Vectoring độc lập",
        "seats": 2,
        "dimensions": "4.800 x 2.100 x 1.050 mm",
        "wheelbase": "2.750 mm",
        "groundClearance": "100 mm",
        "dimensionsDetail": {
            "overall": "4.800 x 2.100 x 1.050 mm",
            "lengthMm": 4800,
            "widthMm": 2100,
            "heightMm": 1050,
            "wheelbase": "2.750 mm",
            "groundClearance": "100 mm",
            "curbWeight": "1.350 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2030,
        "warranty": "Dự án nghiên cứu công nghệ tương lai hợp tác cùng Viện MIT Hoa Kỳ",
        "warrantyDetail": {
            "policy": "Dự án nghiên cứu công nghệ tương lai hợp tác cùng Viện MIT Hoa Kỳ"
        },
        "image": "assets/vehicles/lamborghini-terzo-millennio/images/exterior/-1x-1.jpg",
        "thumbnail": "assets/vehicles/lamborghini-terzo-millennio/images/exterior/-1x-1.jpg",
        "cover": "assets/vehicles/lamborghini-terzo-millennio/images/exterior/-1x-1.jpg",
        "galleryImages": [
            "assets/vehicles/lamborghini-terzo-millennio/images/exterior/-1x-1.jpg",
            "assets/vehicles/lamborghini-terzo-millennio/images/interior/R.jpg",
            "assets/vehicles/lamborghini-terzo-millennio/images/dashboard/3.jpg",
            "assets/vehicles/lamborghini-terzo-millennio/images/engine/4.jpg",
            "assets/vehicles/lamborghini-terzo-millennio/images/gallery/images.jpg",
            "assets/vehicles/lamborghini-terzo-millennio/images/gallery/2.jpg",
            "assets/vehicles/lamborghini-terzo-millennio/images/gallery/1.jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/lamborghini-terzo-millennio/images/exterior/-1x-1.jpg"
            ],
            "interior": [
                "assets/vehicles/lamborghini-terzo-millennio/images/interior/R.jpg"
            ],
            "dashboard": [
                "assets/vehicles/lamborghini-terzo-millennio/images/dashboard/3.jpg"
            ],
            "engine": [
                "assets/vehicles/lamborghini-terzo-millennio/images/engine/4.jpg"
            ],
            "specifications": [],
            "gallery": [
                "assets/vehicles/lamborghini-terzo-millennio/images/gallery/images.jpg",
                "assets/vehicles/lamborghini-terzo-millennio/images/gallery/2.jpg",
                "assets/vehicles/lamborghini-terzo-millennio/images/gallery/1.jpg"
            ]
        },
        "colors": [
            {
                "name": "Xám Thép Carbon X-Concept",
                "hex": "#334155",
                "img": "assets/vehicles/lamborghini-terzo-millennio/images/exterior/-1x-1.jpg"
            },
            {
                "name": "Cam Neon Terzo Orange",
                "hex": "#EA580C",
                "img": "assets/vehicles/lamborghini-terzo-millennio/images/interior/R.jpg"
            }
        ],
        "colorsSummary": "Xám Thép Carbon X-Concept, Cam Neon Terzo Orange",
        "evSpecs": {
            "batteryCapacity": "Hệ thống Siêu Tụ Điện tích hợp trực tiếp vào Thân Vỏ Carbon",
            "rangeKm": 500,
            "fastCharge": "Nạp đầy năng lượng trong 5 phút với hệ thống sạc siêu tụ điện cao tần",
            "architecture": "Kiến trúc điện áp siêu cao Nano-Carbon"
        },
        "features": [
            "Công nghệ sợi carbon tự phát hiện vết nứt và tự sửa chữa nhờ ống vi mô hóa chất thông minh",
            "Thân vỏ xe đóng vai trò là khối tích trữ điện năng (năng lượng lưu trữ trong tấm thân carbon)",
            "Hệ thống siêu tụ điện (Supercapacitor) nạp xả dòng điện cực đại không bị suy giảm theo thời gian",
            "Đèn LED tạo hình chữ Y đặc trưng định hình thiết kế tương lai của toàn bộ dải xe Lamborghini",
            "Hệ thống âm thanh tổng hợp giả lập tần số cao độc quyền thay thế tiếng gầm động cơ V12"
        ],
        "description": "Tầm nhìn tương lai của siêu xe thuần điện với 4 mô-tơ trong bánh xe, khung vỏ carbon tự chữa lành kiêm pin tích điện và hệ thống siêu tụ điện nạp siêu tốc.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/lamborghini_terzo_millennio.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Lamborghini Terzo Millennio Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Siêu Xe Điện Tương Lai Sợi Carbon Tự Chữa Lành tối ưu lực ép không khí và khí chất thể thao đặc trưng Lamborghini."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Hệ thống siêu tụ điện (Supercapacitors) tích hợp thân vỏ pin nano carbon, dẫn động 4 bánh toàn thời gian AWD sản sinh công suất 1.000 HP (4 Mô-tơ điện đặt tại 4 bánh xe) cùng gia tốc 1.9s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/lamborghini-terzo-millennio/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/lamborghini-terzo-millennio/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "land-rover-defender-110",
        "productCode": "LND-DF-110",
        "name": "Land Rover Defender 110",
        "brand": "Land Rover",
        "version": "110 P400 3.0L MHEV X-Dynamic",
        "subtitle": "SUV Địa Hình Hạng Sang Biểu Tượng Nước Anh • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "SUV",
        "subCategory": "SUV Địa Hình Hạng Sang Biểu Tượng Nước Anh",
        "fuel": "gas",
        "price": 4999000000,
        "priceFormatted": "4.999.000.000 VNĐ",
        "priceShort": "4.999 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá niêm yết chính hãng phân phối tại Việt Nam",
        "badge": "Off-road King 900mm",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 400,
        "power": "400 HP (294 kW) @ 5.500 rpm",
        "engine": "3.0L i6 Turbocharged MHEV (Lai nhẹ 48V)",
        "powertrain": "Động cơ Xăng 3.0L 6 xi-lanh thẳng hàng Turbo + 48V MHEV, Hộp số tự động 8 cấp ZF, 4WD hai cầu chậm có khóa vi sai trung tâm và cầu sau",
        "torque": "550 Nm @ 2.000 - 5.000 rpm",
        "acceleration": "6.1s",
        "topSpeed": "191 km/h",
        "transmission": "Tự động 8 cấp ZF với hộp số phụ 2 cấp (Twin-speed transfer box)",
        "drive": "AWD / 4WD Toàn thời gian thông minh + Khóa vi sai trung tâm & vi sai cầu sau chủ động",
        "seats": 7,
        "dimensions": "5.018 x 2.008 x 1.967 mm",
        "wheelbase": "3.022 mm",
        "groundClearance": "291 mm (Treo khí nén nâng tối đa)",
        "dimensionsDetail": {
            "overall": "5.018 x 2.008 x 1.967 mm",
            "lengthMm": 5018,
            "widthMm": 2008,
            "heightMm": 1967,
            "wheelbase": "3.022 mm",
            "groundClearance": "291 mm",
            "curbWeight": "2.361 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2024,
        "warranty": "3 năm hoặc 100.000 km chính hãng Land Rover Việt Nam",
        "warrantyDetail": {
            "policy": "3 năm hoặc 100.000 km chính hãng Land Rover Việt Nam"
        },
        "image": "assets/vehicles/land-rover-defender-110/images/exterior/dang_truoc.webp",
        "thumbnail": "assets/vehicles/land-rover-defender-110/images/exterior/dang_truoc.webp",
        "cover": "assets/vehicles/land-rover-defender-110/images/exterior/dang_truoc.webp",
        "galleryImages": [
            "assets/vehicles/land-rover-defender-110/images/exterior/dang_truoc.webp",
            "assets/vehicles/land-rover-defender-110/images/exterior/dang_sau.webp",
            "assets/vehicles/land-rover-defender-110/images/dashboard/ben_phai.jpeg",
            "assets/vehicles/land-rover-defender-110/images/engine/ben_trai.jpeg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/land-rover-defender-110/images/exterior/dang_truoc.webp",
                "assets/vehicles/land-rover-defender-110/images/exterior/dang_sau.webp"
            ],
            "interior": [],
            "dashboard": [
                "assets/vehicles/land-rover-defender-110/images/dashboard/ben_phai.jpeg"
            ],
            "engine": [
                "assets/vehicles/land-rover-defender-110/images/engine/ben_trai.jpeg"
            ],
            "specifications": [],
            "gallery": []
        },
        "colors": [
            {
                "name": "Xanh Rêu Địa Hình Pangea Green",
                "hex": "#4D7C0F",
                "img": "assets/vehicles/land-rover-defender-110/images/exterior/dang_truoc.webp"
            },
            {
                "name": "Xám Gondwana Stone",
                "hex": "#78716C",
                "img": "assets/vehicles/land-rover-defender-110/images/exterior/dang_sau.webp"
            },
            {
                "name": "Đen Santorini Black",
                "hex": "#0F172A",
                "img": "assets/vehicles/land-rover-defender-110/images/dashboard/ben_phai.jpeg"
            },
            {
                "name": "Trắng Fuji White",
                "hex": "#F8FAFC",
                "img": "assets/vehicles/land-rover-defender-110/images/engine/ben_trai.jpeg"
            }
        ],
        "colorsSummary": "Xanh Rêu Địa Hình Pangea Green, Xám Gondwana Stone, Đen Santorini Black, Trắng Fuji White",
        "evSpecs": null,
        "features": [
            "Khả năng lội nước sâu tới 900 mm với cảm biến Wade Sensing đo mực nước thời gian thực",
            "Khung gầm liền khối D7x bằng nhôm siêu cứng gấp 3 lần khung gầm rời truyền thống",
            "Hệ thống kiểm soát địa hình Terrain Response 2 tự động điều chỉnh hệ dẫn động theo từng mặt đường",
            "Hệ thống camera 3D ClearSight Ground View nhìn xuyên nắp ca-pô xuống mặt đất",
            "Treo khí nén điện tử có khả năng nâng gầm hành trình 145 mm vượt mọi hiểm địa"
        ],
        "description": "Biểu tượng SUV địa hình sang trọng từ nước Anh với động cơ 400 mã lực MHEV, khung nhôm D7x siêu cứng, khả năng lội nước 900 mm và nội thất 7 chỗ tiện nghi bậc nhất.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/land_rover_defender_110.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Land Rover Defender 110 Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng SUV Địa Hình Hạng Sang Biểu Tượng Nước Anh tối ưu lực ép không khí và khí chất thể thao đặc trưng Land Rover."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Xăng 3.0L 6 xi-lanh thẳng hàng Turbo + 48V MHEV, Hộp số tự động 8 cấp ZF, 4WD hai cầu chậm có khóa vi sai trung tâm và cầu sau sản sinh công suất 400 HP (294 kW) @ 5.500 rpm cùng gia tốc 6.1s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/land-rover-defender-110/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/land-rover-defender-110/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "lucid-air-sapphire",
        "productCode": "LCD-SAP-01",
        "name": "Lucid Air Sapphire",
        "brand": "Lucid",
        "version": "Tri-Motor AWD 1234 HP",
        "subtitle": "Siêu Sedan Thuần Điện Xa Xỉ Nhất Thế Giới • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Sedan",
        "subCategory": "Siêu Sedan Thuần Điện Xa Xỉ Nhất Thế Giới",
        "fuel": "ev",
        "price": 6500000000,
        "priceFormatted": "6.500.000.000 VNĐ",
        "priceShort": "6.5 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá tham khảo nhập khẩu tư nhân tại Việt Nam (~250.000 USD tại Mỹ)",
        "badge": "1234 HP Super-Sedan",
        "range": 687,
        "rangeExtendedKm": null,
        "hp": 1234,
        "power": "1.234 HP (920 kW), 3 Mô-tơ điện độc quyền",
        "engine": "3 Động cơ điện Lucid Tri-Motor (1 trước, 2 sau tích hợp bộ biến tần SiC)",
        "powertrain": "Hệ thống 3 Mô-tơ điện Tri-Motor AWD, Kiến trúc điện áp 900V+ Wunderbox, Pin 118 kWh",
        "torque": "1.939 Nm tức thì",
        "acceleration": "1.89s (0-96 km/h không trừ 1-foot rollout)",
        "topSpeed": "330 km/h",
        "transmission": "Hộp số hành tinh đơn cấp tỉ số truyền thể thao",
        "drive": "AWD / Dẫn động 4 bánh với hệ thống điều hướng mô-men xoắn chủ động độc lập 2 bánh sau",
        "seats": 5,
        "dimensions": "4.975 x 1.939 x 1.410 mm",
        "wheelbase": "2.960 mm",
        "groundClearance": "135 mm",
        "dimensionsDetail": {
            "overall": "4.975 x 1.939 x 1.410 mm",
            "lengthMm": 4975,
            "widthMm": 1939,
            "heightMm": 1410,
            "wheelbase": "2.960 mm",
            "groundClearance": "135 mm",
            "curbWeight": "2.420 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2025,
        "warranty": "4 năm hoặc 80.000 km xe & 8 năm hoặc 160.000 km pin",
        "warrantyDetail": {
            "policy": "4 năm hoặc 80.000 km xe & 8 năm hoặc 160.000 km pin"
        },
        "image": "assets/vehicles/lucid-air-sapphire/images/exterior/images (7).jpg",
        "thumbnail": "assets/vehicles/lucid-air-sapphire/images/exterior/images (7).jpg",
        "cover": "assets/vehicles/lucid-air-sapphire/images/exterior/images (7).jpg",
        "galleryImages": [
            "assets/vehicles/lucid-air-sapphire/images/exterior/images (7).jpg",
            "assets/vehicles/lucid-air-sapphire/images/interior/images (6).jpg",
            "assets/vehicles/lucid-air-sapphire/images/dashboard/images (8).jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/lucid-air-sapphire/images/exterior/images (7).jpg"
            ],
            "interior": [
                "assets/vehicles/lucid-air-sapphire/images/interior/images (6).jpg"
            ],
            "dashboard": [
                "assets/vehicles/lucid-air-sapphire/images/dashboard/images (8).jpg"
            ],
            "engine": [],
            "specifications": [],
            "gallery": []
        },
        "colors": [
            {
                "name": "Xanh Sapphire Lam Bảo Sapphire Blue",
                "hex": "#1D4ED8",
                "img": "assets/vehicles/lucid-air-sapphire/images/exterior/images (7).jpg"
            },
            {
                "name": "Đen Stealth Black Onyx",
                "hex": "#0B0F19",
                "img": "assets/vehicles/lucid-air-sapphire/images/interior/images (6).jpg"
            }
        ],
        "colorsSummary": "Xanh Sapphire Lam Bảo Sapphire Blue, Đen Stealth Black Onyx",
        "evSpecs": {
            "batteryCapacity": "118 kWh (Kiến trúc Siêu Điện Áp 900V+)",
            "rangeKm": 687,
            "fastCharge": "Sạc siêu nhanh 300 kW DC: 15 phút nạp được 320 km quãng đường",
            "architecture": "900V+ SiC High-Voltage Architecture"
        },
        "features": [
            "Siêu sedan điện tăng tốc nhanh nhất hành tinh: 0-100 km/h dưới 1.9 giây",
            "Đĩa phanh gốm Carbon Ceramic 420 mm tiêu chuẩn với cùm phanh 10 piston phía trước",
            "Màn hình cong vòm 34 inch Glass Cockpit độ phân giải 5K nổi bồng bềnh",
            "Hệ thống âm thanh Surreal Sound Pro 21 loa hỗ trợ âm thanh vòm Dolby Atmos",
            "Kiến trúc điện áp 900V+ dẫn đầu ngành cho phép sạc nhanh nhất thế giới"
        ],
        "description": "Vua siêu sedan thuần điện thế giới với công suất 1.234 mã lực, tăng tốc 0-100 km/h trong 1.89 giây, pin 118 kWh tầm hoạt động 687 km và khoang lái 5K thượng lưu.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/lucid_air_sapphire.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Lucid Air Sapphire Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Siêu Sedan Thuần Điện Xa Xỉ Nhất Thế Giới tối ưu lực ép không khí và khí chất thể thao đặc trưng Lucid."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Hệ thống 3 Mô-tơ điện Tri-Motor AWD, Kiến trúc điện áp 900V+ Wunderbox, Pin 118 kWh sản sinh công suất 1.234 HP (920 kW), 3 Mô-tơ điện độc quyền cùng gia tốc 1.89s (0-96 km/h không trừ 1-foot rollout)."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/lucid-air-sapphire/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/lucid-air-sapphire/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "maybach-exelero-2005",
        "productCode": "MAY-EXE-05",
        "name": "Maybach Exelero",
        "brand": "Maybach",
        "version": "Coupe Độc Bản V12 Twin-Turbo (1 of 1)",
        "subtitle": "Siêu Coupe Độc Bản Đắt Giá Nhất Lịch Sử Maybach • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Coupe",
        "subCategory": "Siêu Coupe Độc Bản Đắt Giá Nhất Lịch Sử Maybach",
        "fuel": "gas",
        "price": 190000000000,
        "priceFormatted": "190.000.000.000 VNĐ",
        "priceShort": "190 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá trị sưu tầm độc bản thế giới (~8 - 10 triệu USD)",
        "badge": "Độc Bản 1 of 1",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 700,
        "power": "700 HP (515 kW) @ 5.000 rpm",
        "engine": "5.9L V12 Twin-Turbo (3 van mỗi xi-lanh)",
        "powertrain": "Động cơ Xăng 5.9L V12 Twin-Turbo, Hộp số tự động 5 cấp 5G-Tronic gia cường, Cầu sau RWD",
        "torque": "1.020 Nm @ 2.500 rpm",
        "acceleration": "4.4s",
        "topSpeed": "351.4 km/h (Kỷ lục thế giới trên đường đua Nardò)",
        "transmission": "Tự động 5 cấp thể thao 5G-Tronic",
        "drive": "RWD / Cầu sau",
        "seats": 2,
        "dimensions": "5.890 x 2.140 x 1.390 mm",
        "wheelbase": "3.390 mm",
        "groundClearance": "130 mm",
        "dimensionsDetail": {
            "overall": "5.890 x 2.140 x 1.390 mm",
            "lengthMm": 5890,
            "widthMm": 2140,
            "heightMm": 1390,
            "wheelbase": "3.390 mm",
            "groundClearance": "130 mm",
            "curbWeight": "2.660 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2005,
        "warranty": "Bảo dưỡng và xác thực độc bản bảo tàng Maybach Đức",
        "warrantyDetail": {
            "policy": "Bảo dưỡng và xác thực độc bản bảo tàng Maybach Đức"
        },
        "image": "assets/vehicles/maybach-exelero-2005/images/exterior/dang_truoc.jpeg",
        "thumbnail": "assets/vehicles/maybach-exelero-2005/images/exterior/dang_truoc.jpeg",
        "cover": "assets/vehicles/maybach-exelero-2005/images/exterior/dang_truoc.jpeg",
        "galleryImages": [
            "assets/vehicles/maybach-exelero-2005/images/exterior/dang_truoc.jpeg",
            "assets/vehicles/maybach-exelero-2005/images/exterior/dang_sau.jpg",
            "assets/vehicles/maybach-exelero-2005/images/dashboard/ben_trai.jpeg",
            "assets/vehicles/maybach-exelero-2005/images/engine/ben_phai.webp"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/maybach-exelero-2005/images/exterior/dang_truoc.jpeg",
                "assets/vehicles/maybach-exelero-2005/images/exterior/dang_sau.jpg"
            ],
            "interior": [],
            "dashboard": [
                "assets/vehicles/maybach-exelero-2005/images/dashboard/ben_trai.jpeg"
            ],
            "engine": [
                "assets/vehicles/maybach-exelero-2005/images/engine/ben_phai.webp"
            ],
            "specifications": [],
            "gallery": []
        },
        "colors": [
            {
                "name": "Đen Quý Tộc Piano Black Gloss",
                "hex": "#0B0F19",
                "img": "assets/vehicles/maybach-exelero-2005/images/exterior/dang_truoc.jpeg"
            }
        ],
        "colorsSummary": "Đen Quý Tộc Piano Black Gloss",
        "evSpecs": null,
        "features": [
            "Siêu coupe độc nhất vô nhị chỉ có đúng 1 chiếc duy nhất tồn tại trên toàn cầu",
            "Được hãng lốp Fulda đặt hàng phát triển riêng để thử nghiệm lốp siêu tốc độ cao vượt 350 km/h",
            "Chiều dài khổng lồ gần 5.9 mét kết hợp mui vuốt dài khí động học phong cách thập niên 1930",
            "Bộ mâm bánh xe đặc chế kích thước 23 inch bọc lốp Fulda 315/25 ZR23 khổng lồ",
            "Nội thất bọc da thuộc cao cấp đan xen sợi carbon đen bóng và nhôm nguyên khối phay xước"
        ],
        "description": "Tuyệt tác độc bản 1 chiếc duy nhất trên thế giới của Maybach với động cơ V12 Twin-Turbo 700 mã lực, dài gần 5.9m và tốc độ kỷ lục 351.4 km/h tại đường đua Nardò.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/maybach_exelero_2005.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Maybach Exelero Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Siêu Coupe Độc Bản Đắt Giá Nhất Lịch Sử Maybach tối ưu lực ép không khí và khí chất thể thao đặc trưng Maybach."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Xăng 5.9L V12 Twin-Turbo, Hộp số tự động 5 cấp 5G-Tronic gia cường, Cầu sau RWD sản sinh công suất 700 HP (515 kW) @ 5.000 rpm cùng gia tốc 4.4s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/maybach-exelero-2005/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/maybach-exelero-2005/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "porsche-911-carrera-4s-2024",
        "productCode": "POR-992-4S",
        "name": "Porsche 911 Carrera 4S (992)",
        "brand": "Porsche",
        "version": "992 Carrera 4S Twin-Turbo AWD",
        "subtitle": "Xe Thể Thao Biểu Tượng Nước Đức • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Siêu Xe",
        "subCategory": "Xe Thể Thao Biểu Tượng Nước Đức",
        "fuel": "gas",
        "price": 8850000000,
        "priceFormatted": "8.850.000.000 VNĐ",
        "priceShort": "8.85 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá tiêu chuẩn chính hãng Porsche Việt Nam (chưa bao gồm trang bị cá nhân hóa)",
        "badge": "Iconic 911 Flat-6",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 450,
        "power": "450 HP (331 kW) @ 6.500 rpm",
        "engine": "3.0L Boxer 6 xi-lanh nằm ngang (Flat-6) Twin-Turbo",
        "powertrain": "Động cơ Xăng Boxer 6 xi-lanh Twin-Turbo, Hộp số ly hợp kép 8 cấp Porsche Doppelkupplung (PDK), Dẫn động 4 bánh toàn thời gian PTM AWD",
        "torque": "530 Nm @ 2.300 - 5.000 rpm",
        "acceleration": "3.4s (với gói Sport Chrono Package)",
        "topSpeed": "306 km/h",
        "transmission": "Ly hợp kép 8 cấp PDK lừng danh",
        "drive": "AWD / Dẫn động 4 bánh chủ động Porsche Traction Management (PTM)",
        "seats": 4,
        "dimensions": "4.519 x 1.852 x 1.300 mm",
        "wheelbase": "2.450 mm",
        "groundClearance": "120 mm (Nâng hạ trục trước Front Axle Lift)",
        "dimensionsDetail": {
            "overall": "4.519 x 1.852 x 1.300 mm",
            "lengthMm": 4519,
            "widthMm": 1852,
            "heightMm": 1300,
            "wheelbase": "2.450 mm",
            "groundClearance": "120 mm",
            "curbWeight": "1.565 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2024,
        "warranty": "4 năm chính hãng Porsche Việt Nam không giới hạn số km",
        "warrantyDetail": {
            "policy": "4 năm chính hãng Porsche Việt Nam không giới hạn số km"
        },
        "image": "assets/vehicles/porsche-911-carrera-4s-2024/images/exterior/dang_truoc.jpg",
        "thumbnail": "assets/vehicles/porsche-911-carrera-4s-2024/images/exterior/dang_truoc.jpg",
        "cover": "assets/vehicles/porsche-911-carrera-4s-2024/images/exterior/dang_truoc.jpg",
        "galleryImages": [
            "assets/vehicles/porsche-911-carrera-4s-2024/images/exterior/dang_truoc.jpg",
            "assets/vehicles/porsche-911-carrera-4s-2024/images/exterior/ben_phai.png",
            "assets/vehicles/porsche-911-carrera-4s-2024/images/dashboard/ben_tren.jpg",
            "assets/vehicles/porsche-911-carrera-4s-2024/images/engine/ben_trai.jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/porsche-911-carrera-4s-2024/images/exterior/dang_truoc.jpg",
                "assets/vehicles/porsche-911-carrera-4s-2024/images/exterior/ben_phai.png"
            ],
            "interior": [],
            "dashboard": [
                "assets/vehicles/porsche-911-carrera-4s-2024/images/dashboard/ben_tren.jpg"
            ],
            "engine": [
                "assets/vehicles/porsche-911-carrera-4s-2024/images/engine/ben_trai.jpg"
            ],
            "specifications": [],
            "gallery": []
        },
        "colors": [
            {
                "name": "Xám Phấn Crayon / Chalk",
                "hex": "#E2E8F0",
                "img": "assets/vehicles/porsche-911-carrera-4s-2024/images/exterior/dang_truoc.jpg"
            },
            {
                "name": "Đỏ Thể Thao Guards Red",
                "hex": "#DC2626",
                "img": "assets/vehicles/porsche-911-carrera-4s-2024/images/exterior/ben_phai.png"
            },
            {
                "name": "Vàng Racing Yellow",
                "hex": "#FACC15",
                "img": "assets/vehicles/porsche-911-carrera-4s-2024/images/dashboard/ben_tren.jpg"
            },
            {
                "name": "Xanh Biển Shark Blue",
                "hex": "#0284C7",
                "img": "assets/vehicles/porsche-911-carrera-4s-2024/images/engine/ben_trai.jpg"
            },
            {
                "name": "Đen Ánh Kim Jet Black Metallic",
                "hex": "#0F172A",
                "img": "assets/vehicles/porsche-911-carrera-4s-2024/images/exterior/dang_truoc.jpg"
            }
        ],
        "colorsSummary": "Xám Phấn Crayon / Chalk, Đỏ Thể Thao Guards Red, Vàng Racing Yellow, Xanh Biển Shark Blue, Đen Ánh Kim Jet Black Metallic",
        "evSpecs": null,
        "features": [
            "Động cơ Boxer 6 xi-lanh đặt sau biểu tượng mang lại trọng tâm siêu thấp và lực bám đường vô đối",
            "Hộp số ly hợp kép PDK 8 cấp sang số chớp nhoáng không hề ngắt quãng mô-men xoắn",
            "Gói kích hoạt thể thao Sport Chrono Package với đồng hồ cơ học danh giá trên mặt táp-lô",
            "Hệ thống đánh lái trục sau (Rear-Axle Steering) tăng độ linh hoạt tuyệt đối",
            "Hệ thống quản lý lực kéo Porsche Torque Vectoring Plus (PTV Plus) và phanh gốm PCCB"
        ],
        "description": "Chuẩn mực xe thể thao toàn cầu thế hệ 992 với động cơ Boxer 6 Twin-Turbo 450 mã lực, hộp số PDK 8 cấp, dẫn động 4 bánh PTM và tăng tốc 0-100 km/h trong 3.4 giây.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/porsche_911_carrera_4s_2024.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Porsche 911 Carrera 4S (992) Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Xe Thể Thao Biểu Tượng Nước Đức tối ưu lực ép không khí và khí chất thể thao đặc trưng Porsche."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Xăng Boxer 6 xi-lanh Twin-Turbo, Hộp số ly hợp kép 8 cấp Porsche Doppelkupplung (PDK), Dẫn động 4 bánh toàn thời gian PTM AWD sản sinh công suất 450 HP (331 kW) @ 6.500 rpm cùng gia tốc 3.4s (với gói Sport Chrono Package)."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/porsche-911-carrera-4s-2024/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/porsche-911-carrera-4s-2024/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "rolls-royce-boat-tail",
        "productCode": "RR-BT-01",
        "name": "Rolls-Royce Boat Tail",
        "brand": "Rolls-Royce",
        "version": "Coachbuild Độc Bản Xa Xỉ Nhất Thế Giới (Chỉ 3 Chiếc)",
        "subtitle": "Kiệt Tác Xe Coachbuild Đắt Nhất Lịch Sử Thế Giới • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Siêu Xe",
        "subCategory": "Kiệt Tác Xe Coachbuild Đắt Nhất Lịch Sử Thế Giới",
        "fuel": "gas",
        "price": 650000000000,
        "priceFormatted": "650.000.000.000 VNĐ",
        "priceShort": "650 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá trị siêu phẩm Coachbuild độc bản thế giới (~28.000.000 USD)",
        "badge": "Coachbuild 28M USD",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 563,
        "power": "563 HP (420 kW) @ 5.000 rpm",
        "engine": "6.75L V12 Twin-Turbo danh tiếng của Rolls-Royce",
        "powertrain": "Động cơ Xăng V12 6.75L Twin-Turbo, Hộp số tự động 8 cấp ZF hỗ trợ vệ tinh SAT, Cầu sau RWD",
        "torque": "900 Nm @ 1.700 rpm",
        "acceleration": "5.2s (Vận hành êm ái như bay trên thảm thần Magic Carpet Ride)",
        "topSpeed": "250 km/h (Giới hạn điện tử)",
        "transmission": "Tự động 8 cấp ZF hỗ trợ định vị vệ tinh",
        "drive": "RWD / Cầu sau",
        "seats": 4,
        "dimensions": "5.800 x 2.050 x 1.550 mm",
        "wheelbase": "3.450 mm",
        "groundClearance": "150 mm",
        "dimensionsDetail": {
            "overall": "5.800 x 2.050 x 1.550 mm",
            "lengthMm": 5800,
            "widthMm": 2050,
            "heightMm": 1550,
            "wheelbase": "3.450 mm",
            "groundClearance": "150 mm",
            "curbWeight": "2.500 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2024,
        "warranty": "Dịch vụ hậu mãi riêng của Hoàng gia Rolls-Royce Bespoke",
        "warrantyDetail": {
            "policy": "Dịch vụ hậu mãi riêng của Hoàng gia Rolls-Royce Bespoke"
        },
        "image": "assets/vehicles/rolls-royce-boat-tail/images/exterior/rolls-royce-boat-tail-mother-of-pearl-1.jpg",
        "thumbnail": "assets/vehicles/rolls-royce-boat-tail/images/exterior/rolls-royce-boat-tail-mother-of-pearl-1.jpg",
        "cover": "assets/vehicles/rolls-royce-boat-tail/images/exterior/rolls-royce-boat-tail-mother-of-pearl-1.jpg",
        "galleryImages": [
            "assets/vehicles/rolls-royce-boat-tail/images/exterior/rolls-royce-boat-tail-mother-of-pearl-1.jpg",
            "assets/vehicles/rolls-royce-boat-tail/images/interior/8d8b0c92-62fd-4c53-b50d-bceba64b1360.jpeg",
            "assets/vehicles/rolls-royce-boat-tail/images/dashboard/3-13.webp",
            "assets/vehicles/rolls-royce-boat-tail/images/engine/img-4282-1653056286.avif",
            "assets/vehicles/rolls-royce-boat-tail/images/gallery/images.jpg",
            "assets/vehicles/rolls-royce-boat-tail/images/gallery/images (1).jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/rolls-royce-boat-tail/images/exterior/rolls-royce-boat-tail-mother-of-pearl-1.jpg"
            ],
            "interior": [
                "assets/vehicles/rolls-royce-boat-tail/images/interior/8d8b0c92-62fd-4c53-b50d-bceba64b1360.jpeg"
            ],
            "dashboard": [
                "assets/vehicles/rolls-royce-boat-tail/images/dashboard/3-13.webp"
            ],
            "engine": [
                "assets/vehicles/rolls-royce-boat-tail/images/engine/img-4282-1653056286.avif"
            ],
            "specifications": [],
            "gallery": [
                "assets/vehicles/rolls-royce-boat-tail/images/gallery/images.jpg",
                "assets/vehicles/rolls-royce-boat-tail/images/gallery/images (1).jpg"
            ]
        },
        "colors": [
            {
                "name": "Xanh Đại Dương Ocean Blue Metallic",
                "hex": "#1E3A8A",
                "img": "assets/vehicles/rolls-royce-boat-tail/images/exterior/rolls-royce-boat-tail-mother-of-pearl-1.jpg"
            },
            {
                "name": "Gỗ Cung Đình Caleidolegno Wood & Pearl",
                "hex": "#451A03",
                "img": "assets/vehicles/rolls-royce-boat-tail/images/interior/8d8b0c92-62fd-4c53-b50d-bceba64b1360.jpeg"
            }
        ],
        "colorsSummary": "Xanh Đại Dương Ocean Blue Metallic, Gỗ Cung Đình Caleidolegno Wood & Pearl",
        "evSpecs": null,
        "features": [
            "Siêu phẩm chế tác thủ công Coachbuild đắt nhất hành tinh với mức giá lên tới 28 triệu USD",
            "Đuôi xe ốp gỗ Caleidolegno tự nhiên mở cánh bướm cơ điện chứa bộ tiện nghi dã ngoại xa xỉ",
            "Tủ lạnh kép đựng rượu Champagne Armand de Brignac giữ nhiệt độ chính xác 6 độ C",
            "Cặp đồng hồ cơ học Thụy Sĩ Bovet 1822 độc bản có thể tháo rời đeo trên tay",
            "Cây dù che nắng tự động bung mở cùng cặp ghế sợi carbon thiết kế riêng của Promemoria"
        ],
        "description": "Kiệt tác nghệ thuật đương đại đắt nhất lịch sử ô tô thế giới (~28 triệu USD) chế tác thủ công bằng nhôm nguyên khối, đuôi thuyền mở cánh bướm và động cơ V12 6.75L êm ái.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/rolls_royce_boat_tail.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Rolls-Royce Boat Tail Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Kiệt Tác Xe Coachbuild Đắt Nhất Lịch Sử Thế Giới tối ưu lực ép không khí và khí chất thể thao đặc trưng Rolls-Royce."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Xăng V12 6.75L Twin-Turbo, Hộp số tự động 8 cấp ZF hỗ trợ vệ tinh SAT, Cầu sau RWD sản sinh công suất 563 HP (420 kW) @ 5.000 rpm cùng gia tốc 5.2s (Vận hành êm ái như bay trên thảm thần Magic Carpet Ride)."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/rolls-royce-boat-tail/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/rolls-royce-boat-tail/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "subaru-impreza-2024",
        "productCode": "SUB-IMP-24",
        "name": "Subaru Impreza RS (2024)",
        "brand": "Subaru",
        "version": "RS 2.5L Symmetrical AWD (Thế hệ thứ 6)",
        "subtitle": "Hatchback Dẫn Động 4 Bánh Toàn Thời Gian • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Hatchback",
        "subCategory": "Hatchback Dẫn Động 4 Bánh Toàn Thời Gian",
        "fuel": "gas",
        "price": 990000000,
        "priceFormatted": "990.000.000 VNĐ",
        "priceShort": "990 triệu",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá niêm yết dự kiến chính hãng tại Việt Nam",
        "badge": "Symmetrical AWD",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 182,
        "power": "182 HP (136 kW) @ 5.800 rpm",
        "engine": "2.5L Boxer 4 xi-lanh nằm ngang Hút khí tự nhiên",
        "powertrain": "Động cơ Xăng 2.5L Boxer 4 xi-lanh, Hộp số tự động Lineartronic CVT 8 cấp giả lập, Dẫn động 4 bánh toàn thời gian đối xứng Symmetrical AWD",
        "torque": "241 Nm @ 3.700 rpm",
        "acceleration": "7.6s",
        "topSpeed": "215 km/h",
        "transmission": "Hộp số tự động vô cấp Lineartronic CVT với lẫy chuyển số 8 cấp",
        "drive": "AWD / Dẫn động 4 bánh toàn thời gian đối xứng Symmetrical AWD độc quyền",
        "seats": 5,
        "dimensions": "4.480 x 1.780 x 1.480 mm",
        "wheelbase": "2.670 mm",
        "groundClearance": "135 mm",
        "dimensionsDetail": {
            "overall": "4.480 x 1.780 x 1.480 mm",
            "lengthMm": 4480,
            "widthMm": 1780,
            "heightMm": 1480,
            "wheelbase": "2.670 mm",
            "groundClearance": "135 mm",
            "curbWeight": "1.425 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2024,
        "warranty": "5 năm hoặc 100.000 km chính hãng Subaru",
        "warrantyDetail": {
            "policy": "5 năm hoặc 100.000 km chính hãng Subaru"
        },
        "image": "assets/vehicles/subaru-impreza-2024/images/exterior/dang_truoc.jpg",
        "thumbnail": "assets/vehicles/subaru-impreza-2024/images/exterior/dang_truoc.jpg",
        "cover": "assets/vehicles/subaru-impreza-2024/images/exterior/dang_truoc.jpg",
        "galleryImages": [
            "assets/vehicles/subaru-impreza-2024/images/exterior/dang_truoc.jpg",
            "assets/vehicles/subaru-impreza-2024/images/exterior/ben_trai.webp",
            "assets/vehicles/subaru-impreza-2024/images/dashboard/ben_tren.jpg",
            "assets/vehicles/subaru-impreza-2024/images/engine/dang_sau.jpg",
            "assets/vehicles/subaru-impreza-2024/images/gallery/ben_trai.jpeg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/subaru-impreza-2024/images/exterior/dang_truoc.jpg",
                "assets/vehicles/subaru-impreza-2024/images/exterior/ben_trai.webp"
            ],
            "interior": [],
            "dashboard": [
                "assets/vehicles/subaru-impreza-2024/images/dashboard/ben_tren.jpg"
            ],
            "engine": [
                "assets/vehicles/subaru-impreza-2024/images/engine/dang_sau.jpg"
            ],
            "specifications": [],
            "gallery": [
                "assets/vehicles/subaru-impreza-2024/images/gallery/ben_trai.jpeg"
            ]
        },
        "colors": [
            {
                "name": "Xanh Đua Subaru Oasis Blue",
                "hex": "#0284C7",
                "img": "assets/vehicles/subaru-impreza-2024/images/exterior/dang_truoc.jpg"
            },
            {
                "name": "Đỏ Thể Thao Pure Red",
                "hex": "#DC2626",
                "img": "assets/vehicles/subaru-impreza-2024/images/exterior/ben_trai.webp"
            },
            {
                "name": "Xám Magnetite Gray Metallic",
                "hex": "#475569",
                "img": "assets/vehicles/subaru-impreza-2024/images/dashboard/ben_tren.jpg"
            },
            {
                "name": "Trắng Crystal White Pearl",
                "hex": "#F8FAFC",
                "img": "assets/vehicles/subaru-impreza-2024/images/engine/dang_sau.jpg"
            }
        ],
        "colorsSummary": "Xanh Đua Subaru Oasis Blue, Đỏ Thể Thao Pure Red, Xám Magnetite Gray Metallic, Trắng Crystal White Pearl",
        "evSpecs": null,
        "features": [
            "Hệ dẫn động 4 bánh đối xứng toàn thời gian Symmetrical AWD bám đường siêu đẳng trên tuyết, mưa trơn",
            "Hệ thống an toàn hỗ trợ người lái EyeSight thế hệ thứ 4 với 3 camera quan sát góc rộng",
            "Màn hình cảm ứng đặt dọc cỡ lớn 11.6 inch hỗ trợ Apple CarPlay và Android Auto không dây",
            "Khung gầm toàn cầu Subaru Global Platform (SGP) tăng 10% độ cứng chống xoắn",
            "Hệ thống điều hướng lực kéo chủ động Active Torque Vectoring giúp vào cua tự tin"
        ],
        "description": "Hatchback thể thao thế hệ mới với động cơ Boxer 2.5L 182 mã lực, hệ dẫn động 4 bánh Symmetrical AWD huyền thoại và gói an toàn EyeSight 4.0 tối tân.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/subaru_impreza_2024.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Subaru Impreza RS (2024) Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Hatchback Dẫn Động 4 Bánh Toàn Thời Gian tối ưu lực ép không khí và khí chất thể thao đặc trưng Subaru."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Xăng 2.5L Boxer 4 xi-lanh, Hộp số tự động Lineartronic CVT 8 cấp giả lập, Dẫn động 4 bánh toàn thời gian đối xứng Symmetrical AWD sản sinh công suất 182 HP (136 kW) @ 5.800 rpm cùng gia tốc 7.6s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/subaru-impreza-2024/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/subaru-impreza-2024/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "suzuki-ciaz-2021",
        "productCode": "SZK-CIZ-21",
        "name": "Suzuki Ciaz (2021)",
        "brand": "Suzuki",
        "version": "1.4L AT Nhập Khẩu Thái Lan",
        "subtitle": "Sedan Hạng B Rộng Rãi Tiết Kiệm Nhiên Liệu Nhất • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Sedan",
        "subCategory": "Sedan Hạng B Rộng Rãi Tiết Kiệm Nhiên Liệu Nhất",
        "fuel": "gas",
        "price": 534900000,
        "priceFormatted": "534.900.000 VNĐ",
        "priceShort": "535 triệu",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá niêm yết xe nhập khẩu nguyên chiếc từ Thái Lan",
        "badge": "Siêu Tiết Kiệm 4.7L",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 91,
        "power": "91 HP (68 kW) @ 6.000 rpm",
        "engine": "1.4L K14B 4 xi-lanh thẳng hàng 16 van VVT",
        "powertrain": "Động cơ Xăng 1.4L K14B VVT, Hộp số tự động 4 cấp (4AT), Cầu trước FWD",
        "torque": "130 Nm @ 4.400 rpm",
        "acceleration": "11.8s",
        "topSpeed": "175 km/h",
        "transmission": "Tự động 4 cấp (4-Speed Automatic)",
        "drive": "FWD / Cầu trước",
        "seats": 5,
        "dimensions": "4.490 x 1.730 x 1.475 mm",
        "wheelbase": "2.650 mm (Rộng nhất phân khúc B)",
        "groundClearance": "160 mm",
        "dimensionsDetail": {
            "overall": "4.490 x 1.730 x 1.475 mm",
            "lengthMm": 4490,
            "widthMm": 1730,
            "heightMm": 1475,
            "wheelbase": "2.650 mm",
            "groundClearance": "160 mm",
            "curbWeight": "1.025 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2021,
        "warranty": "5 năm hoặc 150.000 km cho động cơ & hộp số",
        "warrantyDetail": {
            "policy": "5 năm hoặc 150.000 km cho động cơ & hộp số"
        },
        "image": "assets/vehicles/suzuki-ciaz-2021/images/exterior/phia_truoc.jpeg",
        "thumbnail": "assets/vehicles/suzuki-ciaz-2021/images/exterior/phia_truoc.jpeg",
        "cover": "assets/vehicles/suzuki-ciaz-2021/images/exterior/phia_truoc.jpeg",
        "galleryImages": [
            "assets/vehicles/suzuki-ciaz-2021/images/exterior/phia_truoc.jpeg",
            "assets/vehicles/suzuki-ciaz-2021/images/exterior/phia_sau.jpeg",
            "assets/vehicles/suzuki-ciaz-2021/images/dashboard/ben_phai.webp",
            "assets/vehicles/suzuki-ciaz-2021/images/engine/ben_trai.webp"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/suzuki-ciaz-2021/images/exterior/phia_truoc.jpeg",
                "assets/vehicles/suzuki-ciaz-2021/images/exterior/phia_sau.jpeg"
            ],
            "interior": [],
            "dashboard": [
                "assets/vehicles/suzuki-ciaz-2021/images/dashboard/ben_phai.webp"
            ],
            "engine": [
                "assets/vehicles/suzuki-ciaz-2021/images/engine/ben_trai.webp"
            ],
            "specifications": [],
            "gallery": []
        },
        "colors": [
            {
                "name": "Trắng Ngọc Trai Pearl Snow White",
                "hex": "#F8FAFC",
                "img": "assets/vehicles/suzuki-ciaz-2021/images/exterior/phia_truoc.jpeg"
            },
            {
                "name": "Đen Ánh Kim Mineral Gray",
                "hex": "#0F172A",
                "img": "assets/vehicles/suzuki-ciaz-2021/images/exterior/phia_sau.jpeg"
            },
            {
                "name": "Nâu Hoàng Gia Dignity Brown",
                "hex": "#78350F",
                "img": "assets/vehicles/suzuki-ciaz-2021/images/dashboard/ben_phai.webp"
            }
        ],
        "colorsSummary": "Trắng Ngọc Trai Pearl Snow White, Đen Ánh Kim Mineral Gray, Nâu Hoàng Gia Dignity Brown",
        "evSpecs": null,
        "features": [
            "Khoang hành khách và khoảng để chân hàng ghế sau rộng rãi nhất phân khúc sedan hạng B",
            "Mức tiêu thụ nhiên liệu siêu tiết kiệm chỉ 4.72 lít / 100 km đường trường",
            "Hệ thống giải trí màn hình cảm ứng 9 inch tích hợp camera hành trình trước sau và cảnh báo va chạm",
            "Hệ thống điều hòa tự động với khả năng làm lạnh nhanh sâu đặc trưng Suzuki",
            "Dung tích khoang hành lý cốp sau khổng lồ 510 lít chứa vừa 3 vali lớn"
        ],
        "description": "Mẫu sedan hạng B nhập khẩu Thái Lan với không gian nội thất rộng rãi bậc nhất, độ bền bỉ cao, cốp 510 lít và mức tiêu hao nhiên liệu cực kỳ tiết kiệm chỉ từ 4.7L/100km.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/suzuki_ciaz_2021.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Suzuki Ciaz (2021) Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Sedan Hạng B Rộng Rãi Tiết Kiệm Nhiên Liệu Nhất tối ưu lực ép không khí và khí chất thể thao đặc trưng Suzuki."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Xăng 1.4L K14B VVT, Hộp số tự động 4 cấp (4AT), Cầu trước FWD sản sinh công suất 91 HP (68 kW) @ 6.000 rpm cùng gia tốc 11.8s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/suzuki-ciaz-2021/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/suzuki-ciaz-2021/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "tesla-cybertruck",
        "productCode": "TSL-CT-01",
        "name": "Tesla Cybertruck",
        "brand": "Tesla",
        "version": "Dual-Motor AWD / Cyberbeast Tri-Motor",
        "subtitle": "Bán Tải Thuần Điện Khung Thép 30X • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Pickup",
        "subCategory": "Bán Tải Thuần Điện Khung Thép 30X",
        "fuel": "ev",
        "price": 7500000000,
        "priceFormatted": "7.500.000.000 VNĐ",
        "priceShort": "7.5 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá đại lý tư nhân nhập khẩu tham khảo tại VN (Bản AWD: 7.5 tỷ | Cyberbeast: 9.5 tỷ)",
        "badge": "Exoskeleton 800V",
        "range": 547,
        "rangeExtendedKm": 755,
        "hp": 845,
        "power": "600 HP (Dual-Motor) / 845 HP (Cyberbeast Tri-Motor)",
        "engine": "Dual-Motor AWD (600 HP) / Tri-Motor Cyberbeast (845 HP)",
        "powertrain": "Động cơ Điện Đa Mô-tơ AWD, Kiến trúc Điện 800V & 48V",
        "torque": "10.296 lb-ft (Cyberbeast) / 7.435 lb-ft (Dual-Motor AWD)",
        "acceleration": "2.6s (Beast Mode)",
        "topSpeed": "209 km/h",
        "transmission": "Hộp số điện tử 1 cấp (Single-Speed Direct Drive)",
        "drive": "AWD / Dẫn động 4 bánh & Đánh lái 4 bánh Steer-by-Wire",
        "seats": 5,
        "dimensions": "5.682 x 2.200 x 1.791 mm",
        "wheelbase": "3.635 mm",
        "groundClearance": "443 mm (Extract Mode)",
        "dimensionsDetail": {
            "overall": "5.682 x 2.200 x 1.791 mm",
            "lengthMm": 5682,
            "widthMm": 2200,
            "heightMm": 1791,
            "wheelbase": "3.635 mm",
            "groundClearance": "443 mm",
            "curbWeight": "3.100 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2025,
        "warranty": "4 năm hoặc 80.000 km (Pin & Động cơ: 8 năm hoặc 240.000 km)",
        "warrantyDetail": {
            "policy": "4 năm hoặc 80.000 km (Pin & Động cơ: 8 năm hoặc 240.000 km)"
        },
        "image": "assets/vehicles/tesla-cybertruck/images/exterior/b6aa80f8-cc61-4a87-bc63-df76743451ed.jpg",
        "thumbnail": "assets/vehicles/tesla-cybertruck/images/exterior/b6aa80f8-cc61-4a87-bc63-df76743451ed.jpg",
        "cover": "assets/vehicles/tesla-cybertruck/images/exterior/b6aa80f8-cc61-4a87-bc63-df76743451ed.jpg",
        "galleryImages": [
            "assets/vehicles/tesla-cybertruck/images/exterior/b6aa80f8-cc61-4a87-bc63-df76743451ed.jpg",
            "assets/vehicles/tesla-cybertruck/images/interior/cfe60097-2d4b-405f-9082-97822f3b806a.jpg",
            "assets/vehicles/tesla-cybertruck/images/dashboard/d13d4525-2034-47b5-88e1-45e703965d2f.jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/tesla-cybertruck/images/exterior/b6aa80f8-cc61-4a87-bc63-df76743451ed.jpg"
            ],
            "interior": [
                "assets/vehicles/tesla-cybertruck/images/interior/cfe60097-2d4b-405f-9082-97822f3b806a.jpg"
            ],
            "dashboard": [
                "assets/vehicles/tesla-cybertruck/images/dashboard/d13d4525-2034-47b5-88e1-45e703965d2f.jpg"
            ],
            "engine": [],
            "specifications": [],
            "gallery": []
        },
        "colors": [
            {
                "name": "Thép Không Gỉ 30X Nguyên Bản (Stainless Steel)",
                "hex": "#94A3B8",
                "img": "assets/vehicles/tesla-cybertruck/images/exterior/b6aa80f8-cc61-4a87-bc63-df76743451ed.jpg"
            },
            {
                "name": "Đen Satin Chiến Thuật (Satin Stealth Black)",
                "hex": "#1E293B",
                "img": "assets/vehicles/tesla-cybertruck/images/interior/cfe60097-2d4b-405f-9082-97822f3b806a.jpg"
            },
            {
                "name": "Trắng Satin Bắc Cực (Satin Ceramic White)",
                "hex": "#F1F5F9",
                "img": "assets/vehicles/tesla-cybertruck/images/dashboard/d13d4525-2034-47b5-88e1-45e703965d2f.jpg"
            },
            {
                "name": "Xanh Rêu Quân Đội (Tactical Green Wrap)",
                "hex": "#3F6212",
                "img": "assets/vehicles/tesla-cybertruck/images/exterior/b6aa80f8-cc61-4a87-bc63-df76743451ed.jpg"
            }
        ],
        "colorsSummary": "Thép Không Gỉ 30X Nguyên Bản (Stainless Steel), Đen Satin Chiến Thuật (Satin Stealth Black), Trắng Satin Bắc Cực (Satin Ceramic White), Xanh Rêu Quân Đội (Tactical Green Wrap)",
        "evSpecs": {
            "batteryCapacity": "123 kWh (Kiến trúc Điện Áp Siêu Cao 800V)",
            "rangeKm": 547,
            "rangeExtendedKm": 755,
            "fastCharge": "Supercharger V4 (15 phút sạc đi được 218 km)",
            "architecture": "800V High-Voltage Architecture"
        },
        "features": [
            "Khung vỏ Exoskeleton thép không gỉ cán nguội 30X chống móp méo, rỉ sét và chống đạn",
            "Hệ thống lái điện tử Steer-by-Wire biến thiên kết hợp đánh lái 4 bánh 4WS",
            "Trạm phát điện di động PowerShare 11.5 kW cấp điện cho ngôi nhà khi mất điện",
            "Kính cường lực Armor Glass cách âm, chịu va đập cực mạnh từ đá dăm",
            "Thùng xe Vault 1.897 lít tích hợp nắp che Tonneau Cover cơ điện chịu lực 100 kg"
        ],
        "description": "Siêu bán tải thuần điện với khung thép chống đạn 30X, kính Armor Glass, Steer-by-Wire, kiến trúc 800V, đánh lái 4 bánh và trạm phát điện PowerShare.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/tesla_cybertruck.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Tesla Cybertruck Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Bán Tải Thuần Điện Khung Thép 30X tối ưu lực ép không khí và khí chất thể thao đặc trưng Tesla."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Điện Đa Mô-tơ AWD, Kiến trúc Điện 800V & 48V sản sinh công suất 600 HP (Dual-Motor) / 845 HP (Cyberbeast Tri-Motor) cùng gia tốc 2.6s (Beast Mode)."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/tesla-cybertruck/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/tesla-cybertruck/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "tesla-roadster-2",
        "productCode": "TSL-RD2-26",
        "name": "Tesla Roadster 2.0",
        "brand": "Tesla",
        "version": "SpaceX Package Tri-Motor 10000 Nm",
        "subtitle": "Siêu Xe Điện Nhanh Nhất Thế Giới • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Siêu Xe",
        "subCategory": "Siêu Xe Điện Nhanh Nhất Thế Giới",
        "fuel": "ev",
        "price": 5900000000,
        "priceFormatted": "5.900.000.000 VNĐ",
        "priceShort": "5.9 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá đặt cọc quy đổi tại Mỹ (~250.000 USD Founder Series)",
        "badge": "0-100km/h 1.1s SpaceX",
        "range": 1000,
        "rangeExtendedKm": null,
        "hp": 1000,
        "power": "Hơn 1.000 HP, 3 Mô-tơ điện (1 trước, 2 sau)",
        "engine": "Tri-Motor Plaid Electric Powertrain",
        "powertrain": "Hệ thống 3 Mô-tơ điện Tri-Motor AWD, Pin 200 kWh, Tùy chọn van đẩy khí nén lạnh SpaceX thrusters",
        "torque": "10.000 Nm (Mô-men xoắn tại bánh xe)",
        "acceleration": "1.1s (với gói tên lửa SpaceX Package) / 1.9s tiêu chuẩn",
        "topSpeed": "Hơn 400 km/h",
        "transmission": "Hộp số truyền động trực tiếp 1 cấp",
        "drive": "AWD / Dẫn động 4 bánh toàn thời gian với điều hướng lực kéo",
        "seats": 4,
        "dimensions": "4.450 x 1.950 x 1.200 mm",
        "wheelbase": "2.650 mm",
        "groundClearance": "120 mm",
        "dimensionsDetail": {
            "overall": "4.450 x 1.950 x 1.200 mm",
            "lengthMm": 4450,
            "widthMm": 1950,
            "heightMm": 1200,
            "wheelbase": "2.650 mm",
            "groundClearance": "120 mm",
            "curbWeight": "1.950 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2026,
        "warranty": "4 năm hoặc 80.000 km xe & 8 năm bảo hành Pin 200 kWh",
        "warrantyDetail": {
            "policy": "4 năm hoặc 80.000 km xe & 8 năm bảo hành Pin 200 kWh"
        },
        "image": "assets/vehicles/tesla-roadster-2/images/exterior/93b022b7-1b9f-4d2c-9344-fc8f6d84db48-1792213074253-17922130753241014805587.webp",
        "thumbnail": "assets/vehicles/tesla-roadster-2/images/exterior/93b022b7-1b9f-4d2c-9344-fc8f6d84db48-1792213074253-17922130753241014805587.webp",
        "cover": "assets/vehicles/tesla-roadster-2/images/exterior/93b022b7-1b9f-4d2c-9344-fc8f6d84db48-1792213074253-17922130753241014805587.webp",
        "galleryImages": [
            "assets/vehicles/tesla-roadster-2/images/exterior/93b022b7-1b9f-4d2c-9344-fc8f6d84db48-1792213074253-17922130753241014805587.webp",
            "assets/vehicles/tesla-roadster-2/images/interior/64282afb-3874-4640-9e9d-e79567532297-1792213064649-17922130652291396392324.webp",
            "assets/vehicles/tesla-roadster-2/images/dashboard/Tesla-Roadster-1-1792392934-6883-1792392963.webp",
            "assets/vehicles/tesla-roadster-2/images/engine/tesla-roadster-1-1792657971177665111099-225-0-1565-2560-crop-17926581504471619471522.webp",
            "assets/vehicles/tesla-roadster-2/images/gallery/ojdpwmjszryfjwtcrubdfo-0804.webp",
            "assets/vehicles/tesla-roadster-2/images/gallery/teslaaa-13164900.jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/tesla-roadster-2/images/exterior/93b022b7-1b9f-4d2c-9344-fc8f6d84db48-1792213074253-17922130753241014805587.webp"
            ],
            "interior": [
                "assets/vehicles/tesla-roadster-2/images/interior/64282afb-3874-4640-9e9d-e79567532297-1792213064649-17922130652291396392324.webp"
            ],
            "dashboard": [
                "assets/vehicles/tesla-roadster-2/images/dashboard/Tesla-Roadster-1-1792392934-6883-1792392963.webp"
            ],
            "engine": [
                "assets/vehicles/tesla-roadster-2/images/engine/tesla-roadster-1-1792657971177665111099-225-0-1565-2560-crop-17926581504471619471522.webp"
            ],
            "specifications": [],
            "gallery": [
                "assets/vehicles/tesla-roadster-2/images/gallery/ojdpwmjszryfjwtcrubdfo-0804.webp",
                "assets/vehicles/tesla-roadster-2/images/gallery/teslaaa-13164900.jpg"
            ]
        },
        "colors": [
            {
                "name": "Đỏ Thể Thao Tesla Red Multi-Coat",
                "hex": "#DC2626",
                "img": "assets/vehicles/tesla-roadster-2/images/exterior/93b022b7-1b9f-4d2c-9344-fc8f6d84db48-1792213074253-17922130753241014805587.webp"
            },
            {
                "name": "Bạc Midnight Silver Metallic",
                "hex": "#94A3B8",
                "img": "assets/vehicles/tesla-roadster-2/images/interior/64282afb-3874-4640-9e9d-e79567532297-1792213064649-17922130652291396392324.webp"
            },
            {
                "name": "Trắng Ngọc Pearl White",
                "hex": "#F8FAFC",
                "img": "assets/vehicles/tesla-roadster-2/images/dashboard/Tesla-Roadster-1-1792392934-6883-1792392963.webp"
            }
        ],
        "colorsSummary": "Đỏ Thể Thao Tesla Red Multi-Coat, Bạc Midnight Silver Metallic, Trắng Ngọc Pearl White",
        "evSpecs": {
            "batteryCapacity": "200 kWh Siêu Khủng",
            "rangeKm": 1000,
            "fastCharge": "Supercharger V4 tốc độ 350 kW+",
            "architecture": "Kiến trúc điện cao áp Plaid"
        },
        "features": [
            "Gói nâng cấp SpaceX Package tích hợp bình khí nén lạnh tăng tốc 0-100 km/h trong 1.1 giây",
            "Pin dung lượng 200 kWh cung cấp phạm vi hoạt động kỷ lục gần 1.000 km sau một lần sạc",
            "Mui kính thủy tinh tháo rời nhẹ nhàng cất gọn trong cốp xe chuyển thành mui trần Targa",
            "Mô-men xoắn cực đại 10.000 Nm tại bánh xe xé toạc mọi giới hạn vật lý",
            "Vô lăng kiểu phi thuyền Yoke lái điện tử và màn hình cong trung tâm siêu nét"
        ],
        "description": "Siêu xe điện phá vỡ mọi kỷ lục tốc độ với gia tốc 0-100 km/h trong 1.1s (gói SpaceX), mô-men xoắn 10.000 Nm, pin 200 kWh đi 1.000 km và mui trần kính tháo rời.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/tesla_roadster_2.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Tesla Roadster 2.0 Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Siêu Xe Điện Nhanh Nhất Thế Giới tối ưu lực ép không khí và khí chất thể thao đặc trưng Tesla."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Hệ thống 3 Mô-tơ điện Tri-Motor AWD, Pin 200 kWh, Tùy chọn van đẩy khí nén lạnh SpaceX thrusters sản sinh công suất Hơn 1.000 HP, 3 Mô-tơ điện (1 trước, 2 sau) cùng gia tốc 1.1s (với gói tên lửa SpaceX Package) / 1.9s tiêu chuẩn."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/tesla-roadster-2/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/tesla-roadster-2/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "toyota-camry",
        "productCode": "TOY-CAM-25Q",
        "name": "Toyota Camry 2.5Q",
        "brand": "Toyota",
        "version": "2.5Q Dynamic Force (Thế hệ mới)",
        "subtitle": "Sedan Hạng D Doanh Nhân Cao Cấp • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Sedan",
        "subCategory": "Sedan Hạng D Doanh Nhân Cao Cấp",
        "fuel": "gas",
        "price": 1405000000,
        "priceFormatted": "1.405.000.000 VNĐ",
        "priceShort": "1.405 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá niêm yết chính hãng Toyota Việt Nam",
        "badge": "Sedan Hạng D",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 207,
        "power": "207 HP (152 kW) @ 6.600 rpm",
        "engine": "2.5L 4 xi-lanh DOHC VVT-iE Dynamic Force (A25A-FKS)",
        "powertrain": "Động cơ Xăng 2.5L Dynamic Force, Hộp số tự động 8 cấp Direct Shift 8AT, Cầu trước FWD",
        "torque": "250 Nm @ 5.000 rpm",
        "acceleration": "8.2s",
        "topSpeed": "215 km/h",
        "transmission": "Tự động 8 cấp (Direct Shift 8AT) tích hợp lẫy chuyển số",
        "drive": "FWD / Cầu trước",
        "seats": 5,
        "dimensions": "4.885 x 1.840 x 1.445 mm",
        "wheelbase": "2.825 mm",
        "groundClearance": "140 mm",
        "dimensionsDetail": {
            "overall": "4.885 x 1.840 x 1.445 mm",
            "lengthMm": 4885,
            "widthMm": 1840,
            "heightMm": 1445,
            "wheelbase": "2.825 mm",
            "groundClearance": "140 mm",
            "curbWeight": "1.560 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2024,
        "warranty": "5 năm hoặc 150.000 km chính hãng Toyota Việt Nam",
        "warrantyDetail": {
            "policy": "5 năm hoặc 150.000 km chính hãng Toyota Việt Nam"
        },
        "image": "assets/vehicles/toyota-camry/images/exterior/2020-Toyota-Camry-front_12148_032_1834x733_040_cropped.png",
        "thumbnail": "assets/vehicles/toyota-camry/images/exterior/2020-Toyota-Camry-front_12148_032_1834x733_040_cropped.png",
        "cover": "assets/vehicles/toyota-camry/images/exterior/2020-Toyota-Camry-front_12148_032_1834x733_040_cropped.png",
        "galleryImages": [
            "assets/vehicles/toyota-camry/images/exterior/2020-Toyota-Camry-front_12148_032_1834x733_040_cropped.png",
            "assets/vehicles/toyota-camry/images/interior/2020-toyota-camry-mmp-2-1566921081.avif",
            "assets/vehicles/toyota-camry/images/dashboard/2.jpg",
            "assets/vehicles/toyota-camry/images/engine/1.jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/toyota-camry/images/exterior/2020-Toyota-Camry-front_12148_032_1834x733_040_cropped.png"
            ],
            "interior": [
                "assets/vehicles/toyota-camry/images/interior/2020-toyota-camry-mmp-2-1566921081.avif"
            ],
            "dashboard": [
                "assets/vehicles/toyota-camry/images/dashboard/2.jpg"
            ],
            "engine": [
                "assets/vehicles/toyota-camry/images/engine/1.jpg"
            ],
            "specifications": [],
            "gallery": []
        },
        "colors": [
            {
                "name": "Trắng Ngọc Trai (089)",
                "hex": "#F8FAFC",
                "img": "assets/vehicles/toyota-camry/images/exterior/2020-Toyota-Camry-front_12148_032_1834x733_040_cropped.png"
            },
            {
                "name": "Đen Ánh Kim (218)",
                "hex": "#0F172A",
                "img": "assets/vehicles/toyota-camry/images/interior/2020-toyota-camry-mmp-2-1566921081.avif"
            },
            {
                "name": "Đỏ Ánh Kim (3T3)",
                "hex": "#B91C1C",
                "img": "assets/vehicles/toyota-camry/images/dashboard/2.jpg"
            },
            {
                "name": "Ghi Bạc (1D4)",
                "hex": "#94A3B8",
                "img": "assets/vehicles/toyota-camry/images/engine/1.jpg"
            }
        ],
        "colorsSummary": "Trắng Ngọc Trai (089), Đen Ánh Kim (218), Đỏ Ánh Kim (3T3), Ghi Bạc (1D4)",
        "evSpecs": null,
        "features": [
            "Nền tảng khung gầm toàn cầu TNGA tăng cường độ cứng vững và hạ thấp trọng tâm",
            "Gói an toàn chủ động Toyota Safety Sense 2.0+ (Phanh tự động PCS, giữ làn LTA, ga tự động DRCC)",
            "Hàng ghế ông chủ phía sau tích hợp cụm điều khiển cảm ứng ngả điện và rèm che nắng điện",
            "Hệ thống âm thanh 9 loa JBL cao cấp sống động",
            "Màn hình hiển thị trên kính lái HUD kết hợp camera toàn cảnh 360 độ siêu nét"
        ],
        "description": "Biểu tượng sedan doanh nhân hạng D hàng đầu với khung gầm TNGA đầm chắc, động cơ 207 mã lực 8AT, gói an toàn TSS 2.0+ và hàng ghế sau chỉnh điện đẳng cấp thương gia.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/toyota_camry.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "Toyota Camry 2.5Q Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Sedan Hạng D Doanh Nhân Cao Cấp tối ưu lực ép không khí và khí chất thể thao đặc trưng Toyota."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Xăng 2.5L Dynamic Force, Hộp số tự động 8 cấp Direct Shift 8AT, Cầu trước FWD sản sinh công suất 207 HP (152 kW) @ 6.600 rpm cùng gia tốc 8.2s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/toyota-camry/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/toyota-camry/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "vinfast-fadil",
        "productCode": "VNF-FDL-22",
        "name": "VinFast Fadil",
        "brand": "VinFast",
        "version": "1.4L Cao Cấp (Premium)",
        "subtitle": "Xe Đô Thị Cỡ Nhỏ Hatchback Bán Chạy Nhất • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Hatchback",
        "subCategory": "Xe Đô Thị Cỡ Nhỏ Hatchback Bán Chạy Nhất",
        "fuel": "gas",
        "price": 382000000,
        "priceFormatted": "382.000.000 VNĐ",
        "priceShort": "382 triệu",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá tham khảo xe đã qua sử dụng đạt chuẩn kiểm định 176 điểm SIGMACAR",
        "badge": "Vua Doanh Số Hạng A",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 98,
        "power": "98 HP (72 kW) @ 6.200 rpm",
        "engine": "1.4L 4 xi-lanh thẳng hàng DOHC",
        "powertrain": "Động cơ Xăng 1.4L 4 xi-lanh, Hộp số tự động vô cấp CVT, Cầu trước FWD",
        "torque": "128 Nm @ 4.400 rpm",
        "acceleration": "10.5s",
        "topSpeed": "170 km/h",
        "transmission": "Tự động vô cấp CVT êm ái",
        "drive": "FWD / Cầu trước",
        "seats": 5,
        "dimensions": "3.676 x 1.632 x 1.530 mm",
        "wheelbase": "2.385 mm",
        "groundClearance": "150 mm",
        "dimensionsDetail": {
            "overall": "3.676 x 1.632 x 1.530 mm",
            "lengthMm": 3676,
            "widthMm": 1632,
            "heightMm": 1530,
            "wheelbase": "2.385 mm",
            "groundClearance": "150 mm",
            "curbWeight": "992 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2022,
        "warranty": "Bảo hành chính hãng 10 năm hoặc 200.000 km của VinFast",
        "warrantyDetail": {
            "policy": "Bảo hành chính hãng 10 năm hoặc 200.000 km của VinFast"
        },
        "image": "assets/vehicles/vinfast-fadil/images/exterior/vinfast-fadil-may-cho-mau-trang_1651222888.jpeg",
        "thumbnail": "assets/vehicles/vinfast-fadil/images/exterior/vinfast-fadil-may-cho-mau-trang_1651222888.jpeg",
        "cover": "assets/vehicles/vinfast-fadil/images/exterior/vinfast-fadil-may-cho-mau-trang_1651222888.jpeg",
        "galleryImages": [
            "assets/vehicles/vinfast-fadil/images/exterior/vinfast-fadil-may-cho-mau-trang_1651222888.jpeg",
            "assets/vehicles/vinfast-fadil/images/interior/images (13).jpg",
            "assets/vehicles/vinfast-fadil/images/dashboard/images (12).jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/vinfast-fadil/images/exterior/vinfast-fadil-may-cho-mau-trang_1651222888.jpeg"
            ],
            "interior": [
                "assets/vehicles/vinfast-fadil/images/interior/images (13).jpg"
            ],
            "dashboard": [
                "assets/vehicles/vinfast-fadil/images/dashboard/images (12).jpg"
            ],
            "engine": [],
            "specifications": [],
            "gallery": []
        },
        "colors": [
            {
                "name": "Trắng Brahminy White",
                "hex": "#F8FAFC",
                "img": "assets/vehicles/vinfast-fadil/images/exterior/vinfast-fadil-may-cho-mau-trang_1651222888.jpeg"
            },
            {
                "name": "Đỏ Mystique Red",
                "hex": "#DC2626",
                "img": "assets/vehicles/vinfast-fadil/images/interior/images (13).jpg"
            },
            {
                "name": "Xám Neptune Grey",
                "hex": "#64748B",
                "img": "assets/vehicles/vinfast-fadil/images/dashboard/images (12).jpg"
            },
            {
                "name": "Cam Action Orange",
                "hex": "#EA580C",
                "img": "assets/vehicles/vinfast-fadil/images/exterior/vinfast-fadil-may-cho-mau-trang_1651222888.jpeg"
            }
        ],
        "colorsSummary": "Trắng Brahminy White, Đỏ Mystique Red, Xám Neptune Grey, Cam Action Orange",
        "evSpecs": null,
        "features": [
            "Động cơ 1.4L mạnh mẽ nhất trong toàn bộ phân khúc xe đô thị cỡ A tại Việt Nam",
            "Đầy đủ tính năng an toàn vượt cấp: Cân bằng điện tử ESC, Kiểm soát lực kéo TCS, Hỗ trợ khởi hành ngang dốc HSA",
            "Hệ thống chống lật xe ROM độc quyền trong phân khúc xe hạng A",
            "Màn hình giải trí cảm ứng 7 inch tích hợp Apple CarPlay và camera lùi",
            "Khung gầm châu Âu chắc nịch cách âm vượt trội khi đi cao tốc"
        ],
        "description": "Vua doanh số xe đô thị cỡ nhỏ tại Việt Nam với động cơ 1.4L 98 mã lực mạnh nhất phân khúc A, trang bị an toàn chuẩn 4 sao ASEAN NCAP và khung gầm chuẩn châu Âu.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/vinfast_fadil.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "VinFast Fadil Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Xe Đô Thị Cỡ Nhỏ Hatchback Bán Chạy Nhất tối ưu lực ép không khí và khí chất thể thao đặc trưng VinFast."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Xăng 1.4L 4 xi-lanh, Hộp số tự động vô cấp CVT, Cầu trước FWD sản sinh công suất 98 HP (72 kW) @ 6.200 rpm cùng gia tốc 10.5s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/vinfast-fadil/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/vinfast-fadil/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "vinfast-lux-a20",
        "productCode": "VNF-LUXA-22",
        "name": "VinFast Lux A2.0",
        "brand": "VinFast",
        "version": "2.0L Turbo Cao Cấp (Premium 228 HP)",
        "subtitle": "Sedan Hạng E Khung Gầm BMW & Pininfarina • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "Sedan",
        "subCategory": "Sedan Hạng E Khung Gầm BMW & Pininfarina",
        "fuel": "gas",
        "price": 680000000,
        "priceFormatted": "680.000.000 VNĐ",
        "priceShort": "680 triệu",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá tham khảo xe kiểm định chính hãng SIGMACAR Certified 176 điểm",
        "badge": "Chất Đức - Thiết Kế Ý",
        "range": null,
        "rangeExtendedKm": null,
        "hp": 228,
        "power": "228 HP (168 kW) @ 5.000 - 6.000 rpm",
        "engine": "2.0L DOHC Turbo 4 xi-lanh thẳng hàng (Nền tảng động cơ BMW N20)",
        "powertrain": "Động cơ Xăng 2.0L Turbo BMW, Hộp số tự động 8 cấp ZF danh tiếng, Cầu sau RWD",
        "torque": "350 Nm @ 1.750 - 4.500 rpm",
        "acceleration": "7.1s",
        "topSpeed": "240 km/h",
        "transmission": "Tự động 8 cấp ZF (Đức)",
        "drive": "RWD / Cầu sau (Dẫn động cầu sau thể thao)",
        "seats": 5,
        "dimensions": "4.973 x 1.900 x 1.500 mm",
        "wheelbase": "2.968 mm (Chuẩn sedan hạng E)",
        "groundClearance": "150 mm",
        "dimensionsDetail": {
            "overall": "4.973 x 1.900 x 1.500 mm",
            "lengthMm": 4973,
            "widthMm": 1900,
            "heightMm": 1500,
            "wheelbase": "2.968 mm",
            "groundClearance": "150 mm",
            "curbWeight": "1.795 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2022,
        "warranty": "Bảo hành chính hãng 10 năm hoặc 200.000 km của VinFast",
        "warrantyDetail": {
            "policy": "Bảo hành chính hãng 10 năm hoặc 200.000 km của VinFast"
        },
        "image": "assets/vehicles/vinfast-lux-a20/images/exterior/Xe-Vinfast-Lux-A-6.jpg",
        "thumbnail": "assets/vehicles/vinfast-lux-a20/images/exterior/Xe-Vinfast-Lux-A-6.jpg",
        "cover": "assets/vehicles/vinfast-lux-a20/images/exterior/Xe-Vinfast-Lux-A-6.jpg",
        "galleryImages": [
            "assets/vehicles/vinfast-lux-a20/images/exterior/Xe-Vinfast-Lux-A-6.jpg",
            "assets/vehicles/vinfast-lux-a20/images/interior/images (14).jpg",
            "assets/vehicles/vinfast-lux-a20/images/dashboard/images (15).jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/vinfast-lux-a20/images/exterior/Xe-Vinfast-Lux-A-6.jpg"
            ],
            "interior": [
                "assets/vehicles/vinfast-lux-a20/images/interior/images (14).jpg"
            ],
            "dashboard": [
                "assets/vehicles/vinfast-lux-a20/images/dashboard/images (15).jpg"
            ],
            "engine": [],
            "specifications": [],
            "gallery": []
        },
        "colors": [
            {
                "name": "Trắng Brahminy White",
                "hex": "#F8FAFC",
                "img": "assets/vehicles/vinfast-lux-a20/images/exterior/Xe-Vinfast-Lux-A-6.jpg"
            },
            {
                "name": "Đen Jet Black",
                "hex": "#0F172A",
                "img": "assets/vehicles/vinfast-lux-a20/images/interior/images (14).jpg"
            },
            {
                "name": "Đỏ Mystique Red",
                "hex": "#B91C1C",
                "img": "assets/vehicles/vinfast-lux-a20/images/dashboard/images (15).jpg"
            },
            {
                "name": "Xanh Cormorant Brown",
                "hex": "#1E3A8A",
                "img": "assets/vehicles/vinfast-lux-a20/images/exterior/Xe-Vinfast-Lux-A-6.jpg"
            }
        ],
        "colorsSummary": "Trắng Brahminy White, Đen Jet Black, Đỏ Mystique Red, Xanh Cormorant Brown",
        "evSpecs": null,
        "features": [
            "Nền tảng khung gầm và hệ thống treo nhôm độc quyền chia sẻ từ BMW 5-Series (F10)",
            "Thiết kế ngoại thất quý phái chắp bút bởi studio lừng danh Pininfarina (Ý)",
            "Dẫn động cầu sau RWD kết hợp hộp số 8 cấp ZF mang lại cảm giác lái đầm chắc tuyệt hảo",
            "Nội thất da Nappa thượng hạng kèm ốp gỗ hoặc nhôm phay cao cấp",
            "Hệ thống âm thanh 13 loa có âm-ly rời, sạc không dây và điều hòa độc lập 2 vùng"
        ],
        "description": "Sedan hạng E cao cấp mang tinh hoa thiết kế Ý Pininfarina và cơ khí Đức với khung gầm BMW, động cơ 2.0L Turbo 228 mã lực, dẫn động cầu sau RWD và hộp số 8 cấp ZF.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/vinfast_lux_a20.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "VinFast Lux A2.0 Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Sedan Hạng E Khung Gầm BMW & Pininfarina tối ưu lực ép không khí và khí chất thể thao đặc trưng VinFast."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Xăng 2.0L Turbo BMW, Hộp số tự động 8 cấp ZF danh tiếng, Cầu sau RWD sản sinh công suất 228 HP (168 kW) @ 5.000 - 6.000 rpm cùng gia tốc 7.1s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/vinfast-lux-a20/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/vinfast-lux-a20/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "vinfast-vf3",
        "productCode": "VNF-VF3-25",
        "name": "VinFast VF 3",
        "brand": "VinFast",
        "version": "Kèm Pin (Bản thương mại chính thức)",
        "subtitle": "Mini SUV Thuần Điện Đô Thị Quốc Dân • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "SUV",
        "subCategory": "Mini SUV Thuần Điện Đô Thị Quốc Dân",
        "fuel": "ev",
        "price": 322000000,
        "priceFormatted": "322.000.000 VNĐ",
        "priceShort": "322 triệu",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá niêm yết chính thức kèm pin (Bản thuê pin: 240.000.000 VNĐ)",
        "badge": "Xe Điện Quốc Dân",
        "range": 215,
        "rangeExtendedKm": null,
        "hp": 43,
        "power": "43 HP (32 kW), Động cơ điện cầu sau RWD",
        "engine": "1 Mô-tơ điện Nam Châm Vĩnh Cửu đặt tại cầu sau",
        "powertrain": "Động cơ Điện 1 Mô-tơ RWD, Pin LFP 18.64 kWh, Sạc nhanh DC 10-70% trong 36 phút",
        "torque": "110 Nm tức thì",
        "acceleration": "5.3s (0-50 km/h)",
        "topSpeed": "100 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "drive": "RWD / Cầu sau",
        "seats": 4,
        "dimensions": "3.190 x 1.679 x 1.622 mm",
        "wheelbase": "2.075 mm",
        "groundClearance": "191 mm (Cao nhất phân khúc mini car)",
        "dimensionsDetail": {
            "overall": "3.190 x 1.679 x 1.622 mm",
            "lengthMm": 3190,
            "widthMm": 1679,
            "heightMm": 1622,
            "wheelbase": "2.075 mm",
            "groundClearance": "191 mm",
            "curbWeight": "865 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2025,
        "warranty": "7 năm hoặc 160.000 km cho xe & 8 năm không giới hạn km cho pin",
        "warrantyDetail": {
            "policy": "7 năm hoặc 160.000 km cho xe & 8 năm không giới hạn km cho pin"
        },
        "image": "assets/vehicles/vinfast-vf3/images/exterior/gia-xe-vinfast-vf-3-moi-nhat-1.jpg",
        "thumbnail": "assets/vehicles/vinfast-vf3/images/exterior/gia-xe-vinfast-vf-3-moi-nhat-1.jpg",
        "cover": "assets/vehicles/vinfast-vf3/images/exterior/gia-xe-vinfast-vf-3-moi-nhat-1.jpg",
        "galleryImages": [
            "assets/vehicles/vinfast-vf3/images/exterior/gia-xe-vinfast-vf-3-moi-nhat-1.jpg",
            "assets/vehicles/vinfast-vf3/images/interior/4434c532-16-9-vinfast-2-1536x864-8202.jpg",
            "assets/vehicles/vinfast-vf3/images/dashboard/images.jpg",
            "assets/vehicles/vinfast-vf3/images/engine/images3.jpg",
            "assets/vehicles/vinfast-vf3/images/gallery/images (2).jpg",
            "assets/vehicles/vinfast-vf3/images/gallery/images (1).jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/vinfast-vf3/images/exterior/gia-xe-vinfast-vf-3-moi-nhat-1.jpg"
            ],
            "interior": [
                "assets/vehicles/vinfast-vf3/images/interior/4434c532-16-9-vinfast-2-1536x864-8202.jpg"
            ],
            "dashboard": [
                "assets/vehicles/vinfast-vf3/images/dashboard/images.jpg"
            ],
            "engine": [
                "assets/vehicles/vinfast-vf3/images/engine/images3.jpg"
            ],
            "specifications": [],
            "gallery": [
                "assets/vehicles/vinfast-vf3/images/gallery/images (2).jpg",
                "assets/vehicles/vinfast-vf3/images/gallery/images (1).jpg"
            ]
        },
        "colors": [
            {
                "name": "Vàng Nắng Mai (Zenith Yellow)",
                "hex": "#FACC15",
                "img": "assets/vehicles/vinfast-vf3/images/exterior/gia-xe-vinfast-vf-3-moi-nhat-1.jpg"
            },
            {
                "name": "Xanh Lá Tươi Mát (Mint Green)",
                "hex": "#86EFAC",
                "img": "assets/vehicles/vinfast-vf3/images/interior/4434c532-16-9-vinfast-2-1536x864-8202.jpg"
            },
            {
                "name": "Hồng Phấn Ngọt Ngào (Rose Pink)",
                "hex": "#F472B6",
                "img": "assets/vehicles/vinfast-vf3/images/dashboard/images.jpg"
            },
            {
                "name": "Xanh Biển Năng Động (Electric Blue)",
                "hex": "#38BDF8",
                "img": "assets/vehicles/vinfast-vf3/images/engine/images3.jpg"
            },
            {
                "name": "Trắng Tinh Khôi (Infinity White)",
                "hex": "#F8FAFC",
                "img": "assets/vehicles/vinfast-vf3/images/gallery/images (2).jpg"
            }
        ],
        "colorsSummary": "Vàng Nắng Mai (Zenith Yellow), Xanh Lá Tươi Mát (Mint Green), Hồng Phấn Ngọt Ngào (Rose Pink), Xanh Biển Năng Động (Electric Blue), Trắng Tinh Khôi (Infinity White)",
        "evSpecs": {
            "batteryCapacity": "18.64 kWh (Pin Lithium Iron Phosphate LFP an toàn cao)",
            "rangeKm": 215,
            "fastCharge": "Sạc nhanh DC 10% - 70% trong 36 phút",
            "architecture": "Hệ thống điện áp EV đô thị tối ưu"
        },
        "features": [
            "Hiện tượng xe điện quốc dân với hơn 27.000 đơn đặt cọc chỉ sau 66 giờ mở bán",
            "Khoảng sáng gầm xe lên tới 191 mm vượt vỉa hè và đường ngập nước đô thị dễ dàng",
            "Mâm lốp kích thước lớn 16 inch đậm chất SUV việt dã cá tính",
            "Màn hình giải trí cảm ứng 10 inch sắc nét trung tâm khoang lái",
            "Pin LFP chống cháy nổ an toàn tuyệt đối với quãng đường di chuyển 215 km"
        ],
        "description": "Mẫu mini SUV điện quốc dân tạo cơn sốt lịch sử tại Việt Nam với thiết kế vuông vức cá tính, gầm cao 191 mm, mâm 16 inch, màn hình 10 inch và pin LFP đi 215 km.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/vinfast_vf3.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "VinFast VF 3 Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Mini SUV Thuần Điện Đô Thị Quốc Dân tối ưu lực ép không khí và khí chất thể thao đặc trưng VinFast."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Điện 1 Mô-tơ RWD, Pin LFP 18.64 kWh, Sạc nhanh DC 10-70% trong 36 phút sản sinh công suất 43 HP (32 kW), Động cơ điện cầu sau RWD cùng gia tốc 5.3s (0-50 km/h)."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/vinfast-vf3/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/vinfast-vf3/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    },
    {
        "id": "vinfast-vf9",
        "productCode": "VNF-VF9-PL",
        "name": "VinFast VF 9 Plus 7 Chỗ",
        "brand": "VinFast",
        "version": "Plus Dual-Motor AWD (Bản Kèm Pin)",
        "subtitle": "Full-Size SUV Thuần Điện Hạng Sang • Phân phối chính hãng SIGMACAR",
        "type": "new",
        "category": "SUV",
        "subCategory": "Full-Size SUV Thuần Điện Hạng Sang",
        "fuel": "ev",
        "price": 2169000000,
        "priceFormatted": "2.169.000.000 VNĐ",
        "priceShort": "2.169 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá niêm yết chính hãng VinFast (Kèm pin: 2.169 tỷ | Thuê pin: 1.689 tỷ)",
        "badge": "Flagship SUV 7 Chỗ",
        "range": 626,
        "rangeExtendedKm": null,
        "hp": 402,
        "power": "402 HP (300 kW), 2 Mô-tơ điện kép AWD",
        "engine": "Dual-Motor Permanent Magnet Synchronous (Trước & Sau)",
        "powertrain": "Động cơ Điện kép 2 Mô-tơ AWD, Pin CATL 123 kWh thế hệ mới, Sạc nhanh DC 10-70% trong 26 phút",
        "torque": "620 Nm tức thì",
        "acceleration": "6.5s",
        "topSpeed": "200 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "drive": "AWD / Dẫn động 4 bánh toàn thời gian thông minh",
        "seats": 7,
        "dimensions": "5.118 x 2.254 x 1.696 mm",
        "wheelbase": "3.150 mm (Dài nhất trong phân khúc E-SUV)",
        "groundClearance": "189 mm (Treo khí nén nâng hạ chủ động)",
        "dimensionsDetail": {
            "overall": "5.118 x 2.254 x 1.696 mm",
            "lengthMm": 5118,
            "widthMm": 2254,
            "heightMm": 1696,
            "wheelbase": "3.150 mm",
            "groundClearance": "189 mm",
            "curbWeight": "2.830 kg"
        },
        "stock": 5,
        "excelStock": 5,
        "year": 2025,
        "warranty": "10 năm hoặc 200.000 km cho xe & 10 năm không giới hạn km cho pin",
        "warrantyDetail": {
            "policy": "10 năm hoặc 200.000 km cho xe & 10 năm không giới hạn km cho pin"
        },
        "image": "assets/vehicles/vinfast-vf9/images/exterior/images (9).jpg",
        "thumbnail": "assets/vehicles/vinfast-vf9/images/exterior/images (9).jpg",
        "cover": "assets/vehicles/vinfast-vf9/images/exterior/images (9).jpg",
        "galleryImages": [
            "assets/vehicles/vinfast-vf9/images/exterior/images (9).jpg",
            "assets/vehicles/vinfast-vf9/images/interior/images (11).jpg",
            "assets/vehicles/vinfast-vf9/images/dashboard/images (10).jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/vinfast-vf9/images/exterior/images (9).jpg"
            ],
            "interior": [
                "assets/vehicles/vinfast-vf9/images/interior/images (11).jpg"
            ],
            "dashboard": [
                "assets/vehicles/vinfast-vf9/images/dashboard/images (10).jpg"
            ],
            "engine": [],
            "specifications": [],
            "gallery": []
        },
        "colors": [
            {
                "name": "Xanh Thẫm VinFast Blue",
                "hex": "#1E3A8A",
                "img": "assets/vehicles/vinfast-vf9/images/exterior/images (9).jpg"
            },
            {
                "name": "Trắng Brahminy White",
                "hex": "#F8FAFC",
                "img": "assets/vehicles/vinfast-vf9/images/interior/images (11).jpg"
            },
            {
                "name": "Đen Jet Black",
                "hex": "#0F172A",
                "img": "assets/vehicles/vinfast-vf9/images/dashboard/images (10).jpg"
            },
            {
                "name": "Xám Xi Măng Desat Silver",
                "hex": "#94A3B8",
                "img": "assets/vehicles/vinfast-vf9/images/exterior/images (9).jpg"
            }
        ],
        "colorsSummary": "Xanh Thẫm VinFast Blue, Trắng Brahminy White, Đen Jet Black, Xám Xi Măng Desat Silver",
        "evSpecs": {
            "batteryCapacity": "123 kWh (Pin CATL Ternary Lithium thế hệ mới)",
            "rangeKm": 626,
            "fastCharge": "Sạc siêu nhanh DC 10% - 70% chỉ trong 26 phút",
            "architecture": "Kiến trúc điện áp cao Dual-Motor"
        },
        "features": [
            "Gói công nghệ hỗ trợ lái nâng cao ADAS Level 2 với tính năng tự hành trên cao tốc",
            "Hàng ghế trước và hàng ghế cơ trưởng tích hợp sưởi, thông gió và massage đa điểm",
            "Màn hình cảm ứng giải trí 15.6 inch trung tâm cùng trợ lý ảo thông minh Vivi AI",
            "Cửa sổ trời toàn cảnh Panoramic tráng lớp chắn tia UV & cách nhiệt cao cấp",
            "Hệ thống treo khí nén điện tử chủ động nâng hạ gầm êm ái như bay"
        ],
        "description": "Mẫu SUV điện cỡ lớn đầu bảng của VinFast với thiết kế Pininfarina, 402 mã lực AWD, pin CATL 123 kWh tầm hoạt động 626 km, ghế massage và trợ lý ảo Vivi thông minh.",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/vinfast_vf9.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-body",
                    "name": "VinFast VF 9 Plus 7 Chỗ Thiết kế Ngoại thất",
                    "category": "Thiết kế & Khí động học",
                    "pos": [
                        1.2,
                        0.6,
                        0.7
                    ],
                    "desc": "Kiểu dáng Full-Size SUV Thuần Điện Hạng Sang tối ưu lực ép không khí và khí chất thể thao đặc trưng VinFast."
                },
                {
                    "id": "hotspot-powertrain",
                    "name": "Hệ truyền động & Động cơ",
                    "category": "Động lực học",
                    "pos": [
                        0,
                        0.5,
                        0
                    ],
                    "desc": "Động cơ Điện kép 2 Mô-tơ AWD, Pin CATL 123 kWh thế hệ mới, Sạc nhanh DC 10-70% trong 26 phút sản sinh công suất 402 HP (300 kW), 2 Mô-tơ điện kép AWD cùng gia tốc 6.5s."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/vinfast-vf9/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/vinfast-vf9/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Đang kinh doanh"
    }
];

  const nowMs = Date.now();
  const threeDaysAgo = new Date(nowMs - 3 * 24 * 60 * 60 * 1000).toISOString();
  const fourDaysAgo = new Date(nowMs - 4 * 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString();

  dbState.orders = [
    {
      id: 'ORD-9020',
      orderNumber: 'SG-2026-9020',
      userId: 'usr_buyer_01',
      buyerName: 'Minh Hoàng',
      buyerPhone: '+84 901 234 567',
      vehicleId: 'model-e',
      vehicleName: 'SIGMA Model E',
      color: 'Trắng Ngọc Trai',
      edition: 'Bản Cao Cấp (AWD)',
      image: 'assets/garage-car-detail.jpg',
      vin: 'SGME2026VN001889',
      motorNumber: 'MTR-320KW-889',
      licensePlate: '30K - 888.99',
      invoiceNumber: 'INV-SG2026-9020',
      unitPrice: 1290000000,
      depositAmount: 50000000,
      branchId: 'hn-caugiay',
      branchName: 'Showroom SIGMACAR Cầu Giấy (Hà Nội)',
      orderStatus: ORDER_STATUS.DELIVERED,
      paymentStatus: PAYMENT_STATUS.FULLY_PAID,
      paymentMethod: 'Chuyển khoản Ngân hàng Vietcombank',
      deliveredAt: threeDaysAgo,
      history: [
        { status: ORDER_STATUS.PENDING, timestamp: '2026-10-15T09:00:00Z', updatedBy: 'usr_buyer_01' },
        { status: ORDER_STATUS.CONFIRMED, timestamp: '2026-10-15T10:00:00Z', updatedBy: 'usr_seller_01' },
        { status: ORDER_STATUS.DELIVERED, timestamp: threeDaysAgo, updatedBy: 'usr_admin_01' }
      ],
      createdAt: '2026-10-15T09:00:00Z'
    },
    {
      id: 'ORD-9021',
      orderNumber: 'SG-2026-9021',
      userId: 'usr_buyer_01',
      buyerName: 'Minh Hoàng',
      buyerPhone: '+84 901 234 567',
      vehicleId: 'vision-s',
      vehicleName: 'SIGMA Vision S',
      color: 'Xanh Dương Điện Tử',
      edition: 'Bản Thể Thao (GT)',
      image: 'assets/car-thumb-s5.jpg',
      vin: 'SGVS2026VN005412',
      motorNumber: 'MTR-450KW-412',
      invoiceNumber: 'INV-SG2026-9021',
      unitPrice: 2150000000,
      depositAmount: 50000000,
      branchId: 'hn-caugiay',
      branchName: 'Showroom SIGMACAR Cầu Giấy (Hà Nội)',
      orderStatus: ORDER_STATUS.CONFIRMED,
      paymentStatus: PAYMENT_STATUS.DEPOSIT_PAID,
      paymentMethod: 'Chuyển khoản QR Napas 24/7',
      history: [
        { status: ORDER_STATUS.PENDING, timestamp: '2026-10-20T10:00:00Z', updatedBy: 'usr_buyer_01' },
        { status: ORDER_STATUS.CONFIRMED, timestamp: '2026-10-20T10:15:00Z', updatedBy: 'usr_seller_01' }
      ],
      createdAt: '2026-10-20T10:00:00Z'
    },
    {
      id: 'ORD-9022',
      orderNumber: 'SG-2026-9022',
      userId: 'usr_buyer_02',
      buyerName: 'Nguyễn Thanh Hà',
      buyerPhone: '+84 908 888 999',
      vehicleId: 'x-series-gt',
      vehicleName: 'SIGMA X-Series GT',
      color: 'Đen Huyền Bí',
      edition: 'Bản Hiệu Suất Cao',
      image: 'assets/car-thumb-gt.jpg',
      vin: 'SGXT2026VN009901',
      motorNumber: 'MTR-507KW-901',
      licensePlate: '51K - 999.68',
      invoiceNumber: 'INV-SG2026-9022',
      unitPrice: 3150000000,
      depositAmount: 100000000,
      branchId: 'hn-caugiay',
      branchName: 'Showroom SIGMACAR Cầu Giấy (Hà Nội)',
      orderStatus: ORDER_STATUS.DELIVERED,
      paymentStatus: PAYMENT_STATUS.FULLY_PAID,
      paymentMethod: 'Chuyển khoản Ngân hàng Techcombank',
      deliveredAt: twoDaysAgo,
      history: [
        { status: ORDER_STATUS.PENDING, timestamp: '2026-10-18T08:00:00Z', updatedBy: 'usr_buyer_02' },
        { status: ORDER_STATUS.DELIVERED, timestamp: twoDaysAgo, updatedBy: 'usr_admin_01' }
      ],
      createdAt: '2026-10-18T08:00:00Z'
    },
    {
      id: 'ORD-9023',
      orderNumber: 'SG-2026-9023',
      userId: 'usr_buyer_01',
      buyerName: 'Minh Hoàng',
      buyerPhone: '+84 901 234 567',
      vehicleId: 'city-g',
      vehicleName: 'SIGMA City G',
      color: 'Bạc Ánh Kim',
      edition: 'Bản Đô Thị Thông Minh',
      image: 'assets/city-g.jpg',
      vin: 'SGCG2026VN003310',
      motorNumber: 'MTR-150KW-310',
      licensePlate: '30K - 662.18',
      invoiceNumber: 'INV-SG2026-9023',
      unitPrice: 720000000,
      depositAmount: 30000000,
      branchId: 'hn-caugiay',
      branchName: 'Showroom SIGMACAR Cầu Giấy (Hà Nội)',
      orderStatus: ORDER_STATUS.DELIVERED,
      paymentStatus: PAYMENT_STATUS.FULLY_PAID,
      paymentMethod: 'Chuyển khoản QR Napas 24/7',
      deliveredAt: fourDaysAgo,
      history: [
        { status: ORDER_STATUS.PENDING, timestamp: '2026-10-16T09:00:00Z', updatedBy: 'usr_buyer_01' },
        { status: ORDER_STATUS.DELIVERED, timestamp: fourDaysAgo, updatedBy: 'usr_admin_01' }
      ],
      createdAt: '2026-10-16T09:00:00Z'
    }
  ];

  seedExtendedData();
  if (!dbState.certifiedVehicles || dbState.certifiedVehicles.length === 0) {
    dbState.certifiedVehicles = getDefaultCertifiedVehicles();
  }
  ensureAllCollectionArrays();
  if (!dbState.meta) dbState.meta = { version: '4.0.0' };
  dbState.meta.initializedAt = new Date().toISOString();
  dbState.meta.legacyVehicleArchives = LEGACY_VEHICLE_ARCHIVES;
}

function seedExtendedData() {
  const nowMs = Date.now();
  const oneDayAgo = new Date(nowMs - 1 * 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString();

  dbState.returnRequests = [
    {
      id: 'RET-2026-1001',
      returnCode: 'RET-2026-1001',
      orderId: 'ORD-9023',
      orderNumber: 'SG-2026-9023',
      userId: 'usr_buyer_01',
      customerName: 'Minh Hoàng',
      customerPhone: '+84 901 234 567',
      vehicleId: 'city-g',
      vehicleName: 'SIGMA City G',
      vin: 'SGCG2026VN003310',
      licensePlate: '30K - 662.18',
      image: 'assets/city-g.jpg',
      requestType: 'Đổi sang mẫu xe khác (Nâng cấp dòng xe)',
      reasonId: 'exchange_model',
      reasonLabel: 'Nhu cầu đổi sang mẫu xe / phiên bản khác',
      description: 'Gia đình muốn đổi từ mẫu Hatchback đô thị SIGMA City G lên dòng SUV 7 chỗ SIGMA Grand 7 để thuận tiện đi dã ngoại cuối tuần. Xe nguyên bản 100%, chưa kích hoạt biển số định danh dài hạn.',
      actualCondition: 'Nguyên vẹn 100%, không trầy xước sơn, đầy đủ 2 chìa khóa thông minh và bộ sạc theo xe.',
      currentOdoKm: 118,
      photos: [
        { name: 'ngoai-that-city-g-truoc.jpg', url: 'assets/city-g.jpg', sizeKb: 340 },
        { name: 'noi-that-khoang-lai.jpg', url: 'assets/garage-car-detail.jpg', sizeKb: 410 }
      ],
      pickupSchedule: {
        date: '2026-11-02',
        timeSlot: '09:00 - 11:30',
        address: 'Biệt thự T8, Khu đô thị Ciputra, Tây Hồ, Hà Nội',
        carrierName: 'Đội Vận Tải Chuyên Dụng SIGMA Express (Xe sàn trượt 29H-889.01)',
        assignedStaff: 'Trần Quốc Hưng'
      },
      financials: {
        originalPaidAmount: 720000000,
        transportFee: 0,
        odoDeduction: 0,
        inspectionFee: 1500000,
        totalDeductions: 1500000,
        estimatedRefundAmount: 718500000,
        refundStatus: 'Chờ nghiệm thu xe tại xưởng'
      },
      status: RETURN_STATUS.TRUCK_CONFIRMED,
      supplementRequested: false,
      supplementNote: '',
      customerSupplements: [],
      history: [
        { status: RETURN_STATUS.PENDING_RECEIPT, note: 'Khách hàng gửi yêu cầu đổi trả trực tuyến qua Trung tâm Đổi trả 7 ngày.', updatedBy: 'Minh Hoàng', timestamp: twoDaysAgo },
        { status: RETURN_STATUS.CHECKING_CONDITIONS, note: 'Hệ thống xác nhận đơn hàng nằm trong hạn 7 ngày (ngày thứ 3 sau bàn giao) và ODO < 500 km.', updatedBy: 'Hệ thống Tự động', timestamp: twoDaysAgo },
        { status: RETURN_STATUS.APPROVED, note: 'Đã phê duyệt hồ sơ đổi trả. Đủ điều kiện hoàn/đổi theo chính sách 7 ngày.', updatedBy: 'Minh Phan (Seller)', timestamp: oneDayAgo },
        { status: RETURN_STATUS.AWAITING_SCHEDULE, note: 'Khách hàng đã chọn khung giờ thu hồi xe tại Ciputra, Tây Hồ.', updatedBy: 'Minh Hoàng', timestamp: oneDayAgo },
        { status: RETURN_STATUS.TRUCK_CONFIRMED, note: 'Đã điều phối xe tải sàn trượt chuyên dụng 29H-889.01 và kỹ thuật viên Trần Quốc Hưng.', updatedBy: 'Trần Quốc Hưng', timestamp: new Date().toISOString() }
      ],
      createdAt: twoDaysAgo,
      updatedAt: new Date().toISOString()
    },
    {
      id: 'RET-2026-1002',
      returnCode: 'RET-2026-1002',
      orderId: 'ORD-9022',
      orderNumber: 'SG-2026-9022',
      userId: 'usr_buyer_02',
      customerName: 'Nguyễn Thanh Hà',
      customerPhone: '+84 908 888 999',
      vehicleId: 'x-series-gt',
      vehicleName: 'SIGMA X-Series GT',
      vin: 'SGXT2026VN009901',
      licensePlate: '51K - 999.68',
      image: 'assets/car-thumb-gt.jpg',
      requestType: 'Hoàn tiền theo chính sách 7 ngày',
      reasonId: 'charging_inconvenience',
      reasonLabel: 'Không thuận tiện lắp đặt trụ sạc tại nhà',
      description: 'Ban quản lý hầm chung cư hiện tại chưa cấp phép đấu nối nguồn điện 3 pha cho bộ sạc công suất cao, xin hỗ trợ thu hồi xe theo chính sách 7 ngày.',
      actualCondition: 'Xe mới nguyên bản 99.9%, đỗ trong hầm có mái che, đầy đủ phụ kiện.',
      currentOdoKm: 85,
      photos: [
        { name: 'x-series-gt-ham-xe.jpg', url: 'assets/car-thumb-gt.jpg', sizeKb: 380 }
      ],
      pickupSchedule: {
        date: '2026-11-04',
        timeSlot: '14:00 - 16:30',
        address: 'Khu đô thị Phú Mỹ Hưng, Quận 7, TP.HCM',
        carrierName: 'Chờ phân công đơn vị vận chuyển',
        assignedStaff: 'Minh Phan'
      },
      financials: {
        originalPaidAmount: 3150000000,
        transportFee: 2500000,
        odoDeduction: 0,
        inspectionFee: 1500000,
        totalDeductions: 4000000,
        estimatedRefundAmount: 3146000000,
        refundStatus: 'Đang thẩm định hồ sơ'
      },
      status: RETURN_STATUS.CHECKING_CONDITIONS,
      supplementRequested: true,
      supplementNote: 'Vui lòng chụp bổ sung ảnh đồng hồ ODO trên màn hình trung tâm và biên bản bàn giao phụ kiện Wallbox.',
      customerSupplements: [],
      history: [
        { status: RETURN_STATUS.PENDING_RECEIPT, note: 'Tiếp nhận yêu cầu đổi trả trực tuyến.', updatedBy: 'Nguyễn Thanh Hà', timestamp: oneDayAgo },
        { status: RETURN_STATUS.CHECKING_CONDITIONS, note: 'Đang kiểm tra điều kiện thực tế và yêu cầu bổ sung ảnh màn hình ODO.', updatedBy: 'Minh Phan', timestamp: new Date().toISOString() }
      ],
      createdAt: oneDayAgo,
      updatedAt: new Date().toISOString()
    }
  ];

  dbState.warranties = [
    {
      id: 'WAR-2026-889',
      warrantyCode: 'EW-SIGMA-2026-889',
      orderId: 'ORD-9020',
      orderNumber: 'SG-2026-9020',
      userId: 'usr_buyer_01',
      ownerName: 'Minh Hoàng',
      ownerPhone: '+84 901 234 567',
      vehicleId: 'model-e',
      vehicleName: 'SIGMA Model E',
      edition: 'Bản Cao Cấp (AWD)',
      color: 'Trắng Ngọc Trai',
      image: 'assets/garage-car-detail.jpg',
      vin: 'SGME2026VN001889',
      motorNumber: 'MTR-320KW-889',
      licensePlate: '30K - 888.99',
      invoiceNumber: 'INV-SG2026-9020',
      purchaseDate: '2026-01-15',
      activatedAt: '2026-01-16T08:30:00Z',
      startDate: '2026-01-15',
      endDate: '2031-01-15',
      batteryEndDate: '2034-01-15',
      maxKm: 150000,
      batteryMaxKm: 160000,
      currentOdoKm: 12450,
      batteryHealthPercent: 98,
      nextMaintenanceKm: 15000,
      nextMaintenanceDate: '2026-11-15',
      maintenanceStatus: 'Đang hoạt động',
      status: WARRANTY_STATUS.ACTIVE,
      scopeSummary: 'Bảo hành toàn diện 5 năm (150.000 km) cho xe và 8 năm (160.000 km) cho hệ thống Pin cao áp.',
      verifiedBy: 'Hệ thống Xác thực VIN Tự động SIGMACAR'
    }
  ];

  dbState.serviceRecords = [
    {
      id: 'SRV-2026-02',
      warrantyId: 'WAR-2026-889',
      userId: 'usr_buyer_01',
      vehicleId: 'model-e',
      vehicleName: 'SIGMA Model E',
      vin: 'SGME2026VN001889',
      licensePlate: '30K - 888.99',
      serviceDate: '2026-08-10',
      odoKm: 10120,
      serviceType: 'Bảo dưỡng định kỳ Cấp 1 (10.000 km)',
      serviceCenterId: 'hn-mydinh',
      serviceCenterName: 'Showroom SIGMACAR Mỹ Đình (Hà Nội)',
      technicianName: 'Trần Quốc Hưng',
      itemsPerformed: [
        'Vệ sinh và kiểm tra hệ thống phanh tái sinh',
        'Thay lọc gió điều hòa kháng khuẩn HEPA',
        'Cập nhật phần mềm điều khiển trung tâm SIGMA OS v4.2 OTA',
        'Đo dung lượng và cân bằng áp suất các mô-đun Cell pin cao áp'
      ],
      partsReplaced: [
        { code: 'PT-HEPA-01', name: 'Lọc gió điều hòa HEPA AirClean chính hãng', qty: 1, unitPrice: 650000, warrantyCovered: false }
      ],
      inspectionResult: 'Hệ thống Pin đạt SoH 98.4%, động cơ điện và hệ thống treo khí nén hoạt động hoàn hảo.',
      laborCost: 200000,
      partsCost: 650000,
      totalCost: 850000,
      invoiceCode: 'HD-DV-20260810',
      status: 'Hoàn thành'
    },
    {
      id: 'SRV-2026-01',
      warrantyId: 'WAR-2026-889',
      userId: 'usr_buyer_01',
      vehicleId: 'model-e',
      vehicleName: 'SIGMA Model E',
      vin: 'SGME2026VN001889',
      licensePlate: '30K - 888.99',
      serviceDate: '2026-02-18',
      odoKm: 1050,
      serviceType: 'Kiểm tra chạy rà đầu tiên (1.000 km)',
      serviceCenterId: 'hn-caugiay',
      serviceCenterName: 'Showroom SIGMACAR Cầu Giấy (Hà Nội)',
      technicianName: 'Trần Quốc Hưng',
      itemsPerformed: [
        'Kiểm tra lực siết bu-lông khung gầm và hệ thống treo',
        'Quét chẩn đoán toàn bộ mã lỗi ECU & cảm biến ADAS',
        'Kiểm tra áp suất và cân bằng động 4 bánh xe',
        'Kiểm tra mức dung dịch giải nhiệt khối Pin cao áp'
      ],
      partsReplaced: [],
      inspectionResult: 'Đạt chuẩn xuất xưởng 100%, miễn phí hoàn toàn theo chính sách hậu mãi SIGMACAR.',
      laborCost: 0,
      partsCost: 0,
      totalCost: 0,
      invoiceCode: 'HD-DV-20260218',
      status: 'Hoàn thành'
    }
  ];

  dbState.serviceAppointments = [
    {
      id: 'SAP-2026-501',
      appointmentCode: '#APT-2026-0412',
      userId: 'usr_buyer_01',
      customerName: 'Minh Hoàng',
      phone: '+84 901 234 567',
      vehicleId: 'model-e',
      vehicleName: 'SIGMA Model E',
      vin: 'SGME2026VN001889',
      licensePlate: '30K - 888.99',
      image: 'assets/car-thumb-s5.jpg',
      serviceType: 'BẢO DƯỠNG ĐỊNH KỲ',
      serviceItems: ['Bảo dưỡng mốc 15.000 km', 'Kiểm tra hệ thống pin & phanh tái sinh', 'Cân chỉnh độ chụm bánh xe điện tử'],
      serviceCenterId: 'hn-caugiay',
      serviceCenterName: 'Xưởng Dịch Vụ SIGMACAR Cầu Giấy (Hà Nội)',
      serviceCenterAddress: 'Số 68 Xuân Thủy, Cầu Giấy, Hà Nội',
      preferredDate: '2026-11-15',
      timeSlot: '09:00 - 10:30',
      conditionNotes: 'Xe vận hành bình thường, nhờ kỹ thuật viên kiểm tra thêm áp suất lốp và cập nhật bản đồ dẫn đường mới nhất.',
      assignedTechnician: 'Trần Quốc Hưng',
      bayNumber: 'Khoang 01',
      status: APPOINTMENT_STATUS.CONFIRMED,
      reminderChannels: { email: true, push: true, sms: true },
      createdAt: '2026-10-22T09:00:00Z'
    }
  ];

  dbState.reviews = [
    {
      id: 'REV-1001',
      vehicleId: 'model-e',
      vehicleName: 'SIGMA Model E',
      userId: 'usr_buyer_01',
      authorName: 'Minh Hoàng',
      authorTier: 'Gold Member',
      orderId: 'ORD-9020',
      verifiedPurchase: true,
      rating: 5,
      criteria: {
        design: 5,
        performance: 5,
        features: 5,
        comfort: 5,
        value: 5
      },
      title: 'Chiếc SUV điện hoàn hảo cho gia đình — Vận hành êm ái và công nghệ vượt trội',
      content: 'Sau hơn 12.000 km gắn bó cùng SIGMA Model E bản Cao Cấp AWD, mình hoàn toàn hài lòng. Khả năng tăng tốc 4.5 giây cực kỳ dứt khoát nhưng khoang cabin lại yên tĩnh tuyệt đối nhờ kính cách âm 2 lớp. Sạc siêu nhanh tại trạm SIGMACAR từ 15% lên 80% chỉ mất khoảng 25 phút.',
      media: [
        { type: 'image', url: 'assets/garage-car-detail.jpg', caption: 'SIGMA Model E thực tế sau khi phủ Ceramic' }
      ],
      helpfulVoterIds: ['usr_buyer_02', 'usr_seller_01'],
      reportedBy: [],
      reportReason: '',
      moderationStatus: 'approved',
      moderationNote: '',
      createdAt: '2026-10-20T14:20:00Z',
      updatedAt: '2026-10-20T14:20:00Z'
    },
    {
      id: 'REV-1002',
      vehicleId: 'x-series-gt',
      vehicleName: 'SIGMA X-Series GT',
      userId: 'usr_buyer_02',
      authorName: 'Nguyễn Thanh Hà',
      authorTier: 'Platinum Member',
      orderId: 'ORD-9022',
      verifiedPurchase: true,
      rating: 5,
      criteria: {
        design: 5,
        performance: 5,
        features: 5,
        comfort: 4,
        value: 5
      },
      title: 'Hiệu suất 680 mã lực thực sự đáng kinh ngạc trên một mẫu Super EV',
      content: 'Thiết kế khí động học cực kỳ ấn tượng, hệ thống treo khí nén thích ứng giúp xe vào cua ở tốc độ cao rất đầm chắc. Màn hình buồng lái thông minh phản hồi tức thì.',
      media: [
        { type: 'image', url: 'assets/car-thumb-gt.jpg', caption: 'SIGMA X-Series GT bản Hiệu Suất Cao' }
      ],
      helpfulVoterIds: ['usr_buyer_01'],
      reportedBy: [],
      reportReason: '',
      moderationStatus: 'approved',
      moderationNote: '',
      createdAt: '2026-10-22T11:10:00Z',
      updatedAt: '2026-10-22T11:10:00Z'
    }
  ];

  dbState.questions = [
    {
      id: 'QNA-2001',
      vehicleId: 'model-e',
      vehicleName: 'SIGMA Model E',
      userId: 'usr_buyer_02',
      authorName: 'Nguyễn Thanh Hà',
      question: 'Khi mua SIGMA Model E có được tặng kèm bộ sạc treo tường tại nhà Wallbox 11kW không và thời gian khảo sát lắp đặt mất bao lâu?',
      status: 'approved',
      createdAt: '2026-10-21T08:30:00Z',
      answers: [
        {
          id: 'ANS-301',
          userId: 'usr_seller_01',
          authorName: 'Minh Phan (Chuyên viên Tư vấn SIGMACAR)',
          authorRole: ROLES.SELLER,
          content: 'Chào chị Thanh Hà! Khi đặt mua SIGMA Model E chính hãng, quý khách được tặng kèm bộ sạc treo tường thông minh SIGMA Wallbox 11kW trị giá 18.500.000 VNĐ. Đội ngũ kỹ thuật viên sẽ khảo sát hạ tầng điện và lắp đặt hoàn thiện tận nơi trong vòng 24–48 giờ trước ngày bàn giao xe ạ.',
          createdAt: '2026-10-21T09:15:00Z'
        },
        {
          id: 'ANS-302',
          userId: 'usr_buyer_01',
          authorName: 'Minh Hoàng (Chủ xe đã xác thực)',
          authorRole: ROLES.BUYER,
          content: 'Mình lắp ở Ciputra mất đúng 1 buổi sáng là xong, kỹ thuật viên đi dây ống gen chống cháy rất gọn và thẩm mỹ nhé!',
          createdAt: '2026-10-21T11:40:00Z'
        }
      ]
    }
  ];

  dbState.faqs = [
    {
      id: 'FAQ-01',
      category: 'Chính sách Đổi trả 7 ngày',
      question: 'Điều kiện để được áp dụng chính sách Đổi trả xe trong 7 ngày của SIGMACAR là gì?',
      answer: 'Khách hàng được quyền yêu cầu đổi sang mẫu xe khác hoặc trả xe hoàn tiền trong vòng 07 ngày kể từ ngày bàn giao xe thực tế ghi trên Biên bản bàn giao. Điều kiện áp dụng: (1) Quãng đường lăn bánh tăng thêm không quá 500 km so với lúc nhận xe; (2) Xe nguyên trạng 100%, không đâm đụng, ngập nước, trầy xước sơn hoặc can thiệp phần cứng/phần mềm; (3) Đầy đủ hóa đơn, giấy tờ gốc, 02 chìa khóa thông minh và bộ sạc đi kèm.'
    },
    {
      id: 'FAQ-02',
      category: 'Chính sách Đổi trả 7 ngày',
      question: 'Các khoản phí khấu trừ khi trả xe hoàn tiền được tính như thế nào?',
      answer: 'Trường hợp đổi trả do lỗi kỹ thuật từ nhà sản xuất (được Xưởng dịch vụ SIGMACAR xác nhận): Hoàn tiền 100% hoặc đổi xe mới miễn phí hoàn toàn. Trường hợp đổi trả theo nhu cầu cá nhân của khách hàng: Khấu trừ phí kiểm định kỹ thuật tiêu chuẩn (1.500.000 VNĐ), chi phí vận chuyển xe cứu hộ sàn trượt thực tế (nếu ngoài bán kính miễn phí 20km), và phí hao mòn nếu ODO vượt mốc 200 km (5.000 VNĐ/km).'
    },
    {
      id: 'FAQ-03',
      category: 'Bảo hành & Bảo dưỡng',
      question: 'Làm thế nào để kích hoạt Bảo hành điện tử theo số khung (VIN) sau khi nhận xe?',
      answer: 'Quý khách truy cập mục "Tài khoản -> Gara của tôi (Bảo hành & Bảo dưỡng)", chọn "Kích hoạt Bảo hành Điện tử" và nhập Mã số khung (VIN 17 ký tự), Mã động cơ điện và Mã hóa đơn/đơn hàng. Hệ thống sẽ đối chiếu tự động với cơ sở dữ liệu bàn giao chính hãng để kích hoạt ngay lập tức.'
    },
    {
      id: 'FAQ-04',
      category: 'Bảo hành & Bảo dưỡng',
      question: 'Chính sách bảo hành Pin cao áp 8 năm bao gồm những hạng mục nào?',
      answer: 'Khối Pin cao áp (HV Battery Pack) trên các dòng xe SIGMACAR được bảo hành 08 năm hoặc 160.000 km (tùy điều kiện nào đến trước). Nếu dung lượng khả dụng thực tế (State of Health - SoH) giảm xuống dưới 75% trong thời gian bảo hành, SIGMACAR cam kết bảo dưỡng cân bằng hoặc thay mới mô-đun pin miễn phí 100%.'
    },
    {
      id: 'FAQ-05',
      category: 'Hướng dẫn sử dụng xe',
      question: 'Nên sạc pin xe điện SIGMACAR như thế nào để tối ưu tuổi thọ Pin?',
      answer: 'Với nhu cầu di chuyển hàng ngày trong đô thị, quý khách nên thiết lập giới hạn sạc ở mức 80% - 90% qua màn hình trung tâm hoặc ứng dụng SIGMA Connect và ưu tiên sạc AC Wallbox tại nhà. Khi chuẩn bị đi hành trình xa liên tỉnh, quý khách có thể sạc đầy 100% và sử dụng hệ thống sạc siêu nhanh DC 180kW.'
    },
    {
      id: 'FAQ-06',
      category: 'Thanh toán & Trả góp',
      question: 'SIGMACAR hỗ trợ những phương thức đặt cọc và vay mua xe trả góp nào?',
      answer: 'Quý khách có thể đặt cọc trực tuyến qua Chuyển khoản QR Napas 24/7, Thẻ quốc tế Visa/Mastercard hoặc Ví điện tử. Về trả góp, SIGMACAR liên kết với Vietcombank, Techcombank, VPBank và Shinhan Bank hỗ trợ vay tới 80% giá trị xe trong tối đa 8 năm (96 tháng) với lãi suất ưu đãi từ 7.9%/năm.'
    },
    {
      id: 'FAQ-07',
      category: 'Vận chuyển & Giao nhận',
      question: 'Tôi có thể yêu cầu giao xe tận nhà bằng xe chuyên dụng không?',
      answer: 'Có. SIGMACAR cung cấp dịch vụ bàn giao xe tận nhà (Home Delivery) bằng xe tải sàn trượt kín chuyên dụng trên toàn quốc, kèm lễ bàn giao tiêu chuẩn VIP tại gia đình hoặc tại hệ thống Showroom 5S.'
    }
  ];

  dbState.supportTickets = [
    {
      id: 'TCK-2026-3001',
      ticketCode: 'TCK-2026-3001',
      userId: 'usr_buyer_01',
      customerName: 'Minh Hoàng',
      customerEmail: 'minhhoang.sigma@example.com',
      customerPhone: '+84 901 234 567',
      subject: 'Tư vấn nâng cấp bộ sạc nhanh 22kW tại biệt thự Ciputra',
      category: 'Bảo hành & Bảo dưỡng',
      linkedOrderId: 'ORD-9020',
      linkedVehicleName: 'SIGMA Model E (30K - 888.99)',
      priority: TICKET_PRIORITY.NORMAL,
      status: TICKET_STATUS.WAITING_CUSTOMER,
      assignedStaffId: 'usr_support_01',
      assignedStaffName: 'Nguyễn Ngọc Lan',
      department: 'Kỹ thuật Trạm sạc & Hậu mãi',
      attachments: [
        { name: 'so-do-tu-dien-gara.jpg', url: 'assets/garage-hero-card.jpg', sizeKb: 290 }
      ],
      messages: [
        {
          id: 'MSG-1',
          senderId: 'usr_buyer_01',
          senderName: 'Minh Hoàng',
          senderRole: ROLES.BUYER,
          content: 'Chào bộ phận hỗ trợ, gia đình mình vừa nâng cấp điện 3 pha tại gara biệt thự Ciputra và muốn đăng ký khảo sát nâng cấp lên bộ sạc đôi 22kW cho 2 xe điện SIGMACAR.',
          attachments: [],
          createdAt: '2026-10-24T09:00:00Z'
        },
        {
          id: 'MSG-2',
          senderId: 'usr_support_01',
          senderName: 'Nguyễn Ngọc Lan (Chuyên viên CSKH)',
          senderRole: ROLES.SUPPORT_STAFF,
          content: 'Chào anh Minh Hoàng! Em đã chuyển thông tin tới Đội Kỹ thuật Trạm sạc Cầu Giấy. Kỹ sư Trần Quốc Hưng có thể qua khảo sát trực tiếp vào 09:30 sáng Thứ Bảy tuần này được không ạ? Anh phản hồi giúp em trên luồng yêu cầu này nhé!',
          attachments: [],
          createdAt: '2026-10-24T10:15:00Z'
        }
      ],
      internalNotes: [
        {
          id: 'INOTE-101',
          authorId: 'usr_support_01',
          authorName: 'Nguyễn Ngọc Lan',
          note: 'Khách hàng hạng Gold Member sở hữu 2 xe (Model E + City G). Áp dụng miễn phí 100% công khảo sát và giảm 15% thiết bị Wallbox 22kW.',
          createdAt: '2026-10-24T10:18:00Z'
        }
      ],
      slaDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      firstRespondedAt: '2026-10-24T10:15:00Z',
      createdAt: '2026-10-24T09:00:00Z',
      updatedAt: '2026-10-24T10:15:00Z'
    },
    {
      id: 'TCK-2026-3002',
      ticketCode: 'TCK-2026-3002',
      userId: 'usr_buyer_02',
      customerName: 'Nguyễn Thanh Hà',
      customerEmail: 'thanhha.nguyen@example.com',
      customerPhone: '+84 908 888 999',
      subject: 'Hỗ trợ thủ tục bàn giao giấy tờ khi xe tải đến thu hồi xe đổi trả',
      category: 'Đổi trả',
      linkedOrderId: 'ORD-9022',
      linkedVehicleName: 'SIGMA X-Series GT (51K - 999.68)',
      priority: TICKET_PRIORITY.HIGH,
      status: TICKET_STATUS.IN_PROGRESS,
      assignedStaffId: 'usr_support_01',
      assignedStaffName: 'Nguyễn Ngọc Lan',
      department: 'Trung tâm Đổi trả 7 ngày',
      attachments: [],
      messages: [
        {
          id: 'MSG-3',
          senderId: 'usr_buyer_02',
          senderName: 'Nguyễn Thanh Hà',
          senderRole: ROLES.BUYER,
          content: 'Mình đã gửi yêu cầu đổi trả mã RET-2026-1002. Cho mình hỏi khi nhân viên đến nhận xe thì mình cần chuẩn bị sẵn những biên bản nào?',
          attachments: [],
          createdAt: '2026-10-25T08:00:00Z'
        }
      ],
      internalNotes: [
        {
          id: 'INOTE-102',
          authorId: 'usr_admin_01',
          authorName: 'Hệ Thống Quản Trị SIGMACAR',
          note: 'Đã phối hợp bộ phận Pháp chế chuẩn bị sẵn biên bản thu hồi điện tử cho khách ký số.',
          createdAt: '2026-10-25T08:30:00Z'
        }
      ],
      slaDueAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      firstRespondedAt: null,
      createdAt: '2026-10-25T08:00:00Z',
      updatedAt: '2026-10-25T08:30:00Z'
    }
  ];

  dbState.emailCampaigns = [
    {
      id: 'CMP-2026-01',
      name: 'Chiến dịch Chúc mừng Sinh nhật Thành viên Tháng 10 & 11',
      category: CAMPAIGN_CATEGORIES.BIRTHDAY,
      subject: '🎂 Chúc mừng sinh nhật {{customer_name}} — Quà tặng đặc quyền từ SIGMACAR!',
      preheader: 'Dành tặng riêng {{customer_name}} voucher 2.000.000đ và gói chăm sóc xe miễn phí nhân dịp sinh nhật.',
      promoCode: 'SIGMABDAY2026',
      discountValue: 'Giảm 20% Phụ kiện & Gói phủ Ceramic (Tối đa 2.000.000 VNĐ)',
      targetSegment: 'birthday_month',
      targetSegmentLabel: 'Khách hàng có sinh nhật trong tháng (Đã đồng ý nhận tin)',
      bannerImage: 'assets/profile-main-hero.jpg',
      bodyHtml: `<div style="font-family:'Inter',sans-serif;color:#0f172a;line-height:1.6;">
        <h2 style="color:#1d4ed8;margin-bottom:8px;">Chúc mừng sinh nhật {{customer_name}}! 🎉</h2>
        <p>Nhân dịp ngày đặc biệt của Quý khách (<strong>{{birth_date}}</strong>), đại gia đình <strong>SIGMACAR</strong> kính chúc Quý khách luôn dồi dào sức khỏe, hạnh phúc và thượng lộ bình an trên mọi hành trình xanh cùng mẫu xe <strong>{{vehicle_name}}</strong>.</p>
        <div style="background:#eff6ff;border:1px dashed #2563eb;border-radius:12px;padding:18px;margin:20px 0;text-align:center;">
          <div style="font-size:12px;text-transform:uppercase;color:#1e40af;font-weight:700;">MÃ QUÀ TẶNG ĐẶC QUYỀN SINH NHẬT</div>
          <div style="font-size:24px;font-weight:800;color:#1d4ed8;letter-spacing:2px;margin:8px 0;">{{promo_code}}</div>
          <div style="font-size:13px;color:#475569;">Tặng gói Spa khử khuẩn nội thất tiêu chuẩn Châu Âu & Giảm 20% phụ kiện chính hãng</div>
        </div>
        <p>Quý khách có thể đặt lịch sử dụng ưu đãi ngay tại mục <strong>Gara của tôi</strong> trên cổng khách hàng SIGMACAR.</p>
      </div>`,
      status: CAMPAIGN_STATUS.SCHEDULED,
      scheduledAt: '2026-11-01T08:00:00Z',
      sentAt: null,
      stats: {
        eligibleRecipients: 2,
        sentCount: 0,
        deliveredCount: 0,
        failedCount: 0
      },
      deliveryMode: 'simulated_dev_queue',
      createdBy: 'usr_admin_01',
      createdAt: '2026-10-20T09:00:00Z',
      updatedAt: '2026-10-20T09:00:00Z'
    },
    {
      id: 'CMP-2026-02',
      name: 'Chiến dịch Tết Đoàn Viên & Xuân Tri Ân Chủ Xe SIGMACAR',
      category: CAMPAIGN_CATEGORIES.TET,
      subject: '🌸 Xuân Thịnh Vượng cùng SIGMACAR — Kiểm tra an toàn Pin & Gầm miễn phí 18 hạng mục',
      preheader: 'An tâm du xuân vạn dặm cùng chương trình chăm sóc xe Tết đặc biệt dành cho {{customer_name}}.',
      promoCode: 'XUANSIGMA2026',
      discountValue: 'Miễn phí 100% kiểm tra 18 hạng mục an toàn & Tặng bao lì xì lộc xuân',
      targetSegment: 'all_opted_in',
      targetSegmentLabel: 'Tất cả khách hàng đăng ký nhận bản tin (Marketing Opt-in)',
      bannerImage: 'assets/garage-hero-card.jpg',
      bodyHtml: `<div style="font-family:'Inter',sans-serif;color:#0f172a;line-height:1.6;">
        <h2 style="color:#b91c1c;margin-bottom:8px;">Kính chúc {{customer_name}} Năm Mới An Khang & Vạn Dặm Bình An! 🌸</h2>
        <p>Để chuẩn bị cho những chuyến hành trình du xuân trọn vẹn cùng gia đình trên chiếc <strong>{{vehicle_name}}</strong>, hệ thống Xưởng dịch vụ SIGMACAR toàn quốc triển khai chương trình <strong>Chăm Sóc Xe Đón Tết</strong>.</p>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:18px;margin:20px 0;text-align:center;">
          <div style="font-size:12px;text-transform:uppercase;color:#991b1b;font-weight:700;">MÃ ƯU ĐÃI DỊCH VỤ MÙA TẾT</div>
          <div style="font-size:24px;font-weight:800;color:#dc2626;letter-spacing:2px;margin:8px 0;">{{promo_code}}</div>
          <div style="font-size:13px;color:#475569;">Kiểm tra miễn phí hệ thống Pin cao áp, Phanh tái sinh, Lốp và Cập nhật phần mềm đón Xuân</div>
        </div>
      </div>`,
      status: CAMPAIGN_STATUS.SENT,
      scheduledAt: '2026-01-20T07:30:00Z',
      sentAt: '2026-01-20T07:30:15Z',
      stats: {
        eligibleRecipients: 2,
        sentCount: 2,
        deliveredCount: 2,
        failedCount: 0
      },
      deliveryMode: 'simulated_dev_queue',
      createdBy: 'usr_admin_01',
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-20T07:30:15Z'
    },
    {
      id: 'CMP-2026-03',
      name: 'Email Tự động: Nhắc lịch Bảo dưỡng Định kỳ 15.000 km',
      category: CAMPAIGN_CATEGORIES.MAINTENANCE_REMINDER,
      subject: '🔧 Nhắc lịch bảo dưỡng định kỳ cho xe {{vehicle_name}} của {{customer_name}}',
      preheader: 'Xe {{vehicle_name}} của Quý khách sắp đạt mốc bảo dưỡng định kỳ để duy trì hiệu suất Pin tối ưu.',
      promoCode: 'CARE15000KM',
      discountValue: 'Ưu đãi 15% chi phí vật tư tiêu hao khi đặt lịch trực tuyến trước 48 giờ',
      targetSegment: 'owners',
      targetSegmentLabel: 'Chủ sở hữu xe đã kích hoạt bảo hành điện tử',
      bannerImage: 'assets/appointments-card-banner.jpg',
      bodyHtml: `<div style="font-family:'Inter',sans-serif;color:#0f172a;line-height:1.6;">
        <h2 style="color:#0f172a;margin-bottom:8px;">Xin chào {{customer_name}}, đã đến lúc chăm sóc chiếc {{vehicle_name}} của bạn! ⚡</h2>
        <p>Hệ thống Quản lý Bảo dưỡng Số SIGMACAR ghi nhận chiếc <strong>{{vehicle_name}}</strong> của Quý khách sắp đến kỳ bảo dưỡng định kỳ tiếp theo.</p>
        <p>Việc kiểm tra định kỳ đúng hạn giúp duy trì hiệu suất khối Pin cao áp và đảm bảo trọn vẹn quyền lợi Bảo hành 8 năm chính hãng.</p>
        <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:12px;padding:16px;margin:16px 0;">
          <strong>Mã ưu đãi đặt lịch sớm:</strong> <span style="color:#2563eb;font-weight:700;">{{promo_code}}</span> (Giảm 15% lọc gió HEPA & dung dịch làm mát)
        </div>
      </div>`,
      status: CAMPAIGN_STATUS.DRAFT,
      scheduledAt: null,
      sentAt: null,
      stats: {
        eligibleRecipients: 2,
        sentCount: 0,
        deliveredCount: 0,
        failedCount: 0
      },
      deliveryMode: 'simulated_dev_queue',
      createdBy: 'usr_admin_01',
      createdAt: '2026-10-23T14:00:00Z',
      updatedAt: '2026-10-23T14:00:00Z'
    }
  ];

  dbState.auditLogs = [
    {
      id: 'AUD-1001',
      action: 'WARRANTY_ACTIVATED',
      actorId: 'usr_buyer_01',
      actorName: 'Minh Hoàng',
      targetId: 'WAR-2026-889',
      detail: 'Kích hoạt bảo hành điện tử thành công cho VIN SGME2026VN001889 (Đơn hàng ORD-9020).',
      timestamp: '2026-01-16T08:30:00Z'
    }
  ];
}

function getDefaultCertifiedVehicles() {
  return [
    {
      id: "cpo-1",
      name: "SIGMA Model E Premium",
      year: 2023,
      vin: "VIN: 89J921K",
      odo: "12.500 km",
      odoNum: 12500,
      price: 1050000000,
      priceFormatted: "1.050.000.000 đ",
      batteryHealth: "96%",
      color: "Trắng / Nội thất Đen",
      inspection: "176+ Điểm kiểm định",
      warranty: "Gia hạn 12 tháng / 20.000 km",
      category: "SUV",
      image: "assets/car-used-1.jpg",
      badge: "Certified Pre-Owned",
      status: "Sẵn sàng bàn giao",
      stock: 1,
      condition: "certified",
      type: "certified"
    },
    {
      id: "cpo-2",
      name: "SIGMA Vision S Executive",
      year: 2022,
      vin: "VIN: 45A772Q",
      odo: "24.000 km",
      odoNum: 24000,
      price: 1680000000,
      priceFormatted: "1.680.000.000 đ",
      batteryHealth: "94%",
      color: "Xanh Sapphire / Nội thất Kem",
      inspection: "176+ Điểm kiểm định",
      warranty: "Gia hạn 12 tháng / 20.000 km",
      category: "Sedan",
      image: "assets/car-used-2.jpg",
      badge: "Certified Pre-Owned",
      status: "Sẵn sàng bàn giao",
      stock: 1,
      condition: "certified",
      type: "certified"
    },
    {
      id: "cpo-3",
      name: "SIGMA City G Smart",
      year: 2024,
      vin: "VIN: 12K551X",
      odo: "3.500 km",
      odoNum: 3500,
      price: 720000000,
      priceFormatted: "720.000.000 đ",
      batteryHealth: "99%",
      color: "Bạc Ánh Kim / Nội thất Xám",
      inspection: "176+ Điểm kiểm định",
      warranty: "Gia hạn 24 tháng / 40.000 km",
      category: "Compact",
      image: "assets/car-used-3.jpg",
      badge: "Certified Siêu Lướt",
      status: "Sẵn sàng bàn giao",
      stock: 1,
      condition: "certified",
      type: "certified"
    },
    {
      id: "cpo-4",
      name: "SIGMA Model E Luxury",
      year: 2022,
      vin: "VIN: 77D443M",
      odo: "18.200 km",
      odoNum: 18200,
      price: 1120000000,
      priceFormatted: "1.120.000.000 đ",
      batteryHealth: "95%",
      color: "Đen Phantom / Nội thất Da bò",
      inspection: "176+ Điểm kiểm định",
      warranty: "Gia hạn 12 tháng / 20.000 km",
      category: "SUV",
      image: "assets/car-certified-2.jpg",
      badge: "Certified Pre-Owned",
      status: "Sẵn sàng bàn giao",
      stock: 1,
      condition: "certified",
      type: "certified"
    },
    {
      id: "cpo-5",
      name: "SIGMA E-Vision Premium Special",
      year: 2023,
      vin: "VIN: 98P112A",
      odo: "8.900 km",
      odoNum: 8900,
      price: 1180000000,
      priceFormatted: "1.180.000.000 đ",
      batteryHealth: "98%",
      color: "Đỏ Ruby / Nội thất Đen Nappa",
      inspection: "176+ Điểm kiểm định",
      warranty: "Gia hạn 18 tháng / 30.000 km",
      category: "SUV",
      image: "assets/car-certified-1.jpg",
      badge: "Certified Pre-Owned",
      status: "Sẵn sàng bàn giao",
      stock: 1,
      condition: "certified",
      type: "certified"
    }
  ];
}

function parseBatteryKwh(v) {
  if (Number.isFinite(v.batteryKwh)) return v.batteryKwh;
  const raw = v.evSpecs?.batteryCapacity || v.battery || '';
  const m = String(raw).match(/(\d+(?:\.\d+)?)\s*kwh/i);
  return m ? parseFloat(m[1]) : null;
}

function distributeBranchStock(totalStock, isCertified, preferredBranchId) {
  const safeTotal = Math.max(0, Number.isInteger(totalStock) ? totalStock : 0);
  if (isCertified) {
    const targetBranch = preferredBranchId || 'hn-caugiay';
    return SHOWROOM_BRANCHES.map(b => ({
      branchId: b.id,
      stockOnHand: b.id === targetBranch ? Math.min(1, safeTotal) : 0
    }));
  }
  const primary = safeTotal <= 1 ? safeTotal : Math.ceil(safeTotal * 0.6);
  const rem = Math.max(0, safeTotal - primary);
  const hcm = rem <= 1 ? rem : Math.ceil(rem * 0.5);
  const dn = Math.max(0, rem - hcm);
  return SHOWROOM_BRANCHES.map(b => {
    let qty = 0;
    if (b.id === 'hn-caugiay') qty = primary;
    else if (b.id === 'hcm-q7') qty = hcm;
    else if (b.id === 'dn-haichau') qty = dn;
    return { branchId: b.id, stockOnHand: qty };
  });
}

function ensureExtendedCollections() {
  ensureAllCollectionArrays();
  if (!dbState.meta.legacyVehicleArchives) {
    dbState.meta.legacyVehicleArchives = LEGACY_VEHICLE_ARCHIVES;
  }
  const nowIso = new Date().toISOString();

  // Backfill normalized numeric batteryKwh ONLY when explicitly present in source specs
  for (const v of dbState.vehicles) {
    if (v.batteryKwh === undefined) {
      const parsed = parseBatteryKwh(v);
      if (parsed !== null) v.batteryKwh = parsed;
    }
  }

  // Ensure per-branch inventory ledger exists for every vehicle & CPO unit without overwriting live stock
  const allCatalog = [
    ...dbState.vehicles.map(v => ({ item: v, isCertified: false })),
    ...dbState.certifiedVehicles.map(v => ({ item: v, isCertified: true }))
  ];
  for (const { item, isCertified } of allCatalog) {
    if (!item || !item.id) continue;
    const hasBranchRows = dbState.branchInventory.some(row => row.vehicleId === item.id);
    if (!hasBranchRows) {
      const initialStock = Number.isInteger(item.stock) ? item.stock : (isCertified ? 1 : 5);
      const dist = distributeBranchStock(initialStock, isCertified, item.branchId);
      for (const slot of dist) {
        dbState.branchInventory.push({
          id: `inv_${item.id}_${slot.branchId}`,
          vehicleId: item.id,
          branchId: slot.branchId,
          stockOnHand: slot.stockOnHand,
          reservedQty: 0,
          version: 1,
          updatedAt: nowIso
        });
      }
    }
  }

  // Seed default active promotions idempotently when empty
  if (dbState.accessories.length === 0) {
    try {
      const { SIGMA_DATA } = require('../../js/data');
      if (SIGMA_DATA && Array.isArray(SIGMA_DATA.accessories)) {
        dbState.accessories.push(...SIGMA_DATA.accessories.map(a => ({ ...a, compatibility: a.compatibility || ['all'] })));
      }
    } catch (e) {}
  }

  if (dbState.promotions.length === 0) {
    dbState.promotions.push(
      {
        id: 'promo_sigma50',
        code: 'SIGMA50',
        name: 'Ưu đãi đặt cọc Tiên phong 50 triệu VNĐ',
        discountType: 'fixed',
        discountValue: 50000000,
        maxDiscountAmount: 50000000,
        minOrderValue: 1000000000,
        usageLimit: 100,
        usedCount: 0,
        startsAt: '2025-01-01T00:00:00.000Z',
        expiresAt: '2028-12-31T23:59:59.000Z',
        isActive: true,
        createdAt: nowIso
      },
      {
        id: 'promo_evgreen5',
        code: 'EVGREEN5',
        name: 'Ưu đãi Xe Thuần Điện 5% (tối đa 30 triệu VNĐ)',
        discountType: 'percent',
        discountValue: 5,
        maxDiscountAmount: 30000000,
        fuelRestriction: 'ev',
        minOrderValue: 300000000,
        usageLimit: 200,
        usedCount: 0,
        startsAt: '2025-01-01T00:00:00.000Z',
        expiresAt: '2028-12-31T23:59:59.000Z',
        isActive: true,
        createdAt: nowIso
      },
      {
        id: 'promo_tet2026',
        code: 'TET2026',
        name: 'Voucher Tri Ân Chủ xe 10 triệu VNĐ',
        discountType: 'fixed',
        discountValue: 10000000,
        maxDiscountAmount: 10000000,
        minOrderValue: 200000000,
        usageLimit: 500,
        usedCount: 0,
        startsAt: '2025-01-01T00:00:00.000Z',
        expiresAt: '2028-12-31T23:59:59.000Z',
        isActive: true,
        createdAt: nowIso
      }
    );
  }

  // Ensure policy versions exist
  if (dbState.policyVersions.length === 0) {
    dbState.policyVersions.push(
      { id: 'pol_order_2026_1', type: 'order_terms', version: '2026.1', title: 'Điều khoản Đặt cọc & Mua bán xe SIGMACAR v2026.1', effectiveFrom: '2026-01-01T00:00:00.000Z', isActive: true },
      { id: 'pol_return_2026_1', type: 'return_7d', version: '2026.1', title: 'Chính sách Đổi trả 7 ngày & Hoàn tiền SIGMACAR v2026.1', effectiveFrom: '2026-01-01T00:00:00.000Z', isActive: true }
    );
  }

  // Ensure existing seeded sellers loaded from older store snapshots carry deterministic branch scope & sessionVersion
  for (const user of dbState.users) {
    if (!Number.isInteger(user.sessionVersion) || user.sessionVersion < 1) {
      user.sessionVersion = 1;
    }
    if (user.id === 'usr_seller_01' && !user.branchId && (!Array.isArray(user.branchIds) || user.branchIds.length === 0)) {
      user.branchId = 'hn-caugiay';
      user.branchIds = ['hn-caugiay'];
      user.branchName = 'Showroom SIGMACAR Cầu Giấy (Hà Nội)';
    }
  }
}

// Transaction execution wrapper ensuring atomic all-or-nothing mutations
async function runInTransaction(action) {
  await acquireLock();
  // Deep clone snapshot for rollback capability
  const snapshot = JSON.stringify(dbState);
  try {
    const result = await action(dbState);
    saveToDisk();
    return result;
  } catch (error) {
    // Rollback to prior snapshot
    setDbState(JSON.parse(snapshot));
    throw error;
  } finally {
    releaseLock();
  }
}

// Initialize on module load unless explicitly disabled
if (process.env.SIGMACAR_LAZY_INIT !== 'true') {
  loadFromDisk();
}

module.exports = {
  dbState,
  ALL_COLLECTIONS,
  CORE_COLLECTIONS,
  EXTENDED_COLLECTIONS,
  runInTransaction,
  saveToDisk,
  seedInitialData,
  reload: loadFromDisk,
  configureStorage,
  getStorageConfig,
  resetToEmpty,
  setDbState,
  getDefaultCertifiedVehicles
};
