# THÔNG TIN MẪU XE: TESLA TESLA CYBERTRUCK (2025)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
tesla-cybertruck/
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

- **Mã sản phẩm**: `TSL-CT-01`
- **Thương hiệu**: Tesla
- **Tên mẫu xe**: Tesla Cybertruck
- **Phiên bản**: Dual-Motor AWD / Cyberbeast Tri-Motor
- **Năm sản xuất**: 2025
- **Phân khúc**: Pickup (Bán Tải Thuần Điện Khung Thép 30X)
- **Nhiên liệu**: Điện thuần (EV)
- **Giá niêm yết**: **7.500.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: Dual-Motor AWD (600 HP) / Tri-Motor Cyberbeast (845 HP)
- **Công suất cực đại**: 600 HP (Dual-Motor) / 845 HP (Cyberbeast Tri-Motor)
- **Mô-men xoắn cực đại**: 10.296 lb-ft (Cyberbeast) / 7.435 lb-ft (Dual-Motor AWD)
- **Tăng tốc (0 - 100 km/h)**: 2.6s (Beast Mode)
- **Tốc độ tối đa**: 209 km/h
- **Hộp số**: Hộp số điện tử 1 cấp (Single-Speed Direct Drive)
- **Hệ dẫn động**: AWD / Dẫn động 4 bánh & Đánh lái 4 bánh Steer-by-Wire
- **Số chỗ ngồi**: 5 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 5.682 x 2.200 x 1.791 mm
- **Chiều dài cơ sở**: 3.635 mm
- **Khoảng sáng gầm xe**: 443 mm (Extract Mode)
- **Bảo hành**: 4 năm hoặc 80.000 km (Pin & Động cơ: 8 năm hoặc 240.000 km)

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/tesla_cybertruck.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
