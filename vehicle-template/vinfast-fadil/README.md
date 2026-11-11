# THÔNG TIN MẪU XE: VINFAST VINFAST FADIL (2022)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
vinfast-fadil/
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

- **Mã sản phẩm**: `VNF-FDL-22`
- **Thương hiệu**: VinFast
- **Tên mẫu xe**: VinFast Fadil
- **Phiên bản**: 1.4L Cao Cấp (Premium)
- **Năm sản xuất**: 2022
- **Phân khúc**: Hatchback (Xe Đô Thị Cỡ Nhỏ Hatchback Bán Chạy Nhất)
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **382.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 1.4L 4 xi-lanh thẳng hàng DOHC
- **Công suất cực đại**: 98 HP (72 kW) @ 6.200 rpm
- **Mô-men xoắn cực đại**: 128 Nm @ 4.400 rpm
- **Tăng tốc (0 - 100 km/h)**: 10.5s
- **Tốc độ tối đa**: 170 km/h
- **Hộp số**: Tự động vô cấp CVT êm ái
- **Hệ dẫn động**: FWD / Cầu trước
- **Số chỗ ngồi**: 5 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 3.676 x 1.632 x 1.530 mm
- **Chiều dài cơ sở**: 2.385 mm
- **Khoảng sáng gầm xe**: 150 mm
- **Bảo hành**: Bảo hành chính hãng 10 năm hoặc 200.000 km của VinFast

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/vinfast_fadil.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
