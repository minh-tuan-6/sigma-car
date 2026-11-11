const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const UNPACKED_DIR = path.join(ROOT_DIR, 'Xe_unpacked');
const VEHICLE_TEMPLATE_ROOT = path.join(ROOT_DIR, 'vehicle-template');
const ASSETS_VEHICLES_DIR = path.join(ROOT_DIR, 'assets', 'vehicles');
const DATA_JS_PATH = path.join(ROOT_DIR, 'js', 'data.js');

const data = require(DATA_JS_PATH).SIGMA_DATA;

function walkFiles(dir, list = []) {
  if (!fs.existsSync(dir)) return list;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__MACOSX' || entry.name.startsWith('._')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, list);
    else if (entry.isFile()) list.push(full);
  }
  return list;
}

const MAPPINGS = [
  { folder: '1991-Honda-CivicEG6', id: 'honda-civic-eg6-1991' },
  { folder: '2018-Honda-CivicTypeR', id: 'honda-civic-type-r-2018' },
  { folder: 'Bugatti_Chiron', id: 'bugatti-chiron' },
  { folder: 'Ferrari_F50 1995', id: 'ferrari-f50-1995' },
  { folder: 'Honda-Civic_RS', id: 'honda-civic-rs' },
  { folder: 'Honda_Accord-Euro-R', id: 'honda-accord-euro-r' },
  { folder: 'Honda_Prelude BP1', id: 'honda-prelude-bp1' },
  { folder: 'Huyndai_2024-Elantra-N', id: 'hyundai-elantra-n-2024' },
  { folder: 'Lamborghini-Aventador_LP750-4_SV', id: 'lamborghini-aventador-sv' },
  { folder: 'Lamborghini_Terzo-Millennio', id: 'lamborghini-terzo-millennio' },
  { folder: 'Land Rover_Land-Rover-Defender', id: 'land-rover-defender-110' },
  { folder: 'Lucid_AirSapphire', id: 'lucid-air-sapphire' },
  { folder: 'Maybach_2005-Exelero', id: 'maybach-exelero-2005' },
  { folder: 'Porsche_911-Carrera-4S-2024', id: 'porsche-911-carrera-4s-2024' },
  { folder: 'Rolls_Royce-Boattail', id: 'rolls-royce-boat-tail' },
  { folder: 'Subaru_Subaru-Impreza-2024', id: 'subaru-impreza-2024' },
  { folder: 'Suzuki_2021-Suzuki-Ciaz', id: 'suzuki-ciaz-2021' },
  { folder: 'Tesla-Cybertruck', id: 'tesla-cybertruck' },
  { folder: 'Tesla-Roadster2.0', id: 'tesla-roadster-2' },
  { folder: 'Toyota_Camry', id: 'toyota-camry' },
  { folder: 'Vinfast-Fadil', id: 'vinfast-fadil' },
  { folder: 'Vinfast-lux', id: 'vinfast-lux-a20' },
  { folder: 'Vinfast-VF3', id: 'vinfast-vf3' },
  { folder: 'Vinfast-Vf9', id: 'vinfast-vf9' }
];

console.log('🚀 Bắt đầu hoàn thiện 100% tài nguyên theo vehicle-template cho 24 xe...');

MAPPINGS.forEach(({ folder, id }, index) => {
  const car = data.cars.find(c => c.id === id);
  if (!car) {
    console.error(`Không tìm thấy car [${id}]`);
    return;
  }

  const folderPath = path.join(UNPACKED_DIR, folder);
  const tplDir = path.join(VEHICLE_TEMPLATE_ROOT, id);
  const assetDir = path.join(ASSETS_VEHICLES_DIR, id);

  const tplDataDir = path.join(tplDir, 'data');
  const assetDataDir = path.join(assetDir, 'data');
  if (!fs.existsSync(tplDataDir)) fs.mkdirSync(tplDataDir, { recursive: true });
  if (!fs.existsSync(assetDataDir)) fs.mkdirSync(assetDataDir, { recursive: true });

  // 1. Locate and copy data.txt
  const allFiles = walkFiles(folderPath);
  const dataTxtFile = allFiles.find(f => /data\.txt$/i.test(path.basename(f)));
  if (dataTxtFile) {
    const rawTxt = fs.readFileSync(dataTxtFile, 'utf8');
    fs.writeFileSync(path.join(tplDataDir, 'data.txt'), rawTxt, 'utf8');
    fs.writeFileSync(path.join(assetDataDir, 'data.txt'), rawTxt, 'utf8');
  }

  // 2. Generate comprehensive README.md in vehicle-template/<id>/README.md
  const readmeContent = `# THÔNG TIN MẪU XE: ${car.brand.toUpperCase()} ${car.name.toUpperCase()} (${car.year})

Thư mục này tuân thủ cấu trúc chuẩn **\`vehicle-template\`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

\`\`\`text
${id}/
│
├── vehicle.json                  # Schema thông số kỹ thuật chuẩn v1.0.0
├── README.md                     # Tài liệu giới thiệu & nguồn dữ liệu xe
│
├── images/                       # Bộ ảnh độ phân giải cao đã phân loại
│   ├── exterior/                 # Ảnh chụp ngoại thất (góc 3/4 trước, hông xe, đuôi xe)
│   ├── interior/                 # Ảnh chụp nội thất khoang lái & hành khách
│   ├── dashboard/                # Vô lăng, cụm đồng hồ & màn hình điều khiển
│   ├── engine/                   # Động cơ / Cụm mô tơ điện / Khung gầm
│   ├── specifications/           # Kích thước, sơ đồ kỹ thuật
│   └── gallery/                  # Bộ ảnh tổng hợp
│
├── 3d/                           # Mô hình 3D tương tác AR/VR
│   └── model.glb                 # File 3D chuẩn glTF 2.0 PBR
│
├── documents/                    # Tài liệu chính hãng
│   ├── specifications.pdf        # Thông số kỹ thuật chi tiết
│   └── warranty.pdf              # Chính sách bảo hành
│
└── data/
    └── data.txt                  # Dữ liệu nguồn trích xuất từ nhà sản xuất
\`\`\`

---

## 2. Thông số kỹ thuật chính

- **Mã sản phẩm**: \`${car.productCode || id}\`
- **Thương hiệu**: ${car.brand}
- **Tên mẫu xe**: ${car.name}
- **Phiên bản**: ${car.version || 'Tiêu chuẩn'}
- **Năm sản xuất**: ${car.year}
- **Phân khúc**: ${car.category} (${car.subCategory || ''})
- **Nhiên liệu**: ${car.fuel === 'ev' ? 'Điện thuần (EV)' : car.fuel === 'hybrid' ? 'Hybrid (Xăng + Điện)' : 'Xăng cao cấp'}
- **Giá niêm yết**: **${car.priceFormatted || car.price.toLocaleString('vi-VN') + ' VNĐ'}**
- **Động cơ / Hệ truyền động**: ${car.engine || car.powertrain || 'Đang cập nhật'}
- **Công suất cực đại**: ${car.power || car.hp + ' HP'}
- **Mô-men xoắn cực đại**: ${car.torque || 'Đang cập nhật'}
- **Tăng tốc (0 - 100 km/h)**: ${car.acceleration || 'Đang cập nhật'}
- **Tốc độ tối đa**: ${car.topSpeed || 'Đang cập nhật'}
- **Hộp số**: ${car.transmission || 'Tự động'}
- **Hệ dẫn động**: ${car.drive || 'Cầu trước (FWD)'}
- **Số chỗ ngồi**: ${car.seats} chỗ
- **Kích thước (Dài x Rộng x Cao)**: ${car.dimensions || (car.dimensionsDetail ? car.dimensionsDetail.overall : 'Đang cập nhật')}
- **Chiều dài cơ sở**: ${car.wheelbase || 'Đang cập nhật'}
- **Khoảng sáng gầm xe**: ${car.groundClearance || 'Đang cập nhật'}
- **Bảo hành**: ${car.warranty || 'Chính hãng'}

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: \`${car.model3d?.glbPath || 'assets/models/' + id.replace(/-/g, '_') + '.glb'}\`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
\`\`\`bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
\`\`\`
`;

  fs.writeFileSync(path.join(tplDir, 'README.md'), readmeContent, 'utf8');
  fs.writeFileSync(path.join(assetDir, 'README.md'), readmeContent, 'utf8');

  console.log(`[${index + 1}/24] ✓ Đã hoàn thiện vehicle-template cho: ${id}`);
});

console.log('\n🎉 Hoàn thành cập nhật tài nguyên 24 xe theo template!');
