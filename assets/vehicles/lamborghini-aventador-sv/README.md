# THÔNG TIN MẪU XE: LAMBORGHINI LAMBORGHINI AVENTADOR LP750-4 SV (2017)

Thư mục này tuân thủ cấu trúc chuẩn **`vehicle-template`** của hệ thống thương mại điện tử ô tô SIGMACAR.

---

## 1. Cấu trúc thư mục

```text
lamborghini-aventador-sv/
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

- **Mã sản phẩm**: `LAM-AVSV-16`
- **Thương hiệu**: Lamborghini
- **Tên mẫu xe**: Lamborghini Aventador LP750-4 SV
- **Phiên bản**: SuperVeloce V12 750 HP (Giới hạn 600 chiếc)
- **Năm sản xuất**: 2017
- **Phân khúc**: Siêu Xe (Siêu Xe Động Cơ V12 Hút Khí Tự Nhiên Đỉnh Cao)
- **Nhiên liệu**: Xăng cao cấp
- **Giá niêm yết**: **38.000.000.000 VNĐ**
- **Động cơ / Hệ truyền động**: 6.5L V12 Hút khí tự nhiên (Natural Aspirated)
- **Công suất cực đại**: 750 HP (552 kW) @ 8.400 rpm
- **Mô-men xoắn cực đại**: 690 Nm @ 5.500 rpm
- **Tăng tốc (0 - 100 km/h)**: 2.8s
- **Tốc độ tối đa**: 350 km/h
- **Hộp số**: Bán tự động 7 cấp Independent Shifting Rods (ISR) chuyển số trong 50ms
- **Hệ dẫn động**: AWD / Dẫn động 4 bánh toàn thời gian Haldex
- **Số chỗ ngồi**: 2 chỗ
- **Kích thước (Dài x Rộng x Cao)**: 4.835 x 2.030 x 1.136 mm
- **Chiều dài cơ sở**: 2.700 mm
- **Khoảng sáng gầm xe**: 115 mm (Có hệ thống nâng mũi xe Hydraulic Lift)
- **Bảo hành**: Bảo hành chính hãng Lamborghini và chứng nhận nguồn gốc

---

## 3. Tích hợp Mô hình 3D & Thực tế Tăng cường (AR/VR)

- **Đường dẫn 3D**: `assets/models/lamborghini_aventador_sv.glb`
- **Hỗ trợ AR Camera**: Có (Chế độ Thực tế Tăng cường AR thời gian thực)
- **Hỗ trợ Showroom 360° / VR**: Có

---

## 4. Đồng bộ vào Hệ thống SIGMACAR

Mẫu xe này được quản lý tự động bởi pipeline:
```bash
# Kiểm tra & đồng bộ toàn bộ xe:
node scripts/import_all_xe.js
```
