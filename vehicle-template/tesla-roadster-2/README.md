# THÔNG TIN MẪU XE: TESLA TESLA ROADSTER 2.0 (2026)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
tesla-roadster-2/
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

- **Mã sản phẩm**: `TSL-RD2-26`
- **Thương hiệu**: Tesla
- **Tên mẫu xe**: Tesla Roadster 2.0
- **Phiên bản**: SpaceX Package Tri-Motor 10000 Nm
- **Năm sản xuất**: 2026
- **Phân khúc**: Siêu Xe (Siêu Xe Điện Nhanh Nhất Thế Giới)
- **Nhiên liệu**: Điện thuần (EV)
- **Giá niêm yết**: **5.900.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: Tri-Motor Plaid Electric Powertrain
- **Công suất cực đại**: Hơn 1.000 HP, 3 Mô-tơ điện (1 trước, 2 sau)
- **Mô-men xoắn cực đại**: 10.000 Nm (Mô-men xoắn tại bánh xe)
- **Tăng tốc (0 - 100 km/h)**: 1.1s (với gói tên lửa SpaceX Package) / 1.9s tiêu chuẩn
- **Tốc độ tối đa**: Hơn 400 km/h
- **Hộp số**: Hộp số truyền động trực tiếp 1 cấp
- **Hệ dẫn động**: AWD / Dẫn động 4 bánh toàn thời gian với điều hướng lực kéo
- **Số chỗ ngồi**: 4 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.450 x 1.950 x 1.200 mm
- **Chiều dài cơ sở**: 2.650 mm
- **Khoảng sáng gầm xe**: 120 mm
- **Bảo hành**: 4 năm hoặc 80.000 km xe & 8 năm bảo hành Pin 200 kWh

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/tesla_roadster_2.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
