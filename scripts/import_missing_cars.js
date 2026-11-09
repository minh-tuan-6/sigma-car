const fs = require('fs');
const path = require('path');

// Candidate cars to import (gained from about car analysis)
const missingCarsToImport = [
  {
    id: "vinfast-vf2",
    name: "VinFast VF 2",
    brand: "VinFast",
    subtitle: "Ô Tô Điện Đô Thị Nhỏ Gọn Thông Minh",
    category: "Compact",
    fuel: "ev",
    type: "new",
    price: 188000000,
    priceFormatted: "188.000.000 VNĐ",
    priceShort: "188 triệu",
    badge: "Giá tốt nhất",
    range: 210,
    hp: 40,
    power: "30 kW (40 HP), Mô-men xoắn 65 Nm, RWD",
    torque: "65 Nm",
    acceleration: "12.0s",
    seats: 4,
    battery: "Pin LFP",
    fastCharge: "34 phút (10-70%)",
    topSpeed: "100 km/h",
    transmission: "Hộp số điện tử 1 cấp",
    powertrain: "Động cơ Điện đơn RWD",
    drive: "RWD / Cầu sau",
    dimensions: "3.630 x 1.500 x 1.650 mm",
    wheelbase: "2.100 mm",
    groundClearance: "160 mm",
    stock: 20,
    year: 2024,
    warranty: "7 năm hoặc 160.000 km",
    image: "assets/catalog/car-vf2.jpg",
    isAvailable: true,
    colors: [
      { name: "Trắng Tiêu Chuẩn", hex: "#FFFFFF", img: "assets/catalog/car-vf2.jpg" },
      { name: "Bạc Ánh Kim", hex: "#94A3B8", img: "assets/catalog/car-vf2.jpg" },
      { name: "Đen Huyền Bí", hex: "#1E293B", img: "assets/catalog/car-vf2.jpg" }
    ],
    features: [
      "Thiết kế hatchback đô thị nhỏ gọn, bán kính quay vòng tối ưu",
      "Quãng đường di chuyển 210 km (chu trình chuẩn NEDC)",
      "Thời gian sạc nhanh 10-70% chỉ trong 34 phút",
      "Mức giá tiếp cận tốt nhất trong các dòng ô tô điện tại Việt Nam"
    ],
    description: "Mẫu xe điện đô thị mini tiện lợi, linh hoạt trong ngõ hẻm phố thị, chi phí sạc siêu tiết kiệm và thân thiện với môi trường.",
    officialUrl: "https://vinfastauto.com/vn_vi/dat-coc-xe-vf2"
  },
  {
    id: "vinfast-vf5",
    name: "VinFast VF 5 Plus",
    brand: "VinFast",
    subtitle: "SUV Điện Cỡ A Thông Minh & Trẻ Trung",
    category: "SUV",
    fuel: "ev",
    type: "new",
    price: 496000000,
    priceFormatted: "496.000.000 VNĐ",
    priceShort: "496 triệu",
    badge: "Bán chạy nhất",
    range: 326,
    hp: 134,
    power: "100 kW (134 HP), Mô-men xoắn 135 Nm, FWD",
    torque: "135 Nm",
    acceleration: "10.9s",
    seats: 5,
    battery: "37.23 kWh",
    fastCharge: "33 phút (10-70%)",
    topSpeed: "130 km/h",
    transmission: "Hộp số điện tử 1 cấp",
    powertrain: "Động cơ Điện đơn FWD",
    drive: "FWD / Cầu trước",
    dimensions: "3.967 x 1.723 x 1.579 mm",
    wheelbase: "2.513 mm",
    groundClearance: "182 mm",
    stock: 15,
    year: 2024,
    warranty: "7 năm hoặc 160.000 km",
    image: "assets/catalog/car-vf5.jpg",
    isAvailable: true,
    colors: [
      { name: "Xanh Nóc Trắng", hex: "#0066FF", img: "assets/catalog/car-vf5.jpg" },
      { name: "Trắng Brahminy", hex: "#FFFFFF", img: "assets/catalog/car-vf5.jpg" },
      { name: "Cam Nóc Trắng", hex: "#EA580C", img: "assets/catalog/car-vf5.jpg" }
    ],
    features: [
      "Dung lượng pin khả dụng 37.23 kWh, quãng đường 326 km (NEDC)",
      "Động cơ điện công suất 100 kW (134 HP) mạnh mẽ nhất phân khúc A-SUV",
      "Hệ thống hỗ trợ lái nâng cao ADAS và giám sát hành trình an toàn",
      "Thời gian sạc nhanh từ 10% đến 70% chỉ trong 33 phút"
    ],
    description: "Mẫu A-SUV thuần điện dẫn đầu doanh số đô thị, khoang cabin 5 chỗ rộng rãi, công nghệ kết nối thông minh và chi phí năng lượng cực thấp.",
    officialUrl: "https://vinfastauto.com/vn_vi/dat-coc-xe-dien-vf5"
  },
  {
    id: "vinfast-vf6",
    name: "VinFast VF 6 Eco/Plus",
    brand: "VinFast",
    subtitle: "SUV Điện Cỡ B Thời Thượng & Đẳng Cấp",
    category: "SUV",
    fuel: "ev",
    type: "new",
    price: 646000000,
    priceFormatted: "646.000.000 VNĐ",
    priceShort: "646 triệu",
    badge: "Thiết kế Ý",
    range: 485,
    hp: 174,
    power: "130 kW - 150 kW (174 - 201 HP), Mô-men xoắn 250 - 310 Nm, FWD",
    torque: "250 Nm",
    acceleration: "8.5s",
    seats: 5,
    battery: "59.6 kWh",
    fastCharge: "25 phút (10-70%)",
    topSpeed: "160 km/h",
    transmission: "Hộp số điện tử 1 cấp",
    powertrain: "Động cơ Điện đơn FWD",
    drive: "FWD / Cầu trước",
    dimensions: "4.241 x 1.834 x 1.580 mm",
    wheelbase: "2.730 mm",
    groundClearance: "170 mm",
    stock: 12,
    year: 2024,
    warranty: "7 năm hoặc 160.000 km",
    image: "assets/catalog/car-vf6.jpg",
    isAvailable: true,
    colors: [
      { name: "Đỏ Crimson Red", hex: "#B91C1C", img: "assets/catalog/car-vf6.jpg" },
      { name: "Trắng Brahminy", hex: "#FFFFFF", img: "assets/catalog/car-vf6.jpg" },
      { name: "Xanh Deep Ocean", hex: "#0369A1", img: "assets/catalog/car-vf6.jpg" }
    ],
    features: [
      "Thiết kế ngoại thất tinh tế do studio Torino Design lừng danh chắp bút",
      "Pin dung lượng 59.6 kWh cho quãng đường di chuyển lên đến 485 km (NEDC)",
      "Công suất lên tới 201 HP và mô-men xoắn tức thời 310 Nm",
      "Sạc nhanh siêu tốc 10-70% chỉ trong 25 phút"
    ],
    description: "Mẫu B-SUV điện sang trọng, không gian nội thất tối giản với màn hình 12.9 inch hướng về người lái, mang đến cảm giác lái phấn khích và an tâm tuyệt đối.",
    officialUrl: "https://vinfastauto.com/vn_vi/dat-coc-xe-dien-vf6"
  },
  {
    id: "vinfast-vf-mpv7",
    name: "VinFast VF MPV 7",
    brand: "VinFast",
    subtitle: "MPV Điện 7 Chỗ Gia Đình Hiện Đại & Tiện Nghi",
    category: "Compact",
    fuel: "ev",
    type: "new",
    price: 750000000,
    priceFormatted: "750.000.000 VNĐ",
    priceShort: "750 triệu",
    badge: "Gia đình 7 chỗ",
    range: 450,
    hp: 201,
    power: "150 kW (201 HP), Mô-men xoắn 280 Nm, FWD",
    torque: "280 Nm",
    acceleration: "9.2s",
    seats: 7,
    battery: "60.13 kWh",
    fastCharge: "30 phút (10-70%)",
    topSpeed: "150 km/h",
    transmission: "Hộp số điện tử 1 cấp",
    powertrain: "Động cơ Điện đơn FWD",
    drive: "FWD / Cầu trước",
    dimensions: "4.740 x 1.872 x 1.734 mm",
    wheelbase: "2.860 mm",
    groundClearance: "175 mm",
    stock: 10,
    year: 2024,
    warranty: "7 năm hoặc 160.000 km",
    image: "assets/catalog/car-vfmpv7.jpg",
    isAvailable: true,
    colors: [
      { name: "Bạc Moonlight", hex: "#D1D5DB", img: "assets/catalog/car-vfmpv7.jpg" },
      { name: "Trắng Pearl", hex: "#FFFFFF", img: "assets/catalog/car-vfmpv7.jpg" },
      { name: "Đen Obsidian", hex: "#1E293B", img: "assets/catalog/car-vfmpv7.jpg" }
    ],
    features: [
      "Cấu hình 7 chỗ thực thụ rộng rãi, gập ghế phẳng đa dụng linh hoạt",
      "Động cơ điện công suất 150 kW (201 HP) êm ái khi chở đủ tải",
      "Quãng đường di chuyển 450 km (NEDC) sẵn sàng cho hành trình liên tỉnh",
      "Công nghệ sạc nhanh 10-70% trong 30 phút tiện lợi trên mọi trạm sạc"
    ],
    description: "Xe đa dụng MPV 7 chỗ thuần điện lý tưởng cho các gia đình hiện đại và dịch vụ vận chuyển cao cấp, mang lại trải nghiệm êm ái, yên tĩnh không tiếng ồn động cơ.",
    officialUrl: "https://vinfastauto.com/vn_vi/dat-coc-xe-vf-mpv7"
  }
];

function runImport() {
  console.log('--- EXECUTING IDEMPOTENT VEHICLE IMPORT ---');
  
  // 1. Update data/sigmacar_store.json
  const storePath = path.join(__dirname, '..', 'data', 'sigmacar_store.json');
  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  
  let insertedCount = 0;
  let skippedCount = 0;

  for (const car of missingCarsToImport) {
    const exists = store.vehicles.some(v => v.id === car.id || v.name.toLowerCase() === car.name.toLowerCase());
    if (exists) {
      console.log(`[SKIP] Car already exists in store: ${car.id} (${car.name})`);
      skippedCount++;
    } else {
      store.vehicles.push(car);
      console.log(`[INSERT] Added car to store: ${car.id} (${car.name}) - Giá: ${car.priceFormatted}`);
      insertedCount++;
    }
  }

  if (insertedCount > 0) {
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
    console.log(`Saved ${insertedCount} new vehicles to data/sigmacar_store.json (Total now: ${store.vehicles.length})`);
  } else {
    console.log('No new vehicles to insert in store. Database unchanged.');
  }

  // 2. Update js/data.js (Static Frontend database)
  const dataJsPath = path.join(__dirname, '..', 'js', 'data.js');
  let dataJsContent = fs.readFileSync(dataJsPath, 'utf8');

  // Verify which cars are in data.js
  let jsInsertedCount = 0;
  for (const car of missingCarsToImport) {
    if (!dataJsContent.includes(`"id": "${car.id}"`) && !dataJsContent.includes(`id: "${car.id}"`)) {
      // Find insertion point before certifiedCars
      const targetMarker = 'certifiedCars: [';
      const insertIdx = dataJsContent.indexOf(targetMarker);
      if (insertIdx !== -1) {
        // Find the closing bracket before certifiedCars: [
        const prevArrayEnd = dataJsContent.lastIndexOf('],', insertIdx);
        if (prevArrayEnd !== -1) {
          const carJson = ',\n    ' + JSON.stringify(car, null, 4).replace(/\n/g, '\n    ');
          dataJsContent = dataJsContent.slice(0, prevArrayEnd) + carJson + '\n  ' + dataJsContent.slice(prevArrayEnd);
          jsInsertedCount++;
          console.log(`[INSERT] Added car to js/data.js: ${car.id}`);
        }
      }
    } else {
      console.log(`[SKIP] Car already exists in js/data.js: ${car.id}`);
    }
  }

  if (jsInsertedCount > 0) {
    fs.writeFileSync(dataJsPath, dataJsContent, 'utf8');
    console.log(`Saved ${jsInsertedCount} new vehicles to js/data.js`);
  }

  // 3. Sync to AIService / Live RAG
  try {
    const AIService = require('../backend/application/ai-service');
    if (AIService && AIService.learnVehicle) {
      for (const car of missingCarsToImport) {
        AIService.learnVehicle(car);
      }
      console.log('Synchronized newly imported vehicles to AI Live RAG knowledge base.');
    }
  } catch (err) {
    console.log('AIService sync skipped/not needed:', err.message);
  }

  console.log('\n--- IMPORT SUMMARY ---');
  console.log(`Candidates evaluated: ${missingCarsToImport.length}`);
  console.log(`Newly inserted: ${insertedCount}`);
  console.log(`Skipped existing: ${skippedCount}`);
  console.log(`Total vehicles in store now: ${store.vehicles.length}`);
}

runImport();
