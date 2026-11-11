# THÔNG TIN MẪU XE: MAYBACH MAYBACH EXELERO (2005)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
maybach-exelero-2005/
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

- **Mã sản phẩm**: `MAY-EXE-05`
- **Thương hiệu**: Maybach
- **Tên mẫu xe**: Maybach Exelero
- **Phiên bản**: Coupe Độc Bản V12 Twin-Turbo (1 of 1)
- **Năm sản xuất**: 2005
- **Phân khúc**: Coupe (Siêu Coupe Độc Bản Đắt Giá Nhất Lịch Sử Maybach)
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **190.000.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 5.9L V12 Twin-Turbo (3 van mỗi xi-lanh)
- **Công suất cực đại**: 700 HP (515 kW) @ 5.000 rpm
- **Mô-men xoắn cực đại**: 1.020 Nm @ 2.500 rpm
- **Tăng tốc (0 - 100 km/h)**: 4.4s
- **Tốc độ tối đa**: 351.4 km/h (Kỷ lục thế giới trên đường đua Nardò)
- **Hộp số**: Tự động 5 cấp thể thao 5G-Tronic
- **Hệ dẫn động**: RWD / Cầu sau
- **Số chỗ ngồi**: 2 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 5.890 x 2.140 x 1.390 mm
- **Chiều dài cơ sở**: 3.390 mm
- **Khoảng sáng gầm xe**: 130 mm
- **Bảo hành**: Bảo dưỡng và xác thực độc bản bảo tàng Maybach Đức

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/maybach_exelero_2005.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
