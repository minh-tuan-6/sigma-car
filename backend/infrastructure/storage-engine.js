// backend/infrastructure/storage-engine.js
// Database-Independent Storage Engine & Atomic Transaction Manager for SIGMACAR

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROLES, ORDER_STATUS, PAYMENT_STATUS, APPOINTMENT_STATUS, TICKET_STATUS, TICKET_PRIORITY, RETURN_STATUS, WARRANTY_STATUS, CAMPAIGN_CATEGORIES, CAMPAIGN_STATUS } = require('../domain/constants');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'sigmacar_store.json');

// In-Memory Database Structure with stable reference
const dbState = {
  users: [],
  vehicles: [],
  certifiedVehicles: [],
  orders: [],
  appointments: [],
  returnRequests: [],
  warranties: [],
  serviceRecords: [],
  serviceAppointments: [],
  reviews: [],
  questions: [],
  supportTickets: [],
  faqs: [],
  emailCampaigns: [],
  auditLogs: [],
  meta: {
    initializedAt: null,
    lastSavedAt: null
  }
};

function setDbState(newState) {
  Object.keys(dbState).forEach(k => delete dbState[k]);
  Object.assign(dbState, newState);
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

// Persistent Storage Management
function loadFromDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      setDbState(JSON.parse(raw));
      ensureExtendedCollections();
    } else {
      seedInitialData();
      saveToDisk();
    }
  } catch (err) {
    console.error('Error loading data from disk, initializing seed data:', err.message);
    seedInitialData();
  }
}

function saveToDisk() {
  try {
    if (!dbState.meta) dbState.meta = {};
    dbState.meta.lastSavedAt = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(dbState, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save database state to disk:', err.message);
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
      passwordHash: `${defaultSalt}:${adminKey}`,
      createdAt: new Date().toISOString()
    }
  ];

  dbState.vehicles = [
    {
        "id": "toyota-camry",
        "name": "Toyota Camry 2.5Q",
        "brand": "Toyota",
        "subtitle": "Sedan Hạng D Doanh Nhân Đẳng Cấp",
        "type": "new",
        "category": "Sedan",
        "fuel": "gas",
        "price": 1405000000,
        "priceFormatted": "1.405.000.000 VNĐ",
        "priceShort": "1.405 tỷ",
        "badge": "Bán chạy Hạng D",
        "power": "2.5L 4 cylinder, 207 hp, Hộp số Tự động 8 cấp",
        "hp": 207,
        "torque": "250 Nm",
        "acceleration": "7.9s",
        "seats": 5,
        "topSpeed": "215 km/h",
        "transmission": "Tự động 8 cấp (8-AT)",
        "powertrain": "2.5L Xăng 4 xi-lanh DOHC Dual VVT-i",
        "drive": "FWD / Cầu trước",
        "dimensions": "4.885 x 1.840 x 1.445 mm",
        "wheelbase": "2.825 mm",
        "groundClearance": "140 mm",
        "image": "assets/catalog/car-camry.jpg",
        "stock": 5,
        "year": 2023,
        "warranty": "3 năm hoặc 100.000 km",
        "colors": [
            {
                "name": "Trắng Ngọc Trai",
                "hex": "#F8FAFC",
                "img": "assets/catalog/car-camry.jpg"
            },
            {
                "name": "Đen Ánh Kim",
                "hex": "#0F172A",
                "img": "assets/catalog/car-camry.jpg"
            },
            {
                "name": "Đỏ Mận",
                "hex": "#991B1B",
                "img": "assets/catalog/car-camry.jpg"
            }
        ],
        "features": [
            "Gói an toàn chủ động Toyota Safety Sense 2.0 (TSS 2)",
            "Hàng ghế thứ 2 ngả lưng điện với bảng điều khiển cảm ứng",
            "Màn hình cảm ứng 9 inch tích hợp Apple CarPlay & Android Auto",
            "Dàn âm thanh cao cấp 9 loa JBL mang đến không gian hòa nhạc",
            "Cửa sổ trời chỉnh điện chống kẹt và rèm che nắng kính sau chỉnh điện"
        ],
        "description": "Mẫu sedan hạng D biểu tượng cho sự thành đạt, đẳng cấp doanh nhân với khả năng vận hành êm ái, bền bỉ và giữ giá hàng đầu tại thị trường Việt Nam.",
        "productCode": "CAR-001",
        "subCategory": "Sedan",
        "colorsSummary": "Trắng, Đen, Đỏ",
        "excelSpecs": "2.5L 4 cylinder, 207 hp, Hộp số Tự động 8 cấp",
        "excelStock": 5,
        "isDataXe": true,
        "isAvailable": true
    },
    {
        "id": "honda-crv",
        "name": "Honda CR-V L AWD",
        "brand": "Honda",
        "subtitle": "Crossover/SUV 7 Chỗ Gia Đình Hiện Đại",
        "type": "new",
        "category": "SUV",
        "fuel": "gas",
        "price": 1310000000,
        "priceFormatted": "1.310.000.000 VNĐ",
        "priceShort": "1.310 tỷ",
        "badge": "AWD 7 Chỗ",
        "power": "1.5L Turbo, 188 hp, Hộp số CVT, Dẫn động AWD",
        "hp": 188,
        "torque": "240 Nm",
        "acceleration": "8.5s",
        "seats": 7,
        "topSpeed": "200 km/h",
        "transmission": "Tự động vô cấp CVT công nghệ Earth Dreams",
        "powertrain": "1.5L DOHC VTEC Turbo tăng áp",
        "drive": "AWD / Dẫn động 4 bánh toàn thời gian",
        "dimensions": "4.691 x 1.866 x 1.681 mm",
        "wheelbase": "2.700 mm",
        "groundClearance": "198 mm",
        "image": "assets/catalog/car-crv.jpg",
        "stock": 8,
        "year": 2024,
        "warranty": "3 năm hoặc 100.000 km",
        "colors": [
            {
                "name": "Đen Ánh Độc Tôn",
                "hex": "#0B0F19",
                "img": "assets/catalog/car-crv.jpg"
            },
            {
                "name": "Trắng Ngọc",
                "hex": "#F8FAFC",
                "img": "assets/catalog/car-crv.jpg"
            },
            {
                "name": "Xám Phong Cách",
                "hex": "#64748B",
                "img": "assets/catalog/car-crv.jpg"
            }
        ],
        "features": [
            "Hệ thống công nghệ hỗ trợ lái xe an toàn tiên tiến Honda SENSING",
            "Hệ dẫn động 4 bánh toàn thời gian Real-time AWD thông minh",
            "Cửa sổ trời toàn cảnh Panorama đóng mở điện",
            "Hệ thống kết nối viễn thông Honda CONNECT",
            "Cốp chỉnh điện mở rảnh tay với tính năng đóng tự động khi rời chìa khóa"
        ],
        "description": "Chiếc Crossover 7 chỗ được yêu thích hàng đầu, mang đến cảm giác lái thể thao đầy cảm xúc, không gian rộng rãi linh hoạt và sự an toàn tối ưu.",
        "productCode": "CAR-002",
        "subCategory": "Crossover/SUV",
        "colorsSummary": "Đen, Trắng, Xám",
        "excelSpecs": "1.5L Turbo, 188 hp, Hộp số CVT, Dẫn động AWD",
        "excelStock": 8,
        "isDataXe": true,
        "isAvailable": true
    },
    {
        "id": "ford-ranger",
        "name": "Ford Ranger Wildtrak 2.0L Bi-Turbo",
        "brand": "Ford",
        "subtitle": "Vua Bán Tải Đa Năng 4x4 Thế Hệ Mới",
        "type": "new",
        "category": "SUV",
        "fuel": "gas",
        "price": 979000000,
        "priceFormatted": "979.000.000 VNĐ",
        "priceShort": "979 triệu",
        "badge": "Bi-Turbo 4x4",
        "power": "2.0L Bi-Turbo Diesel, 210 hp, Hộp số Tự động 10 cấp, 4x4",
        "hp": 210,
        "torque": "500 Nm",
        "acceleration": "9.2s",
        "seats": 5,
        "topSpeed": "180 km/h",
        "transmission": "Tự động 10 cấp điện tử (10-AT)",
        "powertrain": "2.0L i4 Bi-Turbo Diesel",
        "drive": "4x4 Hai cầu bán thời gian có gài cầu điện tử",
        "dimensions": "5.362 x 1.918 x 1.875 mm",
        "wheelbase": "3.270 mm",
        "groundClearance": "235 mm",
        "image": "assets/catalog/car-ranger.jpg",
        "stock": 4,
        "year": 2023,
        "warranty": "3 năm hoặc 100.000 km",
        "colors": [
            {
                "name": "Cam Luxe Wildtrak",
                "hex": "#EA580C",
                "img": "assets/catalog/car-ranger.jpg"
            },
            {
                "name": "Đen Kim Loại",
                "hex": "#000000",
                "img": "assets/catalog/car-ranger.jpg"
            },
            {
                "name": "Trắng Tuyết",
                "hex": "#FFFFFF",
                "img": "assets/catalog/car-ranger.jpg"
            },
            {
                "name": "Xám Meteor",
                "hex": "#475569",
                "img": "assets/catalog/car-ranger.jpg"
            }
        ],
        "features": [
            "Hệ thống kiểm soát đường địa hình với 6 chế độ lái Drive Modes",
            "Màn hình cảm ứng trung tâm đặt dọc 12 inch chạy hệ điều hành SYNC 4A",
            "Camera 360 độ góc nhìn chim bay hỗ trợ quan sát điểm mù",
            "Đèn pha LED Matrix thông minh tự động chống chói",
            "Bậc bước chân thùng hàng tiện lợi và ổ cắm điện 230V/400W"
        ],
        "description": "Biểu tượng bán tải số một Việt Nam, dẫn đầu phân khúc với động cơ Bi-Turbo uy lực 500Nm, khả năng off-road vô đối và tiện nghi nội thất như xe sang.",
        "productCode": "CAR-003",
        "subCategory": "Bán tải",
        "colorsSummary": "Cam, Đen, Trắng, Xám",
        "excelSpecs": "2.0L Bi-Turbo Diesel, 210 hp, Hộp số Tự động 10 cấp, 4x4",
        "excelStock": 4,
        "isDataXe": true,
        "isAvailable": true
    },
    {
        "id": "hyundai-tucson",
        "name": "Hyundai Tucson 2.0L Đặc Biệt",
        "brand": "Hyundai",
        "subtitle": "Crossover Đô Thị Thiết Kế Parametric Táo Bạo",
        "type": "new",
        "category": "SUV",
        "fuel": "gas",
        "price": 839000000,
        "priceFormatted": "839.000.000 VNĐ",
        "priceShort": "839 triệu",
        "badge": "Đặc Biệt",
        "power": "2.0L MPI, 156 hp, Hộp số Tự động 6 cấp, FWD",
        "hp": 156,
        "torque": "192 Nm",
        "acceleration": "9.5s",
        "seats": 5,
        "topSpeed": "190 km/h",
        "transmission": "Tự động 6 cấp (6-AT)",
        "powertrain": "Smartstream G2.0 MPI",
        "drive": "FWD / Cầu trước",
        "dimensions": "4.630 x 1.865 x 1.695 mm",
        "wheelbase": "2.755 mm",
        "groundClearance": "181 mm",
        "image": "assets/catalog/car-tucson.jpg",
        "stock": 10,
        "year": 2024,
        "warranty": "5 năm hoặc 100.000 km",
        "colors": [
            {
                "name": "Đỏ Đô",
                "hex": "#B91C1C",
                "img": "assets/catalog/car-tucson.jpg"
            },
            {
                "name": "Trắng",
                "hex": "#FFFFFF",
                "img": "assets/catalog/car-tucson.jpg"
            },
            {
                "name": "Đen",
                "hex": "#0F172A",
                "img": "assets/catalog/car-tucson.jpg"
            },
            {
                "name": "Xanh Dương",
                "hex": "#1D4ED8",
                "img": "assets/catalog/car-tucson.jpg"
            }
        ],
        "features": [
            "Gói công nghệ an toàn chủ động cao cấp Hyundai Smartsense",
            "Cụm màn hình kép 10.25 inch cảm ứng đa điểm sắc nét",
            "Hệ thống đèn định vị ẩn Parametric Jewel Hidden Lights độc đáo",
            "Cần số điện tử dạng nút bấm Shift-by-Wire sang trọng",
            "Hệ thống sưởi & làm mát cho hàng ghế trước"
        ],
        "description": "Chiếc SUV cỡ C lột xác hoàn toàn với phong cách thiết kế tương lai, khoang nội thất rộng rãi và trải nghiệm công nghệ số hóa tiên phong.",
        "productCode": "CAR-004",
        "subCategory": "Crossover/SUV",
        "colorsSummary": "Đỏ, Trắng, Đen, Xanh",
        "excelSpecs": "2.0L MPI, 156 hp, Hộp số Tự động 6 cấp, FWD",
        "excelStock": 10,
        "isDataXe": true,
        "isAvailable": true
    },
    {
        "id": "mazda-cx5",
        "name": "Mazda CX-5 2.0L Premium",
        "brand": "Mazda",
        "subtitle": "Crossover Đẳng Cấp Thiết Kế KODO & Soul Red",
        "type": "new",
        "category": "SUV",
        "fuel": "gas",
        "price": 829000000,
        "priceFormatted": "829.000.000 VNĐ",
        "priceShort": "829 triệu",
        "badge": "Bán chạy #1 C-SUV",
        "power": "SkyActiv-G 2.0L, 154 hp, Hộp số Tự động 6 cấp",
        "hp": 154,
        "torque": "200 Nm",
        "acceleration": "9.6s",
        "seats": 5,
        "topSpeed": "195 km/h",
        "transmission": "Tự động 6 cấp SkyActiv-Drive",
        "powertrain": "SkyActiv-G 2.0L DOHC 16 van",
        "drive": "FWD / Cầu trước",
        "dimensions": "4.590 x 1.845 x 1.680 mm",
        "wheelbase": "2.700 mm",
        "groundClearance": "200 mm",
        "image": "assets/catalog/car-cx5.jpg",
        "stock": 12,
        "year": 2023,
        "warranty": "3 năm hoặc 100.000 km",
        "colors": [
            {
                "name": "Đỏ Soul Red Crystal",
                "hex": "#991B1B",
                "img": "assets/catalog/car-cx5.jpg"
            },
            {
                "name": "Trắng Snowflake",
                "hex": "#F8FAFC",
                "img": "assets/catalog/car-cx5.jpg"
            },
            {
                "name": "Xám Machine Grey",
                "hex": "#475569",
                "img": "assets/catalog/car-cx5.jpg"
            },
            {
                "name": "Đen Jet Black",
                "hex": "#000000",
                "img": "assets/catalog/car-cx5.jpg"
            }
        ],
        "features": [
            "Gói công nghệ hỗ trợ an toàn chủ động i-Activsense",
            "Hệ thống kiểm soát gia tốc nâng cao G-Vectoring Control Plus",
            "Hệ thống âm thanh vòm 10 loa Bose đẳng cấp rạp hát",
            "Ghế bọc da cao cấp chỉnh điện 10 hướng có bộ nhớ vị trí",
            "Cốp sau đóng mở điện thông minh chống kẹt"
        ],
        "description": "Chiếc Crossover bán chạy nhất phân khúc tại Việt Nam, ghi dấu ấn bởi chất sơn bóng bẩy Soul Red, khả năng cách âm vượt trội và độ bền đáng kinh ngạc.",
        "productCode": "CAR-005",
        "subCategory": "Crossover/SUV",
        "colorsSummary": "Đỏ Soul Red, Trắng, Xám, Đen",
        "excelSpecs": "SkyActiv-G 2.0L, 154 hp, Hộp số Tự động 6 cấp",
        "excelStock": 12,
        "isDataXe": true,
        "isAvailable": true
    },
    {
        "id": "vinfast-vf8",
        "name": "VinFast VF 8 Plus",
        "brand": "VinFast",
        "subtitle": "SUV Thuần Điện Thông Minh Cỡ D Toàn Cầu",
        "type": "new",
        "category": "SUV",
        "fuel": "ev",
        "price": 1270000000,
        "priceFormatted": "1.270.000.000 VNĐ",
        "priceShort": "1.270 tỷ",
        "badge": "EV Toàn Cầu",
        "range": 475,
        "power": "Động cơ Điện kép, 300 kW (402 HP), Mô-men xoắn 620 Nm, AWD",
        "hp": 402,
        "torque": "620 Nm",
        "acceleration": "5.5s",
        "seats": 5,
        "battery": "87.7 kWh",
        "fastCharge": "24 phút (10-70%)",
        "topSpeed": "200 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Động cơ Điện kép Dual Motor AWD",
        "drive": "AWD / 2 cầu điện độc lập",
        "dimensions": "4.750 x 1.934 x 1.667 mm",
        "wheelbase": "2.950 mm",
        "groundClearance": "175 mm",
        "image": "assets/catalog/car-vf8.jpg",
        "stock": 6,
        "year": 2024,
        "warranty": "10 năm hoặc 200.000 km",
        "colors": [
            {
                "name": "Xanh VinFast Deep Ocean",
                "hex": "#0369A1",
                "img": "assets/catalog/car-vf8.jpg"
            },
            {
                "name": "Trắng Brahminy White",
                "hex": "#FFFFFF",
                "img": "assets/catalog/car-vf8.jpg"
            },
            {
                "name": "Bạc Desat Silver",
                "hex": "#94A3B8",
                "img": "assets/catalog/car-vf8.jpg"
            },
            {
                "name": "Đen Crimson Black",
                "hex": "#0F172A",
                "img": "assets/catalog/car-vf8.jpg"
            }
        ],
        "features": [
            "Trợ lý ảo tiếng Việt ViVi tương tác giọng nói tự nhiên thông minh",
            "Gói hỗ trợ người lái nâng cao ADAS Cấp độ 2 với 11 tính năng",
            "Màn hình cảm ứng giải trí trung tâm 15.6 inch độ nét cao",
            "Màn hình hiển thị trên kính chắn gió HUD đa thông tin",
            "Chính sách bảo hành xe 10 năm hoặc 200.000 km dẫn đầu thị trường"
        ],
        "description": "Mẫu SUV điện cỡ D chuẩn quốc tế do Pininfarina thiết kế, công suất 402 HP mạnh mẽ, trang bị công nghệ thông minh và chi phí vận hành siêu kinh tế.",
        "productCode": "CAR-006",
        "subCategory": "SUV Điện",
        "colorsSummary": "Xanh VinFast, Trắng, Bạc, Đen",
        "excelSpecs": "Động cơ Điện kép, 402 hp, Quãng đường ~400km/lần sạc, AWD",
        "excelStock": 6,
        "isDataXe": true,
        "isAvailable": true
    },
    {
        "id": "mercedes-glc300",
        "name": "Mercedes-Benz GLC 300 4MATIC",
        "brand": "Mercedes-Benz",
        "subtitle": "SUV Hạng Sang Đỉnh Cao Công Nghệ Đức",
        "type": "new",
        "category": "SUV",
        "fuel": "gas",
        "price": 2799000000,
        "priceFormatted": "2.799.000.000 VNĐ",
        "priceShort": "2.799 tỷ",
        "badge": "4MATIC Hạng sang",
        "power": "2.0L Turbo Mild-Hybrid, 258 hp, Hộp số 9G-TRONIC, AWD",
        "hp": 258,
        "torque": "400 Nm",
        "acceleration": "6.2s",
        "seats": 5,
        "topSpeed": "240 km/h",
        "transmission": "Tự động 9 cấp 9G-TRONIC",
        "powertrain": "2.0L Turbo Mild-Hybrid 48V (EQ Boost)",
        "drive": "4MATIC / 4 bánh toàn thời gian",
        "dimensions": "4.716 x 1.890 x 1.640 mm",
        "wheelbase": "2.888 mm",
        "groundClearance": "180 mm",
        "image": "assets/catalog/car-glc300.jpg",
        "stock": 3,
        "year": 2024,
        "warranty": "3 năm không giới hạn km",
        "colors": [
            {
                "name": "Trắng Polar White",
                "hex": "#F8FAFC",
                "img": "assets/catalog/car-glc300.jpg"
            },
            {
                "name": "Đen Obsidian",
                "hex": "#000000",
                "img": "assets/catalog/car-glc300.jpg"
            },
            {
                "name": "Xanh Cavansite",
                "hex": "#1E3A8A",
                "img": "assets/catalog/car-glc300.jpg"
            }
        ],
        "features": [
            "Hệ thống đèn pha Digital Light độ phân giải 2.6 triệu pixel",
            "Giao diện MBUX thế hệ mới với màn hình cảm ứng OLED 11.9 inch",
            "Hệ thống âm thanh vòm Burmester 3D 15 loa công suất 710W",
            "Gói hỗ trợ người lái Driving Assistance Plus an toàn tuyệt đối",
            "Cửa sổ trời toàn cảnh Panoramic trần kính chống tia hồng ngoại"
        ],
        "description": "Mẫu SUV hạng sang bán chạy nhất của thương hiệu ngôi sao ba cánh tại Việt Nam, hội tụ công nghệ số hóa xa hoa và hiệu suất vận hành êm ái.",
        "productCode": "CAR-007",
        "subCategory": "SUV Hạng sang",
        "colorsSummary": "Trắng, Đen, Xanh Cavansite",
        "excelSpecs": "2.0L Turbo Mild-Hybrid, 258 hp, Hộp số 9G-TRONIC, AWD",
        "excelStock": 3,
        "isDataXe": true,
        "isAvailable": true
    },
    {
        "id": "bmw-330i",
        "name": "BMW 330i M Sport",
        "brand": "BMW",
        "subtitle": "Sedan Thể Thao Cảm Giác Lái Tuyệt Đỉnh",
        "type": "new",
        "category": "Sedan",
        "fuel": "gas",
        "price": 1869000000,
        "priceFormatted": "1.869.000.000 VNĐ",
        "priceShort": "1.869 tỷ",
        "badge": "M Sport",
        "power": "2.0L TwinPower Turbo, 258 hp, Hộp số Steptronic 8 cấp, RWD",
        "hp": 258,
        "torque": "400 Nm",
        "acceleration": "5.8s",
        "seats": 5,
        "topSpeed": "250 km/h",
        "transmission": "Thể thao Steptronic 8 cấp",
        "powertrain": "2.0L I4 BMW TwinPower Turbo",
        "drive": "RWD / Cầu sau thể thao phân bổ 50:50",
        "dimensions": "4.713 x 1.827 x 1.442 mm",
        "wheelbase": "2.851 mm",
        "groundClearance": "136 mm",
        "image": "assets/catalog/car-bmw330.jpg",
        "stock": 2,
        "year": 2023,
        "warranty": "3 năm không giới hạn km",
        "colors": [
            {
                "name": "Xanh Phytonic Blue",
                "hex": "#1E40AF",
                "img": "assets/catalog/car-bmw330.jpg"
            },
            {
                "name": "Trắng Mineral White",
                "hex": "#FFFFFF",
                "img": "assets/catalog/car-bmw330.jpg"
            },
            {
                "name": "Đen Black Sapphire",
                "hex": "#0F172A",
                "img": "assets/catalog/car-bmw330.jpg"
            }
        ],
        "features": [
            "Gói thiết kế thể thao M Sport khí động học chính hãng",
            "Màn hình cong BMW Curved Display đôi chạy hệ điều hành iDrive 8",
            "Hệ thống treo thể thao M Sport thích ứng",
            "Phanh hiệu năng cao M Sport với kẹp phanh sơn xanh dương",
            "Dàn âm thanh vòm cao cấp Harman Kardon 16 loa"
        ],
        "description": "Chiếc sedan biểu tượng của phong cách thể thao Đức, phân bổ trọng lượng hoàn hảo 50:50 mang đến cảm giác dính lưng phấn khích trong từng góc cua.",
        "productCode": "CAR-008",
        "subCategory": "Sedan Hạng sang",
        "colorsSummary": "Xanh Phytonic, Trắng, Đen",
        "excelSpecs": "2.0L TwinPower Turbo, 258 hp, Hộp số Steptronic 8 cấp, RWD",
        "excelStock": 2,
        "isDataXe": true,
        "isAvailable": true
    },
    {
        "id": "kia-seltos",
        "name": "Kia Seltos 1.5L Luxury",
        "brand": "Kia",
        "subtitle": "B-SUV Đô Thị Năng Động & Đột Phá",
        "type": "new",
        "category": "Compact",
        "fuel": "gas",
        "price": 649000000,
        "priceFormatted": "649.000.000 VNĐ",
        "priceShort": "649 triệu",
        "badge": "Cá tính",
        "power": "1.5L Smartstream, 113 hp, Hộp số CVT",
        "hp": 113,
        "torque": "144 Nm",
        "acceleration": "10.5s",
        "seats": 5,
        "topSpeed": "175 km/h",
        "transmission": "Tự động vô cấp Smartstream IVT",
        "powertrain": "Smartstream G 1.5L xăng",
        "drive": "FWD / Cầu trước",
        "dimensions": "4.365 x 1.800 x 1.645 mm",
        "wheelbase": "2.610 mm",
        "groundClearance": "190 mm",
        "image": "assets/catalog/car-seltos.jpg",
        "stock": 15,
        "year": 2024,
        "warranty": "5 năm hoặc 150.000 km",
        "colors": [
            {
                "name": "Trắng Ngọc",
                "hex": "#FFFFFF",
                "img": "assets/catalog/car-seltos.jpg"
            },
            {
                "name": "Đen Ánh Kim",
                "hex": "#0F172A",
                "img": "assets/catalog/car-seltos.jpg"
            },
            {
                "name": "Vàng Cát",
                "hex": "#D97706",
                "img": "assets/catalog/car-seltos.jpg"
            },
            {
                "name": "Đỏ Tươi",
                "hex": "#DC2626",
                "img": "assets/catalog/car-seltos.jpg"
            }
        ],
        "features": [
            "Màn hình giải trí liền khối dạng kép Panorama 10.25 inch",
            "Phanh tay điện tử tích hợp chức năng Auto Hold",
            "Cụm đèn pha full-LED Star-map sắc sảo ấn tượng",
            "3 chế độ lái Normal/Eco/Sport và 3 chế độ kiểm soát lực kéo",
            "Ghế lái chỉnh điện tích hợp tính năng làm mát hàng ghế trước"
        ],
        "description": "Mẫu SUV đô thị cá tính, nội thất hiện đại dẫn đầu phân khúc, linh hoạt khi di chuyển hàng ngày và tiết kiệm nhiên liệu tối ưu.",
        "productCode": "CAR-009",
        "subCategory": "B-SUV",
        "colorsSummary": "Trắng, Đen, Vàng, Đỏ",
        "excelSpecs": "1.5L Smartstream, 113 hp, Hộp số CVT",
        "excelStock": 15,
        "isDataXe": true,
        "isAvailable": true
    },
    {
        "id": "mitsubishi-xpander",
        "name": "Mitsubishi Xpander Cross",
        "brand": "Mitsubishi",
        "subtitle": "MPV Gầm Cao 7 Chỗ Lý Tưởng Cho Gia Đình",
        "type": "new",
        "category": "Compact",
        "fuel": "gas",
        "price": 698000000,
        "priceFormatted": "698.000.000 VNĐ",
        "priceShort": "698 triệu",
        "badge": "MPV 7 Chỗ",
        "power": "1.5L MIVEC, 104 hp, Hộp số Tự động 4 cấp, Khoảng sáng gầm 225mm",
        "hp": 104,
        "torque": "141 Nm",
        "acceleration": "12.0s",
        "seats": 7,
        "topSpeed": "170 km/h",
        "transmission": "Tự động 4 cấp (4-AT)",
        "powertrain": "1.5L MIVEC DOHC 16 van",
        "drive": "FWD / Cầu trước",
        "dimensions": "4.595 x 1.790 x 1.750 mm",
        "wheelbase": "2.775 mm",
        "groundClearance": "225 mm",
        "image": "assets/catalog/car-xpander.jpg",
        "stock": 9,
        "year": 2024,
        "warranty": "3 năm hoặc 100.000 km",
        "colors": [
            {
                "name": "Cam/Đen Hai Tông",
                "hex": "#EA580C",
                "img": "assets/catalog/car-xpander.jpg"
            },
            {
                "name": "Trắng Thạch Anh",
                "hex": "#FFFFFF",
                "img": "assets/catalog/car-xpander.jpg"
            },
            {
                "name": "Bạc Tinh Thể",
                "hex": "#94A3B8",
                "img": "assets/catalog/car-xpander.jpg"
            }
        ],
        "features": [
            "Khoảng sáng gầm xe 225mm lớn nhất phân khúc, lội nước vượt trội",
            "Hệ thống kiểm soát vào cua chủ động Active Yaw Control (AYC)",
            "Không gian 7 chỗ linh hoạt gập phẳng hoàn toàn sàn xe",
            "Vô lăng 4 chấu bọc da thể thao thừa hưởng từ Pajero Sport",
            "Điều hòa kỹ thuật số có chế độ Max Cool làm mát khoang xe siêu tốc"
        ],
        "description": "Vua doanh số xe 7 chỗ tại Việt Nam, sự kết hợp hoàn hảo giữa không gian MPV rộng rãi và độ bền bỉ gầm cao linh hoạt trên mọi cung đường.",
        "productCode": "CAR-010",
        "subCategory": "MPV 7 chỗ",
        "colorsSummary": "Cam/Đen, Trắng, Bạc",
        "excelSpecs": "1.5L MIVEC, 104 hp, Hộp số Tự động 4 cấp, Khoảng sáng gầm 225mm",
        "excelStock": 9,
        "isDataXe": true,
        "isAvailable": true
    },
    {
        "id": "vinfast-vf3",
        "name": "VinFast VF 3 Eco",
        "brand": "VinFast",
        "subtitle": "Mini-SUV Điện Đô Thị Độc Đáo Quốc Dân Bản Eco",
        "type": "new",
        "category": "Compact",
        "fuel": "ev",
        "price": 285000000,
        "priceFormatted": "285.000.000 VNĐ",
        "priceShort": "285 triệu",
        "badge": "Bản Eco",
        "range": 210,
        "power": "32 kW (43 HP), Mô-men xoắn 110 Nm, RWD",
        "hp": 43,
        "torque": "110 Nm",
        "acceleration": "12.5s",
        "seats": 4,
        "battery": "18.64 kWh",
        "fastCharge": "36 phút (10-70%)",
        "topSpeed": "100 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Động cơ Điện đơn RWD",
        "drive": "RWD / Cầu sau",
        "dimensions": "3.190 x 1.679 x 1.622 mm",
        "wheelbase": "2.075 mm",
        "groundClearance": "191 mm",
        "image": "assets/catalog/car-vf3.jpg",
        "stock": 25,
        "year": 2024,
        "warranty": "7 năm hoặc 160.000 km",
        "colors": [
            {
                "name": "Vàng Nắng & Trắng",
                "hex": "#EAB308",
                "img": "assets/catalog/car-vf3.jpg"
            }
        ],
        "features": [
            "Gầm cao 191mm linh hoạt leo vỉa hè và lội nước đô thị",
            "Màn hình cảm ứng trung tâm 10 inch",
            "La-zăng kích thước 16 inch lớn nhất phân khúc xe mini",
            "Bảo hành chính hãng 7 năm hoặc 160.000 km",
            "Chi phí sạc điện siêu tiết kiệm chỉ bằng 1/3 xe máy tay ga"
        ],
        "description": "Cơn sốt ô tô điện mini tại Việt Nam, thiết kế hình hộp việt dã cá tính và tiện dụng tối đa cho nhu cầu di chuyển hàng ngày.",
        "productCode": "VF3-ECO",
        "subCategory": "Mini-SUV Điện",
        "colorsSummary": "Vàng Nắng & Trắng",
        "excelSpecs": "32 kW (43 HP), Mô-men xoắn 110 Nm, RWD",
        "excelStock": 25,
        "isAvailable": true
    },
    {
        "id": "vinfast-vf7",
        "name": "VinFast VF 7 Plus AWD",
        "brand": "VinFast",
        "subtitle": "C-SUV Điện Đẳng Cấp Thể Thao Phi Thuyền",
        "type": "new",
        "category": "SUV",
        "fuel": "ev",
        "price": 999000000,
        "priceFormatted": "999.000.000 VNĐ",
        "priceShort": "999 triệu",
        "badge": "AWD 349 HP",
        "range": 450,
        "power": "Động cơ Điện kép 260 kW (349 HP), Mô-men xoắn 500 Nm, AWD",
        "hp": 349,
        "torque": "500 Nm",
        "acceleration": "5.8s",
        "seats": 5,
        "battery": "75.3 kWh",
        "fastCharge": "24 phút (10-70%)",
        "topSpeed": "190 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Động cơ Điện kép Dual Motor AWD",
        "drive": "AWD / 2 cầu điện độc lập",
        "dimensions": "4.545 x 1.890 x 1.636 mm",
        "wheelbase": "2.840 mm",
        "groundClearance": "190 mm",
        "image": "assets/catalog/car-vf7.jpg",
        "stock": 7,
        "year": 2024,
        "warranty": "10 năm hoặc 200.000 km",
        "colors": [
            {
                "name": "Đỏ Crimson & Mui Đen",
                "hex": "#DC2626",
                "img": "assets/catalog/car-vf7.jpg"
            }
        ],
        "features": [
            "Thiết kế phi thuyền vũ trụ phong cách tương lai từ Torino Design",
            "Màn hình giải trí 12.9 inch hướng về người lái",
            "Trần kính toàn cảnh Panorama đẳng cấp",
            "Trợ lý ảo ViVi và trợ lái nâng cao ADAS Cấp độ 2",
            "Tăng tốc 0-100 km/h phấn khích chỉ trong 5.8 giây"
        ],
        "description": "Mẫu C-SUV thể thao ấn tượng nhất phân khúc, kết hợp sức mạnh động cơ điện 349 HP cùng đường nét thiết kế khí động học cuốn hút.",
        "productCode": "VF7-AWD",
        "subCategory": "C-SUV Điện",
        "colorsSummary": "Đỏ Crimson & Mui Đen",
        "excelSpecs": "Động cơ Điện kép 260 kW (349 HP), Mô-men xoắn 500 Nm, AWD",
        "excelStock": 7,
        "isAvailable": true
    },
    {
        "id": "vinfast-vf9",
        "name": "VinFast VF 9 Plus 7 Chỗ",
        "brand": "VinFast",
        "subtitle": "E-SUV Điện Cỡ Lớn Flagship Đẳng Cấp Tổng Thống",
        "type": "new",
        "category": "SUV",
        "fuel": "ev",
        "price": 1589000000,
        "priceFormatted": "1.589.000.000 VNĐ",
        "priceShort": "1.589 tỷ",
        "badge": "Flagship E-SUV",
        "range": 626,
        "power": "Động cơ Điện kép 300 kW (402 HP), Mô-men xoắn 620 Nm, AWD",
        "hp": 402,
        "torque": "620 Nm",
        "acceleration": "6.5s",
        "seats": 7,
        "battery": "123 kWh",
        "fastCharge": "26 phút (10-70%)",
        "topSpeed": "200 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Động cơ Điện kép Dual Motor AWD",
        "drive": "AWD / 2 cầu điện độc lập",
        "dimensions": "5.118 x 2.254 x 1.696 mm",
        "wheelbase": "3.150 mm",
        "groundClearance": "197 mm",
        "image": "assets/catalog/car-vf9.jpg",
        "stock": 5,
        "year": 2024,
        "warranty": "10 năm hoặc 200.000 km",
        "colors": [
            {
                "name": "Xanh Deep Ocean",
                "hex": "#0369A1",
                "img": "assets/family-7.jpg"
            },
            {
                "name": "Trắng Brahminy",
                "hex": "#FFFFFF",
                "img": "assets/family-7.jpg"
            },
            {
                "name": "Đen Crimson",
                "hex": "#000000",
                "img": "assets/family-7.jpg"
            }
        ],
        "features": [
            "Hàng ghế cơ trưởng Captain Seat massage sưởi/thông gió đa điểm",
            "Màn hình giải trí 15.6 inch 4K cùng màn hình phụ hàng ghế 2",
            "Cửa hít tự động 4 cánh và cốp điện thông minh",
            "Hệ thống treo khí nén chủ động êm ái thích ứng",
            "Pin CATL 123 kWh thế hệ mới di chuyển vượt 600km một lần sạc"
        ],
        "description": "Mẫu SUV điện cỡ lớn hạng sang cao cấp nhất của VinFast, chuẩn mực không gian nội thất thương gia dành cho doanh nhân và gia đình thượng lưu.",
        "productCode": "VF9-PLUS",
        "subCategory": "E-SUV Điện 6-7 Chỗ",
        "colorsSummary": "Xanh Deep Ocean, Trắng Brahminy, Đen Crimson",
        "excelSpecs": "Động cơ Điện kép 300 kW (402 HP), Mô-men xoắn 620 Nm, AWD",
        "excelStock": 5,
        "isAvailable": true
    },
    {
        "id": "vinfast-vf2",
        "name": "VinFast VF 2",
        "brand": "VinFast",
        "subtitle": "Ô Tô Điện Đô Thị Nhỏ Gọn Thông Minh",
        "category": "Compact",
        "fuel": "ev",
        "type": "new",
        "price": 188000000,
        "priceFormatted": "188.000.000 VNĐ",
        "priceShort": "188 triệu",
        "badge": "Giá tốt nhất",
        "range": 210,
        "hp": 40,
        "power": "30 kW (40 HP), Mô-men xoắn 65 Nm, RWD",
        "torque": "65 Nm",
        "acceleration": "12.0s",
        "seats": 4,
        "battery": "Pin LFP",
        "fastCharge": "34 phút (10-70%)",
        "topSpeed": "100 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Động cơ Điện đơn RWD",
        "drive": "RWD / Cầu sau",
        "dimensions": "3.630 x 1.500 x 1.650 mm",
        "wheelbase": "2.100 mm",
        "groundClearance": "160 mm",
        "stock": 20,
        "year": 2024,
        "warranty": "7 năm hoặc 160.000 km",
        "image": "assets/catalog/car-vf2.jpg",
        "isAvailable": true,
        "colors": [
            {
                "name": "Trắng Tiêu Chuẩn",
                "hex": "#FFFFFF",
                "img": "assets/catalog/car-vf2.jpg"
            },
            {
                "name": "Bạc Ánh Kim",
                "hex": "#94A3B8",
                "img": "assets/catalog/car-vf2.jpg"
            },
            {
                "name": "Đen Huyền Bí",
                "hex": "#1E293B",
                "img": "assets/catalog/car-vf2.jpg"
            }
        ],
        "features": [
            "Thiết kế hatchback đô thị nhỏ gọn, bán kính quay vòng tối ưu",
            "Quãng đường di chuyển 210 km (chu trình chuẩn NEDC)",
            "Thời gian sạc nhanh 10-70% chỉ trong 34 phút",
            "Mức giá tiếp cận tốt nhất trong các dòng ô tô điện tại Việt Nam"
        ],
        "description": "Mẫu xe điện đô thị mini tiện lợi, linh hoạt trong ngõ hẻm phố thị, chi phí sạc siêu tiết kiệm và thân thiện với môi trường.",
        "officialUrl": "https://vinfastauto.com/vn_vi/dat-coc-xe-vf2",
        "productCode": "VF2",
        "subCategory": "Mini-SUV Điện",
        "colorsSummary": "Trắng Tiêu Chuẩn, Bạc Ánh Kim, Đen Huyền Bí",
        "excelSpecs": "30 kW (40 HP), Mô-men xoắn 65 Nm, RWD",
        "excelStock": 20
    },
    {
        "id": "vinfast-vf5",
        "name": "VinFast VF 5 Plus",
        "brand": "VinFast",
        "subtitle": "SUV Điện Cỡ A Thông Minh & Trẻ Trung",
        "category": "SUV",
        "fuel": "ev",
        "type": "new",
        "price": 496000000,
        "priceFormatted": "496.000.000 VNĐ",
        "priceShort": "496 triệu",
        "badge": "Bán chạy nhất",
        "range": 326,
        "hp": 134,
        "power": "100 kW (134 HP), Mô-men xoắn 135 Nm, FWD",
        "torque": "135 Nm",
        "acceleration": "10.9s",
        "seats": 5,
        "battery": "37.23 kWh",
        "fastCharge": "33 phút (10-70%)",
        "topSpeed": "130 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Động cơ Điện đơn FWD",
        "drive": "FWD / Cầu trước",
        "dimensions": "3.967 x 1.723 x 1.579 mm",
        "wheelbase": "2.513 mm",
        "groundClearance": "182 mm",
        "stock": 15,
        "year": 2024,
        "warranty": "7 năm hoặc 160.000 km",
        "image": "assets/catalog/car-vf5.jpg",
        "isAvailable": true,
        "colors": [
            {
                "name": "Xanh Nóc Trắng",
                "hex": "#0066FF",
                "img": "assets/catalog/car-vf5.jpg"
            },
            {
                "name": "Trắng Brahminy",
                "hex": "#FFFFFF",
                "img": "assets/catalog/car-vf5.jpg"
            },
            {
                "name": "Cam Nóc Trắng",
                "hex": "#EA580C",
                "img": "assets/catalog/car-vf5.jpg"
            }
        ],
        "features": [
            "Dung lượng pin khả dụng 37.23 kWh, quãng đường 326 km (NEDC)",
            "Động cơ điện công suất 100 kW (134 HP) mạnh mẽ nhất phân khúc A-SUV",
            "Hệ thống hỗ trợ lái nâng cao ADAS và giám sát hành trình an toàn",
            "Thời gian sạc nhanh từ 10% đến 70% chỉ trong 33 phút"
        ],
        "description": "Mẫu A-SUV thuần điện dẫn đầu doanh số đô thị, khoang cabin 5 chỗ rộng rãi, công nghệ kết nối thông minh và chi phí năng lượng cực thấp.",
        "officialUrl": "https://vinfastauto.com/vn_vi/dat-coc-xe-dien-vf5",
        "productCode": "VF5",
        "subCategory": "A-SUV Điện",
        "colorsSummary": "Xanh Nóc Trắng, Trắng Brahminy, Cam Nóc Trắng",
        "excelSpecs": "100 kW (134 HP), Mô-men xoắn 135 Nm, FWD",
        "excelStock": 15
    },
    {
        "id": "vinfast-vf6",
        "name": "VinFast VF 6 Eco",
        "brand": "VinFast",
        "subtitle": "SUV Điện Cỡ B Thời Thượng Bản Tiêu Chuẩn",
        "category": "SUV",
        "fuel": "ev",
        "type": "new",
        "price": 646000000,
        "priceFormatted": "646.000.000 VNĐ",
        "priceShort": "646 triệu",
        "badge": "Bản Eco",
        "range": 485,
        "hp": 174,
        "power": "130 kW - 150 kW (174 - 201 HP), Mô-men xoắn 250 - 310 Nm, FWD",
        "torque": "250 Nm",
        "acceleration": "8.5s",
        "seats": 5,
        "battery": "59.6 kWh",
        "fastCharge": "25 phút (10-70%)",
        "topSpeed": "160 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Động cơ Điện đơn FWD",
        "drive": "FWD / Cầu trước",
        "dimensions": "4.241 x 1.834 x 1.580 mm",
        "wheelbase": "2.730 mm",
        "groundClearance": "170 mm",
        "stock": 12,
        "year": 2024,
        "warranty": "7 năm hoặc 160.000 km",
        "image": "assets/catalog/car-vf6.jpg",
        "isAvailable": true,
        "colors": [
            {
                "name": "Đỏ Crimson Red",
                "hex": "#B91C1C",
                "img": "assets/catalog/car-vf6.jpg"
            },
            {
                "name": "Trắng Brahminy",
                "hex": "#FFFFFF",
                "img": "assets/catalog/car-vf6.jpg"
            },
            {
                "name": "Xanh Deep Ocean",
                "hex": "#0369A1",
                "img": "assets/catalog/car-vf6.jpg"
            }
        ],
        "features": [
            "Thiết kế ngoại thất tinh tế do studio Torino Design lừng danh chắp bút",
            "Pin dung lượng 59.6 kWh cho quãng đường di chuyển lên đến 485 km (NEDC)",
            "Công suất lên tới 201 HP và mô-men xoắn tức thời 310 Nm",
            "Sạc nhanh siêu tốc 10-70% chỉ trong 25 phút"
        ],
        "description": "Mẫu B-SUV điện sang trọng, không gian nội thất tối giản với màn hình 12.9 inch hướng về người lái, mang đến cảm giác lái phấn khích và an tâm tuyệt đối.",
        "officialUrl": "https://vinfastauto.com/vn_vi/dat-coc-xe-dien-vf6",
        "productCode": "VF6-ECO",
        "subCategory": "B-SUV Điện",
        "colorsSummary": "Đỏ Crimson Red, Trắng Brahminy, Xanh Deep Ocean",
        "excelSpecs": "130 kW - 150 kW (174 - 201 HP), Mô-men xoắn 250 - 310 Nm, FWD",
        "excelStock": 12
    },
    {
        "id": "vinfast-vf-mpv7",
        "name": "VinFast VF MPV 7",
        "brand": "VinFast",
        "subtitle": "MPV Điện 7 Chỗ Gia Đình Hiện Đại & Tiện Nghi",
        "category": "Compact",
        "fuel": "ev",
        "type": "new",
        "price": 750000000,
        "priceFormatted": "750.000.000 VNĐ",
        "priceShort": "750 triệu",
        "badge": "Gia đình 7 chỗ",
        "range": 450,
        "hp": 201,
        "power": "150 kW (201 HP), Mô-men xoắn 280 Nm, FWD",
        "torque": "280 Nm",
        "acceleration": "9.2s",
        "seats": 7,
        "battery": "60.13 kWh",
        "fastCharge": "30 phút (10-70%)",
        "topSpeed": "150 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Động cơ Điện đơn FWD",
        "drive": "FWD / Cầu trước",
        "dimensions": "4.740 x 1.872 x 1.734 mm",
        "wheelbase": "2.860 mm",
        "groundClearance": "175 mm",
        "stock": 10,
        "year": 2024,
        "warranty": "7 năm hoặc 160.000 km",
        "image": "assets/catalog/car-vfmpv7.jpg",
        "isAvailable": true,
        "colors": [
            {
                "name": "Bạc Moonlight",
                "hex": "#D1D5DB",
                "img": "assets/catalog/car-vfmpv7.jpg"
            },
            {
                "name": "Trắng Pearl",
                "hex": "#FFFFFF",
                "img": "assets/catalog/car-vfmpv7.jpg"
            },
            {
                "name": "Đen Obsidian",
                "hex": "#1E293B",
                "img": "assets/catalog/car-vfmpv7.jpg"
            }
        ],
        "features": [
            "Cấu hình 7 chỗ thực thụ rộng rãi, gập ghế phẳng đa dụng linh hoạt",
            "Động cơ điện công suất 150 kW (201 HP) êm ái khi chở đủ tải",
            "Quãng đường di chuyển 450 km (NEDC) sẵn sàng cho hành trình liên tỉnh",
            "Công nghệ sạc nhanh 10-70% trong 30 phút tiện lợi trên mọi trạm sạc"
        ],
        "description": "Xe đa dụng MPV 7 chỗ thuần điện lý tưởng cho các gia đình hiện đại và dịch vụ vận chuyển cao cấp, mang lại trải nghiệm êm ái, yên tĩnh không tiếng ồn động cơ.",
        "officialUrl": "https://vinfastauto.com/vn_vi/dat-coc-xe-vf-mpv7",
        "productCode": "VFMPV7",
        "subCategory": "MPV Điện 7 chỗ",
        "colorsSummary": "Bạc Moonlight, Trắng Pearl, Đen Obsidian",
        "excelSpecs": "150 kW (201 HP), Mô-men xoắn 280 Nm, FWD",
        "excelStock": 10
    },
    {
        "id": "vinfast-vf8-all-new",
        "name": "VinFast VF 8 Thế hệ mới (2026)",
        "brand": "VinFast",
        "subtitle": "SUV Điện Cỡ D Thông Minh Thế Hệ Mới 2026",
        "category": "SUV",
        "fuel": "ev",
        "type": "new",
        "price": 1150000000,
        "priceFormatted": "1.150.000.000 VNĐ",
        "priceShort": "1.150 tỷ",
        "badge": "Thế hệ mới 2026",
        "range": 500,
        "hp": 350,
        "power": "Động cơ Điện thế hệ mới, 260 kW (350 HP), AWD",
        "torque": "500 Nm",
        "acceleration": "5.5s",
        "seats": 5,
        "battery": "60.13 kWh",
        "fastCharge": "30 phút (10-70%)",
        "topSpeed": "200 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Động cơ Điện kép Dual Motor AWD",
        "drive": "AWD / 2 cầu điện độc lập",
        "dimensions": "4.701 x 1.872 x 1.670 mm",
        "wheelbase": "2.950 mm",
        "groundClearance": "180 mm",
        "stock": 10,
        "year": 2026,
        "warranty": "10 năm hoặc 200.000 km",
        "image": "assets/catalog/car-vf8-all-new.jpg",
        "isAvailable": true,
        "colors": [
            {
                "name": "Xanh Deep Ocean",
                "hex": "#0369A1",
                "img": "assets/catalog/car-vf8-all-new.jpg"
            },
            {
                "name": "Trắng Brahminy",
                "hex": "#FFFFFF",
                "img": "assets/catalog/car-vf8-all-new.jpg"
            },
            {
                "name": "Bạc Desat Silver",
                "hex": "#94A3B8",
                "img": "assets/catalog/car-vf8-all-new.jpg"
            }
        ],
        "features": [
            "Thiết kế khí động học cải tiến thế hệ mới 2026 tối ưu lực cản gió",
            "Khối pin công nghệ mới 60.13 kWh sạc nhanh 10-70% trong 30 phút",
            "Trợ lý ảo tiếng Việt ViVi và gói ADAS cấp độ 2 nâng cao",
            "Màn hình cảm ứng 15.6 inch 2K tích hợp hệ sinh thái giải trí thông minh"
        ],
        "description": "Phiên bản VinFast VF 8 Thế hệ mới 2026 đột phá với kích thước 4.701 x 1.872 x 1.670 mm, thời gian sạc nhanh 10-70% chỉ trong 30 phút và công nghệ tự hành thông minh tiên tiến.",
        "officialUrl": "https://vinfastauto.com/vn_vi/dat-coc-xe-vf8-the-all-new-2026",
        "productCode": "VF8-2026",
        "subCategory": "D-SUV Điện 2026",
        "colorsSummary": "Xanh Deep Ocean, Trắng Brahminy, Bạc Desat Silver",
        "excelSpecs": "Động cơ Điện thế hệ mới, 260 kW (350 HP), AWD",
        "excelStock": 10
    },
    {
        "id": "vinfast-vf-wild",
        "name": "VinFast VF Wild",
        "brand": "VinFast",
        "subtitle": "Bán Tải Điện Đột Phá Thiết Kế Khí Động Học & Mạnh Mẽ",
        "category": "SUV",
        "fuel": "ev",
        "type": "new",
        "price": 890000000,
        "priceFormatted": "890.000.000 VNĐ",
        "priceShort": "890 triệu",
        "badge": "Bán tải điện",
        "range": 450,
        "hp": 300,
        "power": "Động cơ Điện kép AWD, 225 kW (300 HP), Mô-men xoắn 550 Nm",
        "torque": "550 Nm",
        "acceleration": "6.5s",
        "seats": 5,
        "battery": "85 kWh",
        "fastCharge": "25 phút (10-70%)",
        "topSpeed": "180 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Động cơ Điện kép Dual Motor AWD",
        "drive": "AWD / 4 bánh toàn thời gian",
        "dimensions": "5.324 x 1.997 x 1.740 mm",
        "wheelbase": "3.250 mm",
        "groundClearance": "230 mm",
        "stock": 8,
        "year": 2025,
        "warranty": "10 năm hoặc 200.000 km",
        "image": "assets/catalog/car-vfwild.jpg",
        "isAvailable": true,
        "colors": [
            {
                "name": "Xám Titan",
                "hex": "#475569",
                "img": "assets/catalog/car-vfwild.jpg"
            },
            {
                "name": "Xanh Rêu",
                "hex": "#166534",
                "img": "assets/catalog/car-vfwild.jpg"
            },
            {
                "name": "Đen Sa Mạc",
                "hex": "#1E293B",
                "img": "assets/catalog/car-vfwild.jpg"
            }
        ],
        "features": [
            "Mẫu bán tải điện cỡ trung đầu tiên của VinFast với thiết kế dũng mãnh",
            "Thùng hàng phía sau có vách ngăn gập điện mở rộng linh hoạt",
            "Kính chắn gió toàn cảnh Panorama kéo dài đến trần xe",
            "Động cơ điện AWD vượt mọi địa hình cát, sỏi, ngập nước"
        ],
        "description": "Mẫu bán tải thuần điện phong cách việt dã đỉnh cao, trang bị 2 động cơ điện AWD mạnh mẽ cùng thùng sau mở rộng linh hoạt, định hình phong cách sống phiêu lưu và bền vững.",
        "officialUrl": "https://vinfastauto.com/vn_vi/cho-xe-oto",
        "productCode": "VFWILD",
        "subCategory": "Bán tải Điện",
        "colorsSummary": "Xám Titan, Xanh Rêu, Đen Sa Mạc",
        "excelSpecs": "Động cơ Điện kép AWD, 225 kW (300 HP), Mô-men xoắn 550 Nm",
        "excelStock": 8
    },
    {
        "id": "vinfast-vf3-plus",
        "name": "VinFast VF 3 Plus",
        "brand": "VinFast",
        "subtitle": "Mini-SUV Điện Đô Thị Bản Nâng Cấp Plus",
        "category": "Compact",
        "fuel": "ev",
        "type": "new",
        "price": 296000000,
        "priceFormatted": "296.000.000 VNĐ",
        "priceShort": "296 triệu",
        "badge": "Bản Plus",
        "range": 215,
        "hp": 43,
        "power": "32 kW (43 HP), Mô-men xoắn 110 Nm, RWD",
        "torque": "110 Nm",
        "acceleration": "12.5s",
        "seats": 4,
        "battery": "18.64 kWh",
        "fastCharge": "36 phút (10-70%)",
        "topSpeed": "100 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Động cơ Điện đơn RWD",
        "drive": "RWD / Cầu sau",
        "dimensions": "3.190 x 1.679 x 1.622 mm",
        "wheelbase": "2.075 mm",
        "groundClearance": "191 mm",
        "stock": 20,
        "year": 2024,
        "warranty": "7 năm hoặc 160.000 km",
        "image": "assets/catalog/car-vf3.jpg",
        "isAvailable": true,
        "colors": [
            {
                "name": "Vàng Nắng & Nóc Trắng",
                "hex": "#EAB308",
                "img": "assets/catalog/car-vf3.jpg"
            },
            {
                "name": "Xanh Cổ Vịt",
                "hex": "#0E7490",
                "img": "assets/catalog/car-vf3.jpg"
            }
        ],
        "features": [
            "Phiên bản nâng cấp Plus với gói nội thất phối 2 màu thời trang",
            "Màn hình giải trí cảm ứng 10 inch độ nét cao hỗ trợ kết nối",
            "Bảo hành chính hãng 7 năm hoặc 160.000 km",
            "Khoảng sáng gầm xe 191 mm vượt trội trong đô thị"
        ],
        "description": "Phiên bản nâng cấp tiện nghi của xe điện quốc dân VF 3, mang đến trải nghiệm lái năng động, màu sắc ngoại thất cá tính cùng mức giá cực kỳ dễ tiếp cận.",
        "officialUrl": "https://vinfastauto.com/vn_vi/dat-coc-xe-dien-vf3",
        "productCode": "VF3-PLUS",
        "subCategory": "Mini-SUV Điện",
        "colorsSummary": "Vàng Nắng & Nóc Trắng, Xanh Cổ Vịt",
        "excelSpecs": "32 kW (43 HP), Mô-men xoắn 110 Nm, RWD",
        "excelStock": 20
    },
    {
        "id": "vinfast-vf6-plus",
        "name": "VinFast VF 6 Plus",
        "brand": "VinFast",
        "subtitle": "SUV Điện Cỡ B Bản Nâng Cấp Công Suất 201 HP",
        "category": "SUV",
        "fuel": "ev",
        "type": "new",
        "price": 699000000,
        "priceFormatted": "699.000.000 VNĐ",
        "priceShort": "699 triệu",
        "badge": "201 HP Cao Cấp",
        "range": 460,
        "hp": 201,
        "power": "150 kW (201 HP), Mô-men xoắn 310 Nm, FWD",
        "torque": "310 Nm",
        "acceleration": "7.9s",
        "seats": 5,
        "battery": "59.6 kWh",
        "fastCharge": "25 phút (10-70%)",
        "topSpeed": "160 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Động cơ Điện đơn FWD hiệu năng cao",
        "drive": "FWD / Cầu trước",
        "dimensions": "4.241 x 1.834 x 1.580 mm",
        "wheelbase": "2.730 mm",
        "groundClearance": "170 mm",
        "stock": 15,
        "year": 2024,
        "warranty": "7 năm hoặc 160.000 km",
        "image": "assets/catalog/car-vf6.jpg",
        "isAvailable": true,
        "colors": [
            {
                "name": "Đỏ Crimson Red",
                "hex": "#B91C1C",
                "img": "assets/catalog/car-vf6.jpg"
            },
            {
                "name": "Trắng Brahminy",
                "hex": "#FFFFFF",
                "img": "assets/catalog/car-vf6.jpg"
            },
            {
                "name": "Xanh Deep Ocean",
                "hex": "#0369A1",
                "img": "assets/catalog/car-vf6.jpg"
            }
        ],
        "features": [
            "Động cơ nâng cấp công suất 150 kW (201 HP) và mô-men xoắn 310 Nm",
            "Gói hỗ trợ lái xe nâng cao ADAS Cấp độ 2 với giữ làn và phanh khẩn cấp",
            "Pin 59.6 kWh cho phạm vi hoạt động 460 km (NEDC)",
            "Mâm đúc hợp kim 19 inch đa chấu phay bóng thể thao"
        ],
        "description": "Phiên bản cao cấp nhất của dòng B-SUV thuần điện VinFast, sở hữu động cơ 201 mã lực bứt tốc mạnh mẽ, nội thất da cao cấp và trợ lái ADAS toàn diện.",
        "officialUrl": "https://vinfastauto.com/vn_vi/dat-coc-xe-dien-vf6",
        "productCode": "VF6-PLUS",
        "subCategory": "B-SUV Điện",
        "colorsSummary": "Đỏ Crimson Red, Trắng Brahminy, Xanh Deep Ocean",
        "excelSpecs": "150 kW (201 HP), Mô-men xoắn 310 Nm, FWD",
        "excelStock": 15
    },
    {
        "id": "vinfast-vf7-eco",
        "name": "VinFast VF 7 Eco",
        "brand": "VinFast",
        "subtitle": "C-SUV Điện Phi Thuyền Vũ Trụ Bản Tiết Kiệm",
        "category": "SUV",
        "fuel": "ev",
        "type": "new",
        "price": 740000000,
        "priceFormatted": "740.000.000 VNĐ",
        "priceShort": "740 triệu",
        "badge": "Giá từ 740 triệu",
        "range": 440,
        "hp": 174,
        "power": "130 kW (174 HP), Mô-men xoắn 250 Nm, FWD",
        "torque": "250 Nm",
        "acceleration": "8.2s",
        "seats": 5,
        "battery": "59.6 kWh",
        "fastCharge": "25 phút (10-70%)",
        "topSpeed": "175 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Động cơ Điện đơn FWD",
        "drive": "FWD / Cầu trước",
        "dimensions": "4.545 x 1.890 x 1.636 mm",
        "wheelbase": "2.840 mm",
        "groundClearance": "190 mm",
        "stock": 12,
        "year": 2024,
        "warranty": "10 năm hoặc 200.000 km",
        "image": "assets/catalog/car-vf7.jpg",
        "isAvailable": true,
        "colors": [
            {
                "name": "Trắng Brahminy",
                "hex": "#FFFFFF",
                "img": "assets/catalog/car-vf7.jpg"
            },
            {
                "name": "Đỏ Crimson",
                "hex": "#B91C1C",
                "img": "assets/catalog/car-vf7.jpg"
            },
            {
                "name": "Xám Desat",
                "hex": "#64748B",
                "img": "assets/catalog/car-vf7.jpg"
            }
        ],
        "features": [
            "Thiết kế phi thuyền vũ trụ mang dấu ấn studio Torino Design danh tiếng",
            "Động cơ điện 130 kW (174 HP) vận hành êm ái và tối ưu năng lượng",
            "Phạm vi di chuyển 440 km (NEDC) sau mỗi lần sạc đầy",
            "Chính sách bảo hành xe 10 năm hoặc 200.000 km bảo đảm an tâm"
        ],
        "description": "Mẫu C-SUV điện hiện đại với mức giá khởi điểm chỉ 740 triệu đồng, đem đến phong cách thiết kế phi thuyền tương lai và không gian nội thất 5 chỗ rộng rãi.",
        "officialUrl": "https://vinfastauto.com/vn_vi/dat-coc-xe-dien-vf7",
        "productCode": "VF7-ECO",
        "subCategory": "C-SUV Điện",
        "colorsSummary": "Trắng Brahminy, Đỏ Crimson, Xám Desat",
        "excelSpecs": "130 kW (174 HP), Mô-men xoắn 250 Nm, FWD",
        "excelStock": 12
    },
    {
        "id": "vinfast-vf7-plus",
        "name": "VinFast VF 7 Plus (FWD)",
        "brand": "VinFast",
        "subtitle": "C-SUV Điện Thể Thao Phi Thuyền Bản Cầu Trước FWD",
        "category": "SUV",
        "fuel": "ev",
        "type": "new",
        "price": 850000000,
        "priceFormatted": "850.000.000 VNĐ",
        "priceShort": "850 triệu",
        "badge": "Tầm xa 500 km",
        "range": 500,
        "hp": 201,
        "power": "150 kW (201 HP), Mô-men xoắn 310 Nm, FWD",
        "torque": "310 Nm",
        "acceleration": "7.5s",
        "seats": 5,
        "battery": "75.3 kWh",
        "fastCharge": "24 phút (10-70%)",
        "topSpeed": "185 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Động cơ Điện đơn FWD hiệu năng cao",
        "drive": "FWD / Cầu trước",
        "dimensions": "4.545 x 1.890 x 1.636 mm",
        "wheelbase": "2.840 mm",
        "groundClearance": "190 mm",
        "stock": 10,
        "year": 2024,
        "warranty": "10 năm hoặc 200.000 km",
        "image": "assets/catalog/car-vf7.jpg",
        "isAvailable": true,
        "colors": [
            {
                "name": "Đỏ Crimson & Mui Đen",
                "hex": "#DC2626",
                "img": "assets/catalog/car-vf7.jpg"
            },
            {
                "name": "Xanh Deep Ocean",
                "hex": "#0369A1",
                "img": "assets/catalog/car-vf7.jpg"
            }
        ],
        "features": [
            "Quãng đường di chuyển ấn tượng lên đến 500.5 km (NEDC)",
            "Màn hình cảm ứng trung tâm 12.9 inch sắc nét nghiêng về người lái",
            "Hệ thống phanh tái sinh năng lượng thông minh đa cấp độ",
            "Bảo hành chính hãng 10 năm hoặc 200.000 km"
        ],
        "description": "Bản Plus cầu trước FWD mang đến quãng đường di chuyển dài nhất phân khúc (hơn 500 km), công suất 201 mã lực cùng thiết kế thể thao đột phá.",
        "officialUrl": "https://vinfastauto.com/vn_vi/dat-coc-xe-dien-vf7",
        "productCode": "VF7-PLUS",
        "subCategory": "C-SUV Điện",
        "colorsSummary": "Đỏ Crimson & Mui Đen, Xanh Deep Ocean",
        "excelSpecs": "150 kW (201 HP), Mô-men xoắn 310 Nm, FWD",
        "excelStock": 10
    },
    {
        "id": "vinfast-vf8-eco",
        "name": "VinFast VF 8 Eco",
        "brand": "VinFast",
        "subtitle": "SUV Thuần Điện Cỡ D Thông Minh Tầm Xa 635 km",
        "category": "SUV",
        "fuel": "ev",
        "type": "new",
        "price": 853100000,
        "priceFormatted": "853.100.000 VNĐ",
        "priceShort": "853 triệu",
        "badge": "Tầm xa 635 km",
        "range": 635,
        "hp": 201,
        "power": "150 kW (201 HP), Mô-men xoắn 310 Nm, FWD",
        "torque": "310 Nm",
        "acceleration": "7.5s",
        "seats": 5,
        "battery": "87.7 kWh",
        "fastCharge": "26 phút (10-70%)",
        "topSpeed": "190 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Động cơ Điện đơn FWD tầm xa",
        "drive": "FWD / Cầu trước",
        "dimensions": "4.750 x 1.934 x 1.667 mm",
        "wheelbase": "2.950 mm",
        "groundClearance": "175 mm",
        "stock": 12,
        "year": 2024,
        "warranty": "10 năm hoặc 200.000 km",
        "image": "assets/catalog/car-vf8.jpg",
        "isAvailable": true,
        "colors": [
            {
                "name": "Trắng Brahminy White",
                "hex": "#FFFFFF",
                "img": "assets/catalog/car-vf8.jpg"
            },
            {
                "name": "Xanh VinFast Deep Ocean",
                "hex": "#0369A1",
                "img": "assets/catalog/car-vf8.jpg"
            },
            {
                "name": "Xám Desat Silver",
                "hex": "#94A3B8",
                "img": "assets/catalog/car-vf8.jpg"
            }
        ],
        "features": [
            "Quãng đường di chuyển kỷ lục lên đến 635 km (chu trình NEDC)",
            "Pin cao cấp dung lượng 87.7 kWh sạc nhanh siêu tốc",
            "Trợ lý thông minh ViVi cùng gói tính năng an toàn chủ động ADAS",
            "Khoang hành khách 5 chỗ rộng rãi với chiều dài cơ sở 2.950 mm"
        ],
        "description": "Phiên bản Eco của VinFast VF 8 với phạm vi hoạt động lên đến 635 km, mức giá niêm yết từ 853.1 triệu VNĐ, là chiếc SUV điện lý tưởng cho những chuyến hành trình xuyên Việt không gián đoạn.",
        "officialUrl": "https://vinfastauto.com/vn_vi/dat-coc-xe-vf8",
        "productCode": "VF8-ECO",
        "subCategory": "D-SUV Điện",
        "colorsSummary": "Trắng Brahminy White, Xanh VinFast Deep Ocean, Xám Desat Silver",
        "excelSpecs": "150 kW (201 HP), Mô-men xoắn 310 Nm, FWD",
        "excelStock": 12
    },
    {
        "id": "vinfast-vf9-eco",
        "name": "VinFast VF 9 Eco 7 Chỗ",
        "brand": "VinFast",
        "subtitle": "E-SUV Điện Flagship 7 Chỗ Tầm Xa 626 km",
        "category": "SUV",
        "fuel": "ev",
        "type": "new",
        "price": 1491000000,
        "priceFormatted": "1.491.000.000 VNĐ",
        "priceShort": "1.491 tỷ",
        "badge": "Tầm xa 626 km",
        "range": 626,
        "hp": 402,
        "power": "Động cơ Điện kép 300 kW (402 HP), Mô-men xoắn 620 Nm, AWD",
        "torque": "620 Nm",
        "acceleration": "6.5s",
        "seats": 7,
        "battery": "123 kWh",
        "fastCharge": "35 phút (10-70%)",
        "topSpeed": "200 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Động cơ Điện kép Dual Motor AWD",
        "drive": "AWD / 2 cầu điện độc lập",
        "dimensions": "5.118 x 2.254 x 1.696 mm",
        "wheelbase": "3.150 mm",
        "groundClearance": "197 mm",
        "stock": 8,
        "year": 2024,
        "warranty": "10 năm hoặc 200.000 km",
        "image": "assets/catalog/car-vf9.jpg",
        "isAvailable": true,
        "colors": [
            {
                "name": "Xanh Deep Ocean",
                "hex": "#0369A1",
                "img": "assets/catalog/car-vf9.jpg"
            },
            {
                "name": "Trắng Brahminy",
                "hex": "#FFFFFF",
                "img": "assets/catalog/car-vf9.jpg"
            },
            {
                "name": "Đen Crimson",
                "hex": "#000000",
                "img": "assets/catalog/car-vf9.jpg"
            }
        ],
        "features": [
            "Quãng đường 626 km theo chu trình kiểm định WLTP nghiêm ngặt",
            "Khối pin dung lượng khủng 123 kWh cùng hệ dẫn động 4 bánh toàn thời gian AWD",
            "Không gian 7 chỗ full-size sang trọng, hàng ghế 2 gập linh hoạt",
            "Hệ thống an toàn hỗ trợ lái xe trên cao tốc Cấp độ 2"
        ],
        "description": "Phiên bản Eco của chiếc SUV cỡ lớn đầu bảng VF 9, đạt quãng đường kỷ lục 626 km (WLTP), động cơ 402 mã lực uy lực và khoang cabin 7 chỗ rộng rãi đẳng cấp.",
        "officialUrl": "https://vinfastauto.com/vn_vi/dat-coc-xe-vf9",
        "productCode": "VF9-ECO",
        "subCategory": "E-SUV Điện 7 Chỗ",
        "colorsSummary": "Xanh Deep Ocean, Trắng Brahminy, Đen Crimson",
        "excelSpecs": "Động cơ Điện kép 300 kW (402 HP), Mô-men xoắn 620 Nm, AWD",
        "excelStock": 8
    },
    {
        "id": "model-e",
        "name": "SIGMA Model E",
        "brand": "SIGMACAR",
        "subtitle": "Smart Electric Luxury SUV",
        "type": "new",
        "category": "SUV",
        "fuel": "ev",
        "price": 1290000000,
        "priceFormatted": "1.290.000.000 VNĐ",
        "priceShort": "1.290 tỷ",
        "badge": "Mới nhất",
        "range": 600,
        "power": "320 kW (430 HP)",
        "hp": 430,
        "torque": "650 Nm",
        "acceleration": "4.5s",
        "seats": 5,
        "battery": "90 kWh",
        "fastCharge": "25 phút (10-80%)",
        "topSpeed": "210 km/h",
        "transmission": "Hộp số điện tử trực tiếp 1 cấp",
        "powertrain": "Thuần điện Dual Motor AWD",
        "dimensions": "4.975 x 1.964 x 1.680 mm",
        "wheelbase": "2.960 mm",
        "groundClearance": "185 mm",
        "image": "assets/model-e.jpg",
        "stock": 20,
        "warranty": "5 năm / 150.000 km (Bảo hành Pin 8 năm)",
        "colors": [
            {
                "name": "Polar White",
                "hex": "#F8FAFC",
                "img": "assets/model-e.jpg"
            },
            {
                "name": "Deep Cobalt Blue",
                "hex": "#0066FF",
                "img": "assets/car-color-blue.jpg"
            },
            {
                "name": "Cosmic Charcoal",
                "hex": "#1E293B",
                "img": "assets/car-color-dark.jpg"
            },
            {
                "name": "Silver Arrow",
                "hex": "#94A3B8",
                "img": "assets/car-color-silver.jpg"
            }
        ],
        "features": [
            "Hệ thống trợ lái ADAS Cấp độ 2+",
            "Sigma Pilot tự động đỗ xe & giữ làn",
            "Màn hình cong OLED 15.6 inch",
            "Âm thanh vòm Sigma Audio 16 loa",
            "7 túi khí đa điểm thông minh",
            "Cửa sổ trời toàn cảnh Panorama chống UV"
        ],
        "description": "Mẫu SUV điện thông minh hàng đầu, kết hợp hoàn hảo giữa không gian gia đình rộng rãi, tiện nghi xa hoa và khả năng vận hành vượt trội trên mọi cung đường.",
        "productCode": "SIG-001",
        "subCategory": "SUV Điện Thông Minh",
        "colorsSummary": "Polar White, Deep Cobalt Blue, Cosmic Charcoal, Silver Arrow",
        "excelSpecs": "320 kW (430 HP)",
        "year": 2025,
        "excelStock": 20,
        "isAvailable": true
    },
    {
        "id": "vision-s",
        "name": "SIGMA Vision S",
        "brand": "SIGMACAR",
        "subtitle": "Grand Touring Electric Sedan",
        "type": "new",
        "category": "Sedan",
        "fuel": "ev",
        "price": 2150000000,
        "priceFormatted": "2.150.000.000 VNĐ",
        "priceShort": "2.150 tỷ",
        "badge": "Flagship",
        "range": 680,
        "power": "450 kW (600 HP)",
        "hp": 600,
        "torque": "850 Nm",
        "acceleration": "3.2s",
        "seats": 5,
        "battery": "105 kWh",
        "fastCharge": "20 phút (10-80%)",
        "topSpeed": "250 km/h",
        "transmission": "Hộp số điện tử 2 cấp hiệu năng cao",
        "powertrain": "Thuần điện Dual Motor Performance AWD",
        "dimensions": "5.050 x 1.980 x 1.440 mm",
        "wheelbase": "3.020 mm",
        "groundClearance": "145 mm",
        "image": "assets/vision-s.jpg",
        "stock": 15,
        "warranty": "5 năm / 150.000 km (Bảo hành Pin 8 năm)",
        "colors": [
            {
                "name": "Midnight Sapphire",
                "hex": "#002B66",
                "img": "assets/vision-s.jpg"
            },
            {
                "name": "Pure Pearl",
                "hex": "#FFFFFF",
                "img": "assets/model-e.jpg"
            },
            {
                "name": "Stealth Black",
                "hex": "#0F172A",
                "img": "assets/car-color-dark.jpg"
            }
        ],
        "features": [
            "Sigma Pilot 3.0 (Level 3 Autonomous Ready)",
            "Hệ dẫn động 4 bánh Dual Motor Performance",
            "Màn hình Panoramic Hyper-Display 31 inch",
            "Hệ thống âm thanh Sigma Diamond 4D (32 loa)",
            "Treo khí nén chủ động thích ứng",
            "Ghế da Semi-Aniline massage nhiệt đa điểm"
        ],
        "description": "Kiệt tác sedan thuần điện thế hệ mới, sở hữu thiết kế khí động học hoàn hảo và gia tốc siêu xe 0-100 km/h chỉ trong 3.2 giây.",
        "productCode": "SIG-002",
        "subCategory": "Sedan Điện Flagship",
        "colorsSummary": "Midnight Sapphire, Pure Pearl, Stealth Black",
        "excelSpecs": "450 kW (600 HP)",
        "year": 2025,
        "excelStock": 15,
        "isAvailable": true
    },
    {
        "id": "city-g",
        "name": "SIGMA City G",
        "brand": "SIGMACAR",
        "subtitle": "Urban Smart Electric Hatchback",
        "type": "new",
        "category": "Compact",
        "fuel": "ev",
        "price": 720000000,
        "priceFormatted": "720.000.000 VNĐ",
        "priceShort": "720 triệu",
        "badge": "Đô thị xanh",
        "range": 400,
        "power": "150 kW (200 HP)",
        "hp": 200,
        "torque": "310 Nm",
        "acceleration": "6.5s",
        "seats": 5,
        "battery": "54 kWh",
        "fastCharge": "28 phút (10-80%)",
        "topSpeed": "165 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Thuần điện Single Motor FWD",
        "dimensions": "4.150 x 1.780 x 1.540 mm",
        "wheelbase": "2.650 mm",
        "groundClearance": "160 mm",
        "image": "assets/city-g.jpg",
        "stock": 25,
        "warranty": "5 năm / 150.000 km (Bảo hành Pin 8 năm)",
        "colors": [
            {
                "name": "Lunar Silver",
                "hex": "#CBD5E1",
                "img": "assets/city-g.jpg"
            },
            {
                "name": "Neon Cyan",
                "hex": "#06B6D4",
                "img": "assets/car-color-blue.jpg"
            },
            {
                "name": "Solar Crimson",
                "hex": "#EF4444",
                "img": "assets/car-certified-1.jpg"
            }
        ],
        "features": [
            "Bán kính quay vòng cực nhỏ 4.9m",
            "Hỗ trợ đỗ xe tự động trong đô thị chật hẹp",
            "Màn hình kép 10.25 inch kết nối Apple CarPlay / Android Auto",
            "Hệ thống lọc không khí PM2.5 tạo ion âm",
            "Sạc điện thoại không dây chuẩn Qi"
        ],
        "description": "Giải pháp di chuyển thông minh, kinh tế và linh hoạt cho đô thị hiện đại, tiết kiệm chi phí tối đa và bảo vệ môi trường.",
        "productCode": "SIG-003",
        "subCategory": "Hatchback Đô Thị",
        "colorsSummary": "Lunar Silver, Neon Cyan, Solar Crimson",
        "excelSpecs": "150 kW (200 HP)",
        "year": 2025,
        "excelStock": 25,
        "isAvailable": true
    },
    {
        "id": "x-series-gt",
        "name": "SIGMA X-Series GT",
        "brand": "SIGMACAR",
        "subtitle": "High-Performance Super EV",
        "type": "new",
        "category": "SUV",
        "fuel": "ev",
        "price": 3150000000,
        "priceFormatted": "3.150.000.000 VNĐ",
        "priceShort": "3.150 tỷ",
        "badge": "Hyper Performance",
        "range": 580,
        "power": "507 kW (680 HP)",
        "hp": 680,
        "torque": "980 Nm",
        "acceleration": "3.4s",
        "seats": 5,
        "battery": "115 kWh",
        "fastCharge": "25 phút (10-80%)",
        "topSpeed": "260 km/h",
        "transmission": "Hộp số thể thao đa cấp điện tử",
        "powertrain": "Tri-Motor Performance AWD",
        "dimensions": "5.050 x 2.010 x 1.680 mm",
        "wheelbase": "3.020 mm",
        "groundClearance": "190 mm",
        "image": "assets/x-series.jpg",
        "stock": 10,
        "warranty": "5 năm / 150.000 km (Bảo hành Pin 8 năm)",
        "colors": [
            {
                "name": "Deep Cobalt GT",
                "hex": "#0047AB",
                "img": "assets/x-series.jpg"
            },
            {
                "name": "Shadow Onyx",
                "hex": "#000000",
                "img": "assets/car-color-dark.jpg"
            }
        ],
        "features": [
            "Tri-Motor Performance AWD",
            "Phanh gốm Carbon-Ceramic Brembo",
            "Hệ thống cánh gió chủ động Active Aero Wing",
            "Sigma Track Mode đo đạc vòng đua chuyên nghiệp",
            "12 túi khí bảo vệ toàn diện",
            "Hệ thống đánh lái 4 bánh góc xoay 10 độ"
        ],
        "description": "Mãnh thú hiệu năng cao, đại diện cho đỉnh cao kỹ thuật cơ điện tử và công nghệ lái tương lai của SIGMACAR.",
        "productCode": "SIG-004",
        "subCategory": "Super EV SUV",
        "colorsSummary": "Deep Cobalt GT, Shadow Onyx",
        "excelSpecs": "507 kW (680 HP)",
        "year": 2025,
        "excelStock": 10,
        "isAvailable": true
    },
    {
        "id": "grand-7",
        "name": "SIGMA Grand 7",
        "brand": "SIGMACAR",
        "subtitle": "Full-Size Luxury 7-Seat Family Electric SUV",
        "type": "new",
        "category": "SUV",
        "fuel": "ev",
        "price": 1790000000,
        "priceFormatted": "1.790.000.000 VNĐ",
        "priceShort": "1.790 tỷ",
        "badge": "7 Chỗ Gia Đình",
        "range": 650,
        "power": "380 kW (510 HP)",
        "hp": 510,
        "torque": "720 Nm",
        "acceleration": "4.2s",
        "seats": 7,
        "battery": "110 kWh",
        "fastCharge": "22 phút (10-80%)",
        "topSpeed": "220 km/h",
        "transmission": "Hộp số điện tử trực tiếp 1 cấp",
        "powertrain": "Thuần điện Dual Motor AWD",
        "dimensions": "5.180 x 2.010 x 1.780 mm",
        "wheelbase": "3.100 mm",
        "groundClearance": "195 mm",
        "image": "assets/family-7.jpg",
        "stock": 18,
        "warranty": "5 năm / 150.000 km (Bảo hành Pin 8 năm)",
        "colors": [
            {
                "name": "Champagne Gold",
                "hex": "#D4AF37",
                "img": "assets/family-7.jpg"
            },
            {
                "name": "Polar White",
                "hex": "#F8FAFC",
                "img": "assets/model-e.jpg"
            },
            {
                "name": "Stealth Black",
                "hex": "#0F172A",
                "img": "assets/car-color-dark.jpg"
            }
        ],
        "features": [
            "3 hàng ghế chỉnh điện gập phẳng thành giường đa năng",
            "Màn hình giải trí trần xe 17 inch 4K cho hàng ghế sau",
            "Hệ thống treo khí nén Magic Carpet thích ứng đa địa hình",
            "Điều hòa 3 vùng độc lập có màng lọc HEPA diệt khuẩn PM2.5",
            "Hệ thống âm thanh Sigma Symphony 20 loa vòm Dolby Atmos",
            "Cửa hít tự động 4 cánh và cốp điện đá chân thông minh"
        ],
        "description": "Mẫu SUV 7 chỗ thuần điện cỡ lớn đích thực, mang đến không gian rộng rãi vượt trội và sự thoải mái tối đa cho cả gia đình trên các chuyến đi xuyên Việt.",
        "productCode": "SIG-005",
        "subCategory": "SUV Điện 7 Chỗ",
        "colorsSummary": "Champagne Gold, Polar White, Stealth Black",
        "excelSpecs": "380 kW (510 HP)",
        "year": 2025,
        "excelStock": 18,
        "isAvailable": true
    },
    {
        "id": "aero-cross",
        "name": "SIGMA Aero Cross",
        "brand": "SIGMACAR",
        "subtitle": "Sport Dynamic Electric Crossover",
        "type": "new",
        "category": "Compact",
        "fuel": "ev",
        "price": 980000000,
        "priceFormatted": "980.000.000 VNĐ",
        "priceShort": "980 triệu",
        "badge": "Bán chạy nhất",
        "range": 480,
        "power": "210 kW (280 HP)",
        "hp": 280,
        "torque": "420 Nm",
        "acceleration": "5.8s",
        "seats": 5,
        "battery": "75 kWh",
        "fastCharge": "24 phút (10-80%)",
        "topSpeed": "190 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Thuần điện Single Motor Performance FWD",
        "dimensions": "4.650 x 1.880 x 1.620 mm",
        "wheelbase": "2.820 mm",
        "groundClearance": "180 mm",
        "image": "assets/aero-c.jpg",
        "stock": 22,
        "warranty": "5 năm / 150.000 km (Bảo hành Pin 8 năm)",
        "colors": [
            {
                "name": "Solar Crimson Red",
                "hex": "#DC2626",
                "img": "assets/aero-c.jpg"
            },
            {
                "name": "Cobalt Blue",
                "hex": "#0066FF",
                "img": "assets/car-color-blue.jpg"
            },
            {
                "name": "Pure White",
                "hex": "#FFFFFF",
                "img": "assets/model-e.jpg"
            }
        ],
        "features": [
            "Thiết kế khí động học vuốt cong phong cách Coupe Crossover",
            "Cửa sổ trời Panorama toàn cảnh phủ nano chống nóng",
            "Màn hình trung tâm xoay ngang dọc 15.6 inch thông minh",
            "Sạc không dây kép 50W có hệ thống làm mát chủ động",
            "Hỗ trợ lái thông minh ADAS 2.5 với 12 radar sóng milimet"
        ],
        "description": "Sự kết hợp hoàn hảo giữa gầm cao thể thao linh hoạt và cảm giác lái phấn khích, lựa chọn sáng giá cho giới trẻ năng động.",
        "productCode": "SIG-006",
        "subCategory": "Coupe Crossover Điện",
        "colorsSummary": "Solar Crimson Red, Cobalt Blue, Pure White",
        "excelSpecs": "210 kW (280 HP)",
        "year": 2025,
        "excelStock": 22,
        "isAvailable": true
    },
    {
        "id": "horizon-mpv",
        "name": "SIGMA Horizon MPV",
        "brand": "SIGMACAR",
        "subtitle": "Executive First-Class Electric Van",
        "type": "new",
        "category": "Compact",
        "fuel": "ev",
        "price": 1850000000,
        "priceFormatted": "1.850.000.000 VNĐ",
        "priceShort": "1.850 tỷ",
        "badge": "Khoang Thương Gia",
        "range": 560,
        "power": "300 kW (400 HP)",
        "hp": 400,
        "torque": "580 Nm",
        "acceleration": "5.2s",
        "seats": 7,
        "battery": "100 kWh",
        "fastCharge": "25 phút (10-80%)",
        "topSpeed": "200 km/h",
        "transmission": "Hộp số điện tử 1 cấp",
        "powertrain": "Thuần điện Dual Motor AWD",
        "dimensions": "5.280 x 1.990 x 1.850 mm",
        "wheelbase": "3.200 mm",
        "groundClearance": "165 mm",
        "image": "assets/van-v.jpg",
        "stock": 12,
        "warranty": "5 năm / 150.000 km (Bảo hành Pin 8 năm)",
        "colors": [
            {
                "name": "Arctic Pearl White",
                "hex": "#F8FAFC",
                "img": "assets/van-v.jpg"
            },
            {
                "name": "Phantom Black",
                "hex": "#000000",
                "img": "assets/car-color-dark.jpg"
            }
        ],
        "features": [
            "2 ghế cơ trưởng VIP Zero-Gravity bọc da Nappa massage 8 điểm",
            "Cửa trượt điện chống kẹt 2 bên tích hợp cảm biến rảnh tay",
            "Tủ lạnh mini 8.8 lít làm lạnh sâu -6 độ C",
            "Hệ thống cách âm kính 2 lớp tiêu âm chủ động ANC",
            "Rèm che nắng chỉnh điện và đèn viền nội thất 256 màu"
        ],
        "description": "Chuyên cơ mặt đất thuần điện dành cho giới thượng lưu và doanh nghiệp đón tiếp khách VIP với đẳng cấp đỉnh cao.",
        "productCode": "SIG-007",
        "subCategory": "MPV Điện Thương Gia",
        "colorsSummary": "Arctic Pearl White, Phantom Black",
        "excelSpecs": "300 kW (400 HP)",
        "year": 2025,
        "excelStock": 12,
        "isAvailable": true
    },
    {
        "id": "tesla-cybertruck",
        "productCode": "TSL-CT-01",
        "name": "Tesla Cybertruck",
        "brand": "Tesla",
        "version": "Dual-Motor AWD / Cyberbeast Tri-Motor",
        "subtitle": "Siêu Bán Tải Điện Khung Vỏ Thép Không Gỉ 30X & Steer-by-Wire",
        "type": "new",
        "category": "Pickup",
        "subCategory": "Bán tải Thuần Điện",
        "fuel": "ev",
        "price": 7500000000,
        "priceFormatted": "7.500.000.000 VNĐ",
        "priceShort": "7.5 tỷ",
        "salePrice": null,
        "salePriceFormatted": null,
        "priceNote": "Giá đại lý tư nhân nhập khẩu tham khảo tại VN (Bản AWD: 7.5 - 8.5 tỷ | Cyberbeast: 9.5 - 11.5 tỷ | RWD dự kiến: 3.8 - 4.5 tỷ VNĐ)",
        "badge": "Exoskeleton 800V",
        "range": 547,
        "rangeExtendedKm": 755,
        "hp": 845,
        "power": "Lên tới 845 HP (Cyberbeast Tri-Motor AWD) / 600 HP (Dual-Motor AWD)",
        "engine": "Dual-Motor AWD (600 HP) / Tri-Motor Cyberbeast (845 HP)",
        "powertrain": "Động cơ Điện Đa Mô-tơ AWD, Kiến trúc Điện 800V & 48V",
        "torque": "10.296 lb-ft (Cyberbeast) / 7.435 lb-ft (Dual-Motor AWD)",
        "acceleration": "2.6s (0-96 km/h Beast Mode)",
        "seats": 5,
        "battery": "Kiến trúc Pin 800V & Hệ thống điện phụ trợ 48V",
        "fastCharge": "Supercharger V4 (Sạc 15 phút đi được ~218 km)",
        "topSpeed": "209 km/h",
        "transmission": "Hộp số điện tử 1 cấp (Single-Speed Direct Drive)",
        "drive": "AWD / Dẫn động 4 bánh toàn thời gian & Đánh lái 4 bánh (4-Wheel Steering)",
        "dimensions": "5.682 x 2.200 x 1.791 mm",
        "wheelbase": "3.635 mm",
        "groundClearance": "Lên tới 443 mm (ở chế độ Extract Mode)",
        "dimensionsDetail": {
            "overall": "5.682 x 2.200 x 1.791 mm",
            "lengthMm": 5682,
            "widthMm": 2200,
            "widthUnfoldedMm": 2413,
            "heightMm": 1791,
            "wheelbase": "3.635 mm",
            "groundClearance": "Lên tới 443 mm (ở chế độ Extract Mode)",
            "curbWeight": "3.000 kg (AWD) - 3.100 kg (Cyberbeast)",
            "payloadCapacity": "Tối đa ~1.134 kg (2.500 lbs)",
            "towingCapacity": "4.990 kg (11.000 lbs)",
            "cargoVolume": "1.897 lít (kèm ngăn chứa phụ có khóa)"
        },
        "stock": 3,
        "excelStock": 3,
        "year": 2025,
        "warranty": "4 năm hoặc 80.000 km (Pin & Động cơ truyền động: 8 năm hoặc 240.000 km)",
        "warrantyDetail": {
            "policy": "4 năm hoặc 80.000 km (Pin & Động cơ truyền động: 8 năm hoặc 240.000 km)",
            "vehicleYears": 4,
            "vehicleKm": 80000,
            "batteryYears": 8,
            "batteryKm": 240000,
            "documentUrl": null
        },
        "image": "assets/vehicles/tesla-cybertruck/images/exterior/cover.jpg",
        "galleryImages": [
            "assets/vehicles/tesla-cybertruck/images/exterior/cover.jpg"
        ],
        "categorizedImages": {
            "exterior": [
                "assets/vehicles/tesla-cybertruck/images/exterior/cover.jpg"
            ],
            "interior": [],
            "dashboard": [],
            "engine": [],
            "specifications": [],
            "gallery": []
        },
        "colors": [
            {
                "name": "Thép Không Gỉ 30X Nguyên Bản (Stainless Steel)",
                "hex": "#94A3B8",
                "img": "assets/vehicles/tesla-cybertruck/images/exterior/cover.jpg"
            },
            {
                "name": "Đen Satin Chiến Thuật (Satin Stealth Black)",
                "hex": "#1E293B",
                "img": "assets/vehicles/tesla-cybertruck/images/exterior/cover.jpg"
            },
            {
                "name": "Trắng Satin Bắc Cực (Satin Ceramic White)",
                "hex": "#F1F5F9",
                "img": "assets/vehicles/tesla-cybertruck/images/exterior/cover.jpg"
            },
            {
                "name": "Xanh Rêu Quân Đội (Tactical Green Wrap)",
                "hex": "#3F6212",
                "img": "assets/vehicles/tesla-cybertruck/images/exterior/cover.jpg"
            }
        ],
        "colorsSummary": "Thép Không Gỉ 30X, Đen Satin, Trắng Satin, Xanh Chiến Thuật",
        "trims": [
            {
                "name": "Rear-Wheel Drive (Single-Motor RWD)",
                "drive": "RWD / Cầu sau",
                "hp": 315,
                "torque": "Tiêu chuẩn",
                "acceleration": "6.5s (0-96 km/h)",
                "topSpeed": "180 km/h",
                "rangeKm": 402,
                "msrpUsd": 60990,
                "price": 3800000000,
                "priceFormatted": "3.800.000.000 - 4.500.000.000 VNĐ",
                "note": "Giá niêm yết Mỹ ~60.990 USD | Dự kiến lăn bánh tư nhân tại VN"
            },
            {
                "name": "All-Wheel Drive (Dual-Motor AWD)",
                "drive": "AWD / 2 động cơ điện",
                "hp": 600,
                "torque": "7.435 lb-ft (tại bánh xe)",
                "acceleration": "4.1s (0-96 km/h)",
                "topSpeed": "180 km/h",
                "rangeKm": 547,
                "msrpUsd": 79990,
                "price": 7500000000,
                "priceFormatted": "7.500.000.000 - 8.500.000.000 VNĐ",
                "note": "Giá niêm yết Mỹ ~79.990 USD | Giá đại lý tư nhân nhập về VN"
            },
            {
                "name": "Cyberbeast (Tri-Motor AWD)",
                "drive": "AWD / 3 động cơ điện",
                "hp": 845,
                "torque": "10.296 lb-ft (tại bánh xe)",
                "acceleration": "2.6s (Beast Mode)",
                "topSpeed": "209 km/h",
                "rangeKm": 515,
                "msrpUsd": 99990,
                "price": 9500000000,
                "priceFormatted": "9.500.000.000 - 11.500.000.000 VNĐ",
                "note": "Giá niêm yết Mỹ ~99.990 USD | Phiên bản hiệu năng đỉnh cao Tri-Motor"
            }
        ],
        "evSpecs": {
            "batteryCapacity": "Kiến trúc Pin 800V & Hệ thống điện phụ trợ 48V",
            "rangeKm": 547,
            "rangeExtendedKm": 755,
            "fastCharge": "Supercharger V4 (Sạc 15 phút đi được ~218 km)",
            "architecture": "800V High-Voltage + 48V Low-Voltage Architecture",
            "v2x": "PowerShare V2H 11.5 kW liên tục & V2V (4 cổng 120V 20A + 1 cổng 240V 50A)"
        },
        "fuelConsumption": null,
        "safetyFeatures": [
            "Khung vỏ Exoskeleton: Thép không gỉ siêu cứng cán nguội 30X (Ultra-Hard 30X Cold-Rolled Stainless Steel) chống móp méo, rỉ sét và chống đạn súng ngắn phổ thông (9mm, .45 ACP)",
            "Kính Armor Glass: Kính composite cách âm cao cấp, chịu va đập mạnh từ đá dăm và tác động ngoại lực tốc độ cao",
            "Hệ thống lái điện tử Steer-by-Wire loại bỏ trục lái cơ học, biến thiên tỉ số truyền thông minh",
            "Hệ thống đánh lái 4 bánh (4-Wheel Steering) giúp bán kính quay vòng nhỏ hơn cả Tesla Model S",
            "Hệ thống treo khí nén chủ động (Adaptive Air Suspension) tự động cân bằng tải, nâng/hạ gầm hành trình 305 mm (khoảng sáng gầm tới 443 mm)"
        ],
        "comfortFeatures": [
            "Màn hình cảm ứng trung tâm 18.5 inch phía trước độ phân giải cao kết hợp màn hình phụ 9.4 inch cho hàng ghế sau",
            "Hệ thống âm thanh 15 loa phòng thu kết hợp 2 loa siêu trầm (subwoofer) và amply phân tán",
            "Màng lọc không khí HEPA tích hợp chế độ Bioweapon Defense Mode (chống vũ khí sinh học), lọc sạch 99.97% bụi mịn và vi khuẩn",
            "Công nghệ trạm phát điện di động PowerShare (V2H 11.5 kW cấp điện cho gia đình, V2V sạc xe sang xe, 4 cổng 120V + 1 cổng 240V)",
            "Nắp thùng cơ điện (Tonneau Cover) đóng/mở tự động chịu lực 100 kg và kính trần toàn cảnh Panoramic Glass Roof chống tia UV/hồng ngoại"
        ],
        "features": [
            "Khung vỏ Exoskeleton: Thép không gỉ siêu cứng cán nguội 30X (Ultra-Hard 30X Cold-Rolled Stainless Steel) chống móp méo, rỉ sét và chống đạn súng ngắn phổ thông (9mm, .45 ACP)",
            "Kính Armor Glass: Kính composite cách âm cao cấp, chịu va đập mạnh từ đá dăm và tác động ngoại lực tốc độ cao",
            "Hệ thống lái điện tử Steer-by-Wire loại bỏ trục lái cơ học, biến thiên tỉ số truyền thông minh",
            "Hệ thống đánh lái 4 bánh (4-Wheel Steering) giúp bán kính quay vòng nhỏ hơn cả Tesla Model S",
            "Hệ thống treo khí nén chủ động (Adaptive Air Suspension) tự động cân bằng tải, nâng/hạ gầm hành trình 305 mm (khoảng sáng gầm tới 443 mm)",
            "Màn hình cảm ứng trung tâm 18.5 inch phía trước độ phân giải cao kết hợp màn hình phụ 9.4 inch cho hàng ghế sau",
            "Hệ thống âm thanh 15 loa phòng thu kết hợp 2 loa siêu trầm (subwoofer) và amply phân tán",
            "Màng lọc không khí HEPA tích hợp chế độ Bioweapon Defense Mode (chống vũ khí sinh học), lọc sạch 99.97% bụi mịn và vi khuẩn",
            "Công nghệ trạm phát điện di động PowerShare (V2H 11.5 kW cấp điện cho gia đình, V2V sạc xe sang xe, 4 cổng 120V + 1 cổng 240V)",
            "Nắp thùng cơ điện (Tonneau Cover) đóng/mở tự động chịu lực 100 kg và kính trần toàn cảnh Panoramic Glass Roof chống tia UV/hồng ngoại"
        ],
        "description": "Siêu bán tải thuần điện mang thiết kế vị lai đột phá với khung vỏ Exoskeleton bằng thép không gỉ siêu cứng cán nguội 30X, kính Armor Glass, hệ thống lái điện tử Steer-by-Wire, đánh lái 4 bánh, kiến trúc 800V và trạm phát điện di động PowerShare 11.5 kW.",
        "excelSpecs": "Động cơ Điện Đa Mô-tơ AWD, Kiến trúc Điện 800V & 48V, 845 HP, AWD / Dẫn động 4 bánh toàn thời gian & Đánh lái 4 bánh (4-Wheel Steering)",
        "model3d": {
            "enabled": true,
            "glbPath": "assets/models/tesla_cybertruck.glb",
            "arSupported": true,
            "vrSupported": true,
            "scale": 1,
            "initialAngle": 137,
            "hotspots": [
                {
                    "id": "hotspot-exoskeleton",
                    "name": "Khung vỏ Exoskeleton Thép 30X",
                    "category": "Khung gầm & Vật liệu",
                    "pos": [
                        1.65,
                        0.55,
                        0.72
                    ],
                    "desc": "Thép không gỉ siêu cứng cán nguội 30X chống móp méo, rỉ sét và chống đạn súng ngắn phổ thông."
                },
                {
                    "id": "hotspot-armor-glass",
                    "name": "Kính Armor Glass & Màn hình 18.5\"",
                    "category": "Nội thất & An toàn",
                    "pos": [
                        0.2,
                        0.92,
                        0.55
                    ],
                    "desc": "Kính composite cách âm chịu va đập tốc độ cao cùng khoang lái màn hình 18.5 inch và lọc khí HEPA Bioweapon Defense Mode."
                },
                {
                    "id": "hotspot-wheels-4ws",
                    "name": "Đánh lái 4 Bánh & Treo Khí Nén",
                    "category": "Động lực học",
                    "pos": [
                        1.35,
                        0.35,
                        0.95
                    ],
                    "desc": "Hệ thống Steer-by-Wire kết hợp đánh lái 4 bánh (4-Wheel Steering) và treo khí nén chủ động nâng gầm tới 443 mm."
                },
                {
                    "id": "hotspot-vault-powershare",
                    "name": "Thùng xe Vault & PowerShare 11.5kW",
                    "category": "Năng lượng & Trọng tải",
                    "pos": [
                        -1.55,
                        0.68,
                        0.75
                    ],
                    "desc": "Thùng xe Vault 1.897 lít có nắp điện Tonneau Cover chịu lực 100kg, tích hợp ổ cắm 120V/240V và V2H 11.5 kW."
                }
            ]
        },
        "documents": {
            "specificationsPdf": "assets/vehicles/tesla-cybertruck/documents/specifications.pdf",
            "warrantyPdf": "assets/vehicles/tesla-cybertruck/documents/warranty.pdf"
        },
        "isAvailable": true,
        "statusText": "Nhận đặt hàng nhập khẩu",
        "officialUrl": "https://www.tesla.com/cybertruck",
        "thumbnail": "assets/vehicles/tesla-cybertruck/images/exterior/cover.jpg",
        "cover": "assets/vehicles/tesla-cybertruck/images/exterior/cover.jpg"
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
  if (!dbState.meta) dbState.meta = { version: '3.0.0' };
  dbState.meta.initializedAt = new Date().toISOString();
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

function ensureExtendedCollections() {
  const defaultCollections = [
    'certifiedVehicles', 'appointments',
    'returnRequests', 'warranties', 'serviceRecords', 'serviceAppointments',
    'reviews', 'questions', 'supportTickets', 'faqs', 'emailCampaigns', 'auditLogs'
  ];
  let needsSeed = false;
  for (const col of defaultCollections) {
    if (!Array.isArray(dbState[col])) {
      dbState[col] = [];
      needsSeed = true;
    }
  }

  if (!Array.isArray(dbState.certifiedVehicles) || dbState.certifiedVehicles.length === 0) {
    dbState.certifiedVehicles = [
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
    needsSeed = true;
  }

  if (needsSeed || dbState.faqs.length === 0 || dbState.warranties.length === 0) {
    // Backfill extended seed data without wiping existing vehicles
    const savedVehicles = dbState.vehicles;
    const savedCertified = dbState.certifiedVehicles;
    seedInitialData();
    if (Array.isArray(savedVehicles) && savedVehicles.length > 0) dbState.vehicles = savedVehicles;
    if (Array.isArray(savedCertified) && savedCertified.length > 0) dbState.certifiedVehicles = savedCertified;
    saveToDisk();
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

// Initialize on module load
loadFromDisk();

module.exports = {
  dbState,
  runInTransaction,
  saveToDisk,
  seedInitialData,
  reload: loadFromDisk
};
