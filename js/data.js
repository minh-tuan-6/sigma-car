// Centralized database for SIGMACAR: Electric & Certified
const SIGMA_DATA = {
  "cars": [
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
      "image": "assets/vehicles/tesla-cybertruck/images/exterior/hero-front-34.svg",
      "galleryImages": [
        "assets/vehicles/tesla-cybertruck/images/exterior/hero-front-34.svg",
        "assets/vehicles/tesla-cybertruck/images/exterior/rear-vault-34.svg",
        "assets/vehicles/tesla-cybertruck/images/exterior/side-profile.svg",
        "assets/vehicles/tesla-cybertruck/images/interior/cabin-overview.svg",
        "assets/vehicles/tesla-cybertruck/images/dashboard/digital-cockpit.svg",
        "assets/vehicles/tesla-cybertruck/images/engine/powertrain-architecture.svg",
        "assets/vehicles/tesla-cybertruck/images/specifications/dimensions-blueprint.svg",
        "assets/vehicles/tesla-cybertruck/images/gallery/showroom-stage.svg"
      ],
      "categorizedImages": {
        "exterior": [
          "assets/vehicles/tesla-cybertruck/images/exterior/hero-front-34.svg",
          "assets/vehicles/tesla-cybertruck/images/exterior/rear-vault-34.svg",
          "assets/vehicles/tesla-cybertruck/images/exterior/side-profile.svg"
        ],
        "interior": [
          "assets/vehicles/tesla-cybertruck/images/interior/cabin-overview.svg"
        ],
        "dashboard": [
          "assets/vehicles/tesla-cybertruck/images/dashboard/digital-cockpit.svg"
        ],
        "engine": [
          "assets/vehicles/tesla-cybertruck/images/engine/powertrain-architecture.svg"
        ],
        "specifications": [
          "assets/vehicles/tesla-cybertruck/images/specifications/dimensions-blueprint.svg"
        ],
        "gallery": [
          "assets/vehicles/tesla-cybertruck/images/gallery/showroom-stage.svg"
        ]
      },
      "colors": [
        {
          "name": "Thép Không Gỉ 30X Nguyên Bản (Stainless Steel)",
          "hex": "#94A3B8",
          "img": "assets/vehicles/tesla-cybertruck/images/exterior/hero-front-34.svg"
        },
        {
          "name": "Đen Satin Chiến Thuật (Satin Stealth Black)",
          "hex": "#1E293B",
          "img": "assets/vehicles/tesla-cybertruck/images/exterior/rear-vault-34.svg"
        },
        {
          "name": "Trắng Satin Bắc Cực (Satin Ceramic White)",
          "hex": "#F1F5F9",
          "img": "assets/vehicles/tesla-cybertruck/images/exterior/side-profile.svg"
        },
        {
          "name": "Xanh Rêu Quân Đội (Tactical Green Wrap)",
          "hex": "#3F6212",
          "img": "assets/vehicles/tesla-cybertruck/images/exterior/hero-front-34.svg"
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
        "specificationsPdf": null,
        "warrantyPdf": null
      },
      "isAvailable": true,
      "statusText": "Nhận đặt hàng nhập khẩu",
      "officialUrl": "https://www.tesla.com/cybertruck"
    }
  ],
  "certifiedCars": [
    {
      "id": "cpo-1",
      "name": "SIGMA Model E Premium",
      "year": 2023,
      "vin": "VIN: 89J921K",
      "odo": "12.500 km",
      "odoNum": 12500,
      "price": 1050000000,
      "priceFormatted": "1.050.000.000 đ",
      "batteryHealth": "96%",
      "color": "Trắng / Nội thất Đen",
      "inspection": "176+ Điểm kiểm định",
      "warranty": "Gia hạn 12 tháng / 20.000 km",
      "category": "SUV",
      "image": "assets/car-used-1.jpg",
      "badge": "Certified Pre-Owned",
      "status": "Sẵn sàng bàn giao"
    },
    {
      "id": "cpo-2",
      "name": "SIGMA Vision S Executive",
      "year": 2022,
      "vin": "VIN: 45A772Q",
      "odo": "24.000 km",
      "odoNum": 24000,
      "price": 1680000000,
      "priceFormatted": "1.680.000.000 đ",
      "batteryHealth": "94%",
      "color": "Xanh Sapphire / Nội thất Kem",
      "inspection": "176+ Điểm kiểm định",
      "warranty": "Gia hạn 12 tháng / 20.000 km",
      "category": "Sedan",
      "image": "assets/car-used-2.jpg",
      "badge": "Certified Pre-Owned",
      "status": "Sẵn sàng bàn giao"
    },
    {
      "id": "cpo-3",
      "name": "SIGMA City G Smart",
      "year": 2024,
      "vin": "VIN: 12K551X",
      "odo": "3.500 km",
      "odoNum": 3500,
      "price": 720000000,
      "priceFormatted": "720.000.000 đ",
      "batteryHealth": "99%",
      "color": "Bạc Ánh Kim / Nội thất Xám",
      "inspection": "176+ Điểm kiểm định",
      "warranty": "Gia hạn 24 tháng / 40.000 km",
      "category": "Compact",
      "image": "assets/car-used-3.jpg",
      "badge": "Certified Siêu Lướt",
      "status": "Sẵn sàng bàn giao"
    },
    {
      "id": "cpo-4",
      "name": "SIGMA Model E Luxury",
      "year": 2022,
      "vin": "VIN: 77D443M",
      "odo": "18.200 km",
      "odoNum": 18200,
      "price": 1120000000,
      "priceFormatted": "1.120.000.000 đ",
      "batteryHealth": "95%",
      "color": "Đen Phantom / Nội thất Da bò",
      "inspection": "176+ Điểm kiểm định",
      "warranty": "Gia hạn 12 tháng / 20.000 km",
      "category": "SUV",
      "image": "assets/car-certified-2.jpg",
      "badge": "Certified Pre-Owned",
      "status": "Sẵn sàng bàn giao"
    },
    {
      "id": "cpo-5",
      "name": "SIGMA E-Vision Premium Special",
      "year": 2023,
      "vin": "VIN: 98P112A",
      "odo": "8.900 km",
      "odoNum": 8900,
      "price": 1180000000,
      "priceFormatted": "1.180.000.000 đ",
      "batteryHealth": "98%",
      "color": "Đỏ Ruby / Nội thất Đen Nappa",
      "inspection": "176+ Điểm kiểm định",
      "warranty": "Gia hạn 18 tháng / 30.000 km",
      "category": "SUV",
      "image": "assets/car-certified-1.jpg",
      "badge": "Certified Pre-Owned",
      "status": "Sẵn sàng bàn giao"
    }
  ],
  "branches": [
    {
      "id": "hn-caugiay",
      "name": "Showroom SIGMACAR Cầu Giấy (Hà Nội)",
      "address": "Số 68 Xuân Thủy, Dịch Vọng Hậu, Cầu Giấy, Hà Nội",
      "phone": "024 3888 9999"
    },
    {
      "id": "hn-mydinh",
      "name": "Showroom SIGMACAR Mỹ Đình (Hà Nội)",
      "address": "Số 8 Lê Quang Đạo, Mỹ Đình, Nam Từ Liêm, Hà Nội",
      "phone": "024 3777 8888"
    },
    {
      "id": "hcm-q7",
      "name": "Showroom SIGMACAR Quận 7 (TP.HCM)",
      "address": "Số 101 Nguyễn Thị Thập, Tân Phú, Quận 7, TP.HCM",
      "phone": "028 3999 7777"
    },
    {
      "id": "hcm-thuduc",
      "name": "Showroom SIGMACAR Thủ Đức (TP.HCM)",
      "address": "Xa lộ Hà Nội, Phường Thảo Điền, TP. Thủ Đức, TP.HCM",
      "phone": "028 3666 5555"
    },
    {
      "id": "dn-haichau",
      "name": "Showroom SIGMACAR Đà Nẵng",
      "address": "Số 234 Nguyễn Văn Linh, Hải Châu, Đà Nẵng",
      "phone": "0236 3555 444"
    }
  ],
  "testimonials": [
    {
      "name": "Nguyễn Minh Hoàng",
      "role": "Đã sở hữu SIGMA Model E",
      "avatar": "assets/avatar-user.jpg",
      "rating": 5,
      "content": "Trải nghiệm lái chiếc Model E thực sự tuyệt vời! Khả năng tăng tốc mượt mà, cách âm tĩnh lặng và hệ thống AI hỗ trợ lái rất thông minh. Tôi hoàn toàn yên tâm khi di chuyển cùng gia đình trên những hành trình dài xuyên Việt."
    },
    {
      "name": "Lê Thu Trang",
      "role": "Đã sở hữu SIGMA Vision S",
      "avatar": "assets/avatar-sales.jpg",
      "rating": 5,
      "content": "Vision S không chỉ là một chiếc xe, nó là một tác phẩm nghệ thuật công nghệ. Nội thất sang trọng, màn hình cong siêu rộng và hệ thống âm thanh vòm khiến mỗi phút giây trên xe đều là sự tận hưởng thuần túy."
    },
    {
      "name": "Phạm Thế Anh",
      "role": "Đã sở hữu SIGMA City G",
      "avatar": "assets/avatar-user.jpg",
      "rating": 5,
      "content": "City G là lựa chọn hoàn hảo cho việc di chuyển trong đô thị đông đúc. Bán kính quay vòng nhỏ, đỗ xe dễ dàng và chi phí sạc điện cực kỳ tiết kiệm so với chiếc xe xăng cũ của tôi."
    }
  ],
  "dashboard": {
    "monthlyRevenue": "4.280.000.000",
    "monthlyGrowth": "+12%",
    "newDepositsCount": 18,
    "todayTestDrives": 6,
    "supportRequests": 3,
    "topModel": "SIGMA Model E (Chiếm 45%)",
    "chartMonthly": [
      {
        "month": "T1",
        "revenue": 1600
      },
      {
        "month": "T2",
        "revenue": 1900
      },
      {
        "month": "T3",
        "revenue": 1750
      },
      {
        "month": "T4",
        "revenue": 2300
      },
      {
        "month": "T5",
        "revenue": 3100
      },
      {
        "month": "T6",
        "revenue": 4280
      }
    ],
    "segmentShares": [
      {
        "name": "SUV Electric",
        "share": 45,
        "color": "#0066FF"
      },
      {
        "name": "Sedan Grand",
        "share": 30,
        "color": "#3B82F6"
      },
      {
        "name": "Compact Urban",
        "share": 15,
        "color": "#60A5FA"
      },
      {
        "name": "Performance GT",
        "share": 10,
        "color": "#93C5FD"
      }
    ],
    "appointments": [
      {
        "id": "AP-101",
        "customer": "Nguyễn Văn Hùng",
        "phone": "0987 *** 456",
        "car": "SIGMA Model E (SUV)",
        "time": "Hôm nay, 14:30",
        "status": "Chờ xác nhận",
        "branch": "Hà Nội - Cầu Giấy"
      },
      {
        "id": "AP-102",
        "customer": "Trần Thị Lan",
        "phone": "0903 *** 123",
        "car": "SIGMA Vision S",
        "time": "Hôm nay, 16:00",
        "status": "Đã xác nhận",
        "branch": "Hà Nội - Mỹ Đình"
      },
      {
        "id": "AP-103",
        "customer": "Quách Mạnh Dũng",
        "phone": "0912 *** 888",
        "car": "SIGMA X-Series GT",
        "time": "Ngày mai, 09:00",
        "status": "Chưa đến lịch",
        "branch": "TP.HCM - Quận 7"
      },
      {
        "id": "AP-104",
        "customer": "Hoàng Minh Tuấn",
        "phone": "0945 *** 789",
        "car": "SIGMA City G",
        "time": "Ngày mai, 15:00",
        "status": "Đã xác nhận",
        "branch": "Đà Nẵng"
      }
    ]
  },
  "user": null,
  "accessories": [
    {
      "id": "ACC-001",
      "name": "Camera Hành Trình Vietmap KC01",
      "brand": "Vietmap",
      "category": "Thiết bị điện tử",
      "color": "Đen",
      "price": 4190000,
      "priceFormatted": "4.190.000 VNĐ",
      "specs": "Ghi hình 2K (trước) + Full HD (sau), Cảnh báo biển báo giao thông, Wi-Fi 5GHz, Cảm biến ảnh Sony Starvis",
      "year": 2024,
      "quantity": 25,
      "image": "assets/catalog/acc-vietmap.jpg",
      "badge": "Bán chạy nhất"
    },
    {
      "id": "ACC-002",
      "name": "Thảm Lót Sàn Ô Tô KATA Pro (5 Chỗ)",
      "brand": "KATA",
      "category": "Nội thất",
      "color": "Đen, Beige, Xám",
      "price": 1990000,
      "priceFormatted": "1.990.000 VNĐ",
      "specs": "Chất liệu PVC nguyên sinh cao cấp, Chống nước, Không mùi, Chuẩn phom từng dòng xe, Độ bền trên 10 năm",
      "year": 2023,
      "quantity": 50,
      "image": "assets/catalog/acc-kata.jpg",
      "badge": "Chính hãng KATA"
    },
    {
      "id": "ACC-003",
      "name": "Phim Cách Nhiệt 3M Crystalline Full Xe",
      "brand": "3M",
      "category": "Chăm sóc & Bảo vệ",
      "color": "Trong suốt / Trầm màu",
      "price": 16000000,
      "priceFormatted": "16.000.000 VNĐ",
      "specs": "Công nghệ quang học 200 lớp độc quyền, Cản tia hồng ngoại 97%, Chống tia UV 99.9%, Giảm nhiệt khoang lái đến 60%",
      "year": 2024,
      "quantity": 30,
      "image": "assets/catalog/acc-3m.jpg",
      "badge": "Cao cấp 3M"
    },
    {
      "id": "ACC-004",
      "name": "Bơm Lốp Ô Tô Tự Động Xiaomi 70mai TP03",
      "brand": "70mai",
      "category": "Cứu hộ & Tiện ích",
      "color": "Đen",
      "price": 750000,
      "priceFormatted": "750.000 VNĐ",
      "specs": "Áp suất tối đa 11 bar (160 psi), Màn hình kỹ thuật số hiển thị áp suất lốp, Dây dài 3.2m cắm tẩu 12V",
      "year": 2023,
      "quantity": 40,
      "image": "assets/catalog/acc-70mai.jpg",
      "badge": "Tiện ích khẩn cấp"
    },
    {
      "id": "ACC-005",
      "name": "Cảm Biến Áp Suất Lốp Steelmate E3 Pro",
      "brand": "Steelmate",
      "category": "Thiết bị an toàn",
      "color": "Đen",
      "price": 2800000,
      "priceFormatted": "2.800.000 VNĐ",
      "specs": "4 van cảm biến gắn trong chống trộm, Màn hình năng lượng mặt trời LCD, Cảnh báo rò rỉ khí/nhiệt độ tức thì",
      "year": 2024,
      "quantity": 20,
      "image": "assets/catalog/acc-steelmate.jpg",
      "badge": "An toàn hàng đầu"
    },
    {
      "id": "ACC-006",
      "name": "Bộ Tẩu Sạc Nhanh Ô Tô Anker 67W A2732",
      "brand": "Anker",
      "category": "Phụ kiện điện",
      "color": "Đen nhám",
      "price": 650000,
      "priceFormatted": "650.000 VNĐ",
      "specs": "2 cổng USB-C (PowerIQ 3.0), 1 cổng USB-A, Tổng công suất 67W, Sạc siêu nhanh Laptop/Điện thoại trên xe",
      "year": 2024,
      "quantity": 60,
      "image": "assets/catalog/acc-anker.jpg",
      "badge": "Sạc nhanh 67W"
    },
    {
      "id": "ACC-007",
      "name": "Nước Hoa Ô Tô Areon Car Perfume 50ml",
      "brand": "Areon",
      "category": "Nội thất & Tỏa hương",
      "color": "Vàng ánh kim",
      "price": 480000,
      "priceFormatted": "480.000 VNĐ",
      "specs": "Xuất xứ Bulgaria châu Âu, Hương Gold sang trọng tinh tế, Chiết xuất tinh dầu tự nhiên, Lưu hương 3-5 tháng",
      "year": 2023,
      "quantity": 35,
      "image": "assets/catalog/acc-areon.jpg",
      "badge": "Nhập khẩu Bulgaria"
    },
    {
      "id": "ACC-008",
      "name": "Bộ Kích Điện Bình Ắc Quy Baseus Super Energy 12000mAh",
      "brand": "Baseus",
      "category": "Cứu hộ & Khẩn cấp",
      "color": "Đen / Đỏ",
      "price": 1350000,
      "priceFormatted": "1.350.000 VNĐ",
      "specs": "Dòng khởi động cực đại 1000A, Kích bình xe máy xăng dưới 6.0L / máy dầu 3.5L, Tích hợp đèn pin cứu hộ SOS",
      "year": 2024,
      "quantity": 18,
      "image": "assets/catalog/acc-baseus.jpg",
      "badge": "Cứu hộ khẩn cấp"
    }
  ],
  "components": [
    {
      "id": "CMP-BAT-VF5",
      "type": "Pin cao áp",
      "name": "Pin khả dụng VF 5",
      "brand": "VinFast",
      "vehicle": "VF 5",
      "capacity": "37.23 kWh"
    },
    {
      "id": "CMP-BAT-VF6",
      "type": "Pin cao áp",
      "name": "Pin khả dụng VF 6",
      "brand": "VinFast",
      "vehicle": "VF 6 Eco / Plus",
      "capacity": "59.6 kWh"
    },
    {
      "id": "CMP-BAT-VF7",
      "type": "Pin cao áp",
      "name": "Pin khả dụng VF 7 Eco",
      "brand": "VinFast",
      "vehicle": "VF 7 Eco",
      "capacity": "59.6 kWh"
    },
    {
      "id": "CMP-BAT-VF8",
      "type": "Pin cao áp",
      "name": "Pin khả dụng VF 8",
      "brand": "VinFast",
      "vehicle": "VF 8 Eco / Plus",
      "capacity": "87.7 kWh"
    },
    {
      "id": "CMP-BAT-VF8AN",
      "type": "Pin cao áp",
      "name": "Pin khả dụng VF 8 Thế hệ mới",
      "brand": "VinFast",
      "vehicle": "VF 8 Thế hệ mới",
      "capacity": "60.13 kWh"
    },
    {
      "id": "CMP-BAT-VF9",
      "type": "Pin cao áp",
      "name": "Pin khả dụng VF 9",
      "brand": "VinFast",
      "vehicle": "VF 9 Eco / Plus",
      "capacity": "123 kWh"
    },
    {
      "id": "CMP-BAT-MPV7",
      "type": "Pin cao áp",
      "name": "Pin khả dụng VF MPV 7",
      "brand": "VinFast",
      "vehicle": "VF MPV 7",
      "capacity": "60.13 kWh"
    },
    {
      "id": "CMP-BRAKE-MPV7",
      "type": "Hệ thống phanh",
      "name": "Phanh trước/sau VF MPV 7",
      "brand": "VinFast",
      "vehicle": "VF MPV 7",
      "spec": "Đĩa thông gió / Đĩa"
    },
    {
      "id": "CMP-CHARGER-VF5",
      "type": "Bộ sạc / hệ thống sạc",
      "name": "Thông số sạc VF 5",
      "brand": "VinFast",
      "vehicle": "VF 5",
      "spec": "AC 6.6 kW / DC ~50 kW"
    },
    {
      "id": "CMP-CHARGER-VF6",
      "type": "Bộ sạc / hệ thống sạc",
      "name": "Thông số sạc VF 6",
      "brand": "VinFast",
      "vehicle": "VF 6 Eco / Plus",
      "spec": "AC 7.2 kW / DC 100 kW"
    },
    {
      "id": "CMP-CHARGER-MPV7",
      "type": "Bộ sạc / hệ thống sạc",
      "name": "Thông số sạc nhanh VF MPV 7",
      "brand": "VinFast",
      "vehicle": "VF MPV 7",
      "spec": "DC 80 kW"
    }
  ],
  "wheels": [
    {
      "id": "wheel-21-sport",
      "name": "21\" Sport Wheels",
      "label": "21\" Sport",
      "size": "21 inch",
      "price": 0,
      "desc": "Mâm đúc hợp kim đa chấu thể thao khí động học",
      "tag": "Tiêu chuẩn"
    },
    {
      "id": "wheel-20-aero",
      "name": "20\" Aero Wheels",
      "label": "20\" Aero",
      "size": "20 inch",
      "price": 25000000,
      "desc": "Tối ưu hóa tầm vận hành +25km",
      "tag": "Tiết kiệm năng lượng"
    },
    {
      "id": "wheel-22-forged",
      "name": "22\" Forged Performance",
      "label": "22\" Forged",
      "size": "22 inch",
      "price": 65000000,
      "desc": "Hợp kim nhôm rèn siêu nhẹ siêu cứng",
      "tag": "Hiệu năng cao"
    }
  ],
  "arHotspots": [
    {
      "id": "hotspot-led",
      "name": "Đèn pha Matrix LED",
      "x": 22,
      "y": 48,
      "desc": "Công nghệ chiếu sáng thích ứng chống chói thông minh với 84 bóng LED ma trận độc lập, tầm chiếu xa 600m."
    },
    {
      "id": "hotspot-interior",
      "name": "Nội thất da Nappa thủ công",
      "x": 52,
      "y": 42,
      "desc": "Ghế công thái học bọc da cao cấp tích hợp sưởi, thông gió đa tầng và 8 chế độ massage thư giãn."
    },
    {
      "id": "hotspot-wheels",
      "name": "Mâm đúc thể thao & Phanh Brembo",
      "x": 78,
      "y": 68,
      "desc": "Cùm phanh gốm Brembo 6 piston hiệu năng cao kết hợp đĩa phanh thông gió tăng tối đa an toàn phanh."
    }
  ],
  "arSampleBackgrounds": [
    {
      "id": "bg-1",
      "name": "Sân nhà biệt thự",
      "url": "assets/project3/sample-bg-1.jpg"
    },
    {
      "id": "bg-2",
      "name": "Gara gia đình hiện đại",
      "url": "assets/project3/sample-bg-2.jpg"
    },
    {
      "id": "bg-3",
      "name": "Đường nội khu cao cấp",
      "url": "assets/project3/sample-bg-3.jpg"
    },
    {
      "id": "bg-4",
      "name": "Khuôn viên ngoài trời",
      "url": "assets/project3/sample-bg-4.jpg"
    }
  ],
  "vehicleHealthDefaults": {
    "engine": {
      "score": 98,
      "status": "TỐT",
      "statusClass": "text-emerald-500",
      "barClass": "bg-emerald-500"
    },
    "brake": {
      "score": 72,
      "status": "CẦN LƯU Ý",
      "statusClass": "text-amber-500",
      "barClass": "bg-amber-500"
    },
    "electric": {
      "score": 95,
      "status": "TỐT",
      "statusClass": "text-emerald-500",
      "barClass": "bg-emerald-500"
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SIGMA_DATA };
}
