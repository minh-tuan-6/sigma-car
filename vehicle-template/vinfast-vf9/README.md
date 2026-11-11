# THÔNG TIN MẪU XE: VINFAST VINFAST VF 9 PLUS 7 CHỖ (2025)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
vinfast-vf9/
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

- **Mã sản phẩm**: `VNF-VF9-PL`
- **Thương hiệu**: VinFast
- **Tên mẫu xe**: VinFast VF 9 Plus 7 Chỗ
- **Phiên bản**: Plus Dual-Motor AWD (Bản Kèm Pin)
- **Năm sản xuất**: 2025
- **Phân khúc**: SUV (Full-Size SUV Thuần Điện Hạng Sang)
- **Nhiên liệu**: Điện thuần (EV)
- **Giá niêm yết**: **2.169.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: Dual-Motor Permanent Magnet Synchronous (Trước & Sau)
- **Công suất cực đại**: 402 HP (300 kW), 2 Mô-tơ điện kép AWD
- **Mô-men xoắn cực đại**: 620 Nm tức thì
- **Tăng tốc (0 - 100 km/h)**: 6.5s
- **Tốc độ tối đa**: 200 km/h
- **Hộp số**: Hộp số điện tử 1 cấp
- **Hệ dẫn động**: AWD / Dẫn động 4 bánh toàn thời gian thông minh
- **Số chỗ ngồi**: 7 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 5.118 x 2.254 x 1.696 mm
- **Chiều dài cơ sở**: 3.150 mm (Dài nhất trong phân khúc E-SUV)
- **Khoảng sáng gầm xe**: 189 mm (Treo khí nén nâng hạ chủ động)
- **Bảo hành**: 10 năm hoặc 200.000 km cho xe & 10 năm không giới hạn km cho pin

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/vinfast_vf9.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
