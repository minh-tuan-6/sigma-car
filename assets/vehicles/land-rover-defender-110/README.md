# THÔNG TIN MẪU XE: LAND ROVER LAND ROVER DEFENDER 110 (2024)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
land-rover-defender-110/
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

- **Mã sản phẩm**: `LND-DF-110`
- **Thương hiệu**: Land Rover
- **Tên mẫu xe**: Land Rover Defender 110
- **Phiên bản**: 110 P400 3.0L MHEV X-Dynamic
- **Năm sản xuất**: 2024
- **Phân khúc**: SUV (SUV Địa Hình Hạng Sang Biểu Tượng Nước Anh)
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **4.999.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 3.0L i6 Turbocharged MHEV (Lai nhẹ 48V)
- **Công suất cực đại**: 400 HP (294 kW) @ 5.500 rpm
- **Mô-men xoắn cực đại**: 550 Nm @ 2.000 - 5.000 rpm
- **Tăng tốc (0 - 100 km/h)**: 6.1s
- **Tốc độ tối đa**: 191 km/h
- **Hộp số**: Tự động 8 cấp ZF với hộp số phụ 2 cấp (Twin-speed transfer box)
- **Hệ dẫn động**: AWD / 4WD Toàn thời gian thông minh + Khóa vi sai trung tâm & vi sai cầu sau chủ động
- **Số chỗ ngồi**: 7 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 5.018 x 2.008 x 1.967 mm
- **Chiều dài cơ sở**: 3.022 mm
- **Khoảng sáng gầm xe**: 291 mm (Treo khí nén nâng tối đa)
- **Bảo hành**: 3 năm hoặc 100.000 km chính hãng Land Rover Việt Nam

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/land_rover_defender_110.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
