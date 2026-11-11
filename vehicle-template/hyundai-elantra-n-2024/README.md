# THÔNG TIN MẪU XE: HYUNDAI HYUNDAI ELANTRA N (2024) (2024)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
hyundai-elantra-n-2024/
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

- **Mã sản phẩm**: `HYU-ELN-24`
- **Thương hiệu**: Hyundai
- **Tên mẫu xe**: Hyundai Elantra N (2024)
- **Phiên bản**: 2.0T Flat Power Facelift
- **Năm sản xuất**: 2024
- **Phân khúc**: Sedan (Sedan Thể Thao Thuần Đua Hiệu Năng Cao)
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **1.829.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 2.0L Turbo Flat Power GDI 4 xi-lanh
- **Công suất cực đại**: 280 HP (206 kW) / 290 HP khi kích hoạt NGS Mode
- **Mô-men xoắn cực đại**: 392 Nm @ 2.100 - 4.700 rpm
- **Tăng tốc (0 - 100 km/h)**: 5.3s
- **Tốc độ tối đa**: 250 km/h
- **Hộp số**: Ly hợp kép 8 cấp ướt (8-Speed Wet N DCT)
- **Hệ dẫn động**: FWD / Cầu trước + Vi sai chống trượt điện tử e-LSD (N Corner Carving Differential)
- **Số chỗ ngồi**: 5 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.675 x 1.825 x 1.415 mm
- **Chiều dài cơ sở**: 2.720 mm
- **Khoảng sáng gầm xe**: 136 mm
- **Bảo hành**: 5 năm hoặc 100.000 km chính hãng Hyundai Thành Công

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/hyundai_elantra_n_2024.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
