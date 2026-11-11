# THÔNG TIN MẪU XE: SUBARU SUBARU IMPREZA RS (2024) (2024)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
subaru-impreza-2024/
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

- **Mã sản phẩm**: `SUB-IMP-24`
- **Thương hiệu**: Subaru
- **Tên mẫu xe**: Subaru Impreza RS (2024)
- **Phiên bản**: RS 2.5L Symmetrical AWD (Thế hệ thứ 6)
- **Năm sản xuất**: 2024
- **Phân khúc**: Hatchback (Hatchback Dẫn Động 4 Bánh Toàn Thời Gian)
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **990.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 2.5L Boxer 4 xi-lanh nằm ngang Hút khí tự nhiên
- **Công suất cực đại**: 182 HP (136 kW) @ 5.800 rpm
- **Mô-men xoắn cực đại**: 241 Nm @ 3.700 rpm
- **Tăng tốc (0 - 100 km/h)**: 7.6s
- **Tốc độ tối đa**: 215 km/h
- **Hộp số**: Hộp số tự động vô cấp Lineartronic CVT với lẫy chuyển số 8 cấp
- **Hệ dẫn động**: AWD / Dẫn động 4 bánh toàn thời gian đối xứng Symmetrical AWD độc quyền
- **Số chỗ ngồi**: 5 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.480 x 1.780 x 1.480 mm
- **Chiều dài cơ sở**: 2.670 mm
- **Khoảng sáng gầm xe**: 135 mm
- **Bảo hành**: 5 năm hoặc 100.000 km chính hãng Subaru

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/subaru_impreza_2024.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
