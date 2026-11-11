# THÔNG TIN MẪU XE: VINFAST VINFAST VF 3 (2025)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
vinfast-vf3/
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

- **Mã sản phẩm**: `VNF-VF3-25`
- **Thương hiệu**: VinFast
- **Tên mẫu xe**: VinFast VF 3
- **Phiên bản**: Kèm Pin (Bản thương mại chính thức)
- **Năm sản xuất**: 2025
- **Phân khúc**: SUV (Mini SUV Thuần Điện Đô Thị Quốc Dân)
- **Nhiên liệu**: Điện thuần (EV)
- **Giá niêm yết**: **322.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 1 Mô-tơ điện Nam Châm Vĩnh Cửu đặt tại cầu sau
- **Công suất cực đại**: 43 HP (32 kW), Động cơ điện cầu sau RWD
- **Mô-men xoắn cực đại**: 110 Nm tức thì
- **Tăng tốc (0 - 100 km/h)**: 5.3s (0-50 km/h)
- **Tốc độ tối đa**: 100 km/h
- **Hộp số**: Hộp số điện tử 1 cấp
- **Hệ dẫn động**: RWD / Cầu sau
- **Số chỗ ngồi**: 4 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 3.190 x 1.679 x 1.622 mm
- **Chiều dài cơ sở**: 2.075 mm
- **Khoảng sáng gầm xe**: 191 mm (Cao nhất phân khúc mini car)
- **Bảo hành**: 7 năm hoặc 160.000 km cho xe & 8 năm không giới hạn km cho pin

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/vinfast_vf3.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
