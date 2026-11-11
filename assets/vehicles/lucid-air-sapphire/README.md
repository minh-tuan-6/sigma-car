# THÔNG TIN MẪU XE: LUCID LUCID AIR SAPPHIRE (2025)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
lucid-air-sapphire/
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

- **Mã sản phẩm**: `LCD-SAP-01`
- **Thương hiệu**: Lucid
- **Tên mẫu xe**: Lucid Air Sapphire
- **Phiên bản**: Tri-Motor AWD 1234 HP
- **Năm sản xuất**: 2025
- **Phân khúc**: Sedan (Siêu Sedan Thuần Điện Xa Xỉ Nhất Thế Giới)
- **Nhiên liệu**: Điện thuần (EV)
- **Giá niêm yết**: **6.500.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 3 Động cơ điện Lucid Tri-Motor (1 trước, 2 sau tích hợp bộ biến tần SiC)
- **Công suất cực đại**: 1.234 HP (920 kW), 3 Mô-tơ điện độc quyền
- **Mô-men xoắn cực đại**: 1.939 Nm tức thì
- **Tăng tốc (0 - 100 km/h)**: 1.89s (0-96 km/h không trừ 1-foot rollout)
- **Tốc độ tối đa**: 330 km/h
- **Hộp số**: Hộp số hành tinh đơn cấp tỉ số truyền thể thao
- **Hệ dẫn động**: AWD / Dẫn động 4 bánh với hệ thống điều hướng mô-men xoắn chủ động độc lập 2 bánh sau
- **Số chỗ ngồi**: 5 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.975 x 1.939 x 1.410 mm
- **Chiều dài cơ sở**: 2.960 mm
- **Khoảng sáng gầm xe**: 135 mm
- **Bảo hành**: 4 năm hoặc 80.000 km xe & 8 năm hoặc 160.000 km pin

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/lucid_air_sapphire.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
