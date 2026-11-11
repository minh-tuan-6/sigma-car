# THÔNG TIN MẪU XE: BUGATTI BUGATTI CHIRON (2024)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
bugatti-chiron/
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
```

---

## 2. Thông số kỹ thuật chính

- **Mã sản phẩm**: `BUG-CH-01`
- **Thương hiệu**: Bugatti
- **Tên mẫu xe**: Bugatti Chiron
- **Phiên bản**: W16 Quad-Turbo 1500 HP
- **Năm sản xuất**: 2024
- **Phân khúc**: Siêu Xe (Hypercar Độc Bản Xa Xỉ Nhất Thế Giới)
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **68.000.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 8.0L W16 Quad-Turbo (4 bộ tăng áp 2 giai đoạn)
- **Công suất cực đại**: 1.500 HP (1.103 kW) @ 6.700 rpm
- **Mô-men xoắn cực đại**: 1.600 Nm @ 2.000 - 6.000 rpm
- **Tăng tốc (0 - 100 km/h)**: 2.4s
- **Tốc độ tối đa**: 420 km/h (Giới hạn điện tử) / 490 km/h
- **Hộp số**: Ly hợp kép 7 cấp (7-Speed Dual-Clutch Ricardo)
- **Hệ dẫn động**: AWD / Dẫn động 4 bánh toàn thời gian thông minh
- **Số chỗ ngồi**: 2 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.544 x 2.038 x 1.212 mm
- **Chiều dài cơ sở**: 2.711 mm
- **Khoảng sáng gầm xe**: 115 mm (Hạ thấp 80 mm ở chế độ Top Speed)
- **Bảo hành**: Bảo hành toàn cầu không giới hạn của Bugatti Flying Doctor Service

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/bugatti_chiron.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
